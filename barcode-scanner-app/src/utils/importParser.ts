import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import type { Product, SerialNumberRecord } from './db';

// Configure pdfjs worker if available or use legacy build
try {
  if (typeof window !== 'undefined' && !(pdfjsLib as any).GlobalWorkerOptions.workerSrc) {
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '4.10.38'}/pdf.worker.min.mjs`;
  }
} catch (_e) {
  // worker config fallback
}

export interface ParsedBillData {
  customerName: string;
  clientPhoneNumber: string;
  products: Product[];
  remarks?: string;
  sourceFileName: string;
}

// ─────────────────────────────────────────────
// HELPER: Normalization & Regex Detectors
// ─────────────────────────────────────────────

export const extractPhoneNumber = (text: string): string => {
  if (!text) return '';
  // Indian phone number regex: +91 optional, starts with 6-9, 10 digits
  const phoneMatch = text.match(/(?:\+91[\-\s]?)?([6-9]\d{9})\b/);
  if (phoneMatch && phoneMatch[1]) {
    return phoneMatch[1];
  }
  // Generic 10 digit fallback
  const genericMatch = text.match(/\b\d{10}\b/);
  return genericMatch ? genericMatch[0] : '';
};

export const cleanCustomerName = (raw: string): string => {
  if (!raw) return '';
  let cleaned = raw.replace(/^(m\/s\.?|mr\.?|mrs\.?|shree|shri|to:?|bill to:?|customer:?|client:?|party:?|party name:?|buyer:?|name:?)/i, '').trim();
  cleaned = cleaned.replace(/[^a-zA-Z\s]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned;
};

const splitSerialNumbers = (raw: any): SerialNumberRecord[] => {
  if (!raw) return [];
  const text = String(raw).trim();
  if (!text) return [];

  // Split on commas, semicolons, newlines, tabs, slashes, or multiple spaces
  const parts = text.split(/[\n\r,;\t/|]+/).map(s => s.trim()).filter(Boolean);
  const now = Date.now();

  const records: SerialNumberRecord[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    // Remove "S/N:", "SN:", "IMEI:", "SN" prefixes if attached
    const cleanVal = part.replace(/^(sn:|s\/n:|imei:|imei\s*1:|imei\s*2:|serial:?|barcode:?)\s*/i, '').trim();
    if (cleanVal && !seen.has(cleanVal.toUpperCase())) {
      seen.add(cleanVal.toUpperCase());
      records.push({
        value: cleanVal,
        isRemoved: false,
        isAdded: false,
        timestamp: now,
      });
    }
  }

  return records;
};

// ─────────────────────────────────────────────
// EXCEL (.xlsx, .xls, .csv) PARSER
// ─────────────────────────────────────────────

export const parseExcelFile = async (file: File): Promise<ParsedBillData> => {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  let detectedCustomer = '';
  let detectedPhone = '';
  let detectedRemarks = '';
  const parsedProducts: Product[] = [];

  // Inspect the first sheet
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Excel workbook contains no sheets.');

  const worksheet = workbook.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  if (!rows || rows.length === 0) {
    throw new Error('The selected spreadsheet is empty.');
  }

  // 1. Scan top rows (1-10) for Header Metadata (Customer Name, Phone, Date, Remarks)
  let tableHeaderRowIndex = -1;
  let colMap: { [key: string]: number } = {};

  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const row = rows[r];

    // Check for customer metadata
    if (!detectedCustomer) {
      for (let c = 0; c < row.length; c++) {
        const cell = String(row[c] || '').trim();
        if (/^(customer|client|party|bill to|buyer|buyer name|customer name|party name)\b/i.test(cell)) {
          const nextVal = String(row[c + 1] || '').trim();
          if (nextVal) detectedCustomer = cleanCustomerName(nextVal);
        } else if (/^(m\/s\.?|to:)\b/i.test(cell)) {
          detectedCustomer = cleanCustomerName(cell);
        }
      }
    }

    // Check for phone number metadata
    if (!detectedPhone) {
      const foundPhone = extractPhoneNumber(row.join(' '));
      if (foundPhone) detectedPhone = foundPhone;
    }

    // Check if this row looks like a Table Header (contains item/product/name/qty/serial columns)
    let itemCol = -1;
    let qtyCol = -1;
    let modelCol = -1;
    let serialCol = -1;
    let descCol = -1;

    for (let c = 0; c < row.length; c++) {
      const colHeader = String(row[c] || '').trim().toLowerCase();
      if (!colHeader) continue;

      if (/^(item|product|item name|product name|particulars|items|products|item description|product description)$/i.test(colHeader)) {
        itemCol = c;
      } else if (/^(model|model no|model number|model code|item code|sku|part no|part number)$/i.test(colHeader)) {
        modelCol = c;
      } else if (/^(qty|quantity|count|nos|pcs|units|quantity sold)$/i.test(colHeader)) {
        qtyCol = c;
      } else if (/^(serial|serial no|serial number|serial numbers|serials|imei|imei no|sn|s\/n|barcode|barcodes)$/i.test(colHeader)) {
        serialCol = c;
      } else if (/^(desc|description|remarks|notes|details|specification)$/i.test(colHeader)) {
        descCol = c;
      }
    }

    // If we found at least an item column or qty/serial column, mark as table header
    if (itemCol !== -1 || (qtyCol !== -1 && serialCol !== -1)) {
      tableHeaderRowIndex = r;
      colMap = { itemCol, modelCol, qtyCol, serialCol, descCol };
      break;
    }
  }

  // 2. If table header was found, parse product rows
  if (tableHeaderRowIndex !== -1) {
    for (let r = tableHeaderRowIndex + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every((c: any) => String(c).trim() === '')) continue;

      const rawItem = colMap.itemCol !== -1 ? String(row[colMap.itemCol] || '').trim() : '';
      const rawModel = colMap.modelCol !== -1 ? String(row[colMap.modelCol] || '').trim() : '';
      const rawQty = colMap.qtyCol !== -1 ? Number(row[colMap.qtyCol]) : 1;
      const rawSerials = colMap.serialCol !== -1 ? row[colMap.serialCol] : '';
      const rawDesc = colMap.descCol !== -1 ? String(row[colMap.descCol] || '').trim() : '';

      // Skip summary / total rows
      if (/^(total|grand total|subtotal|tax|gst|cgst|sgst|discount|round off)/i.test(rawItem)) {
        continue;
      }

      if (!rawItem && !rawModel && !rawSerials) continue;

      const serials = splitSerialNumbers(rawSerials);
      const parsedQty = !isNaN(rawQty) && rawQty > 0 ? rawQty : (serials.length > 0 ? serials.length : 1);

      parsedProducts.push({
        id: crypto.randomUUID(),
        name: rawItem || `Item ${parsedProducts.length + 1}`,
        model: rawModel || '',
        description: rawDesc || '',
        quantity: parsedQty,
        hasSerials: serials.length > 0,
        serialNumbers: serials,
        isRemoved: false,
        isAdded: false,
        addedAt: Date.now(),
      });
    }
  } else {
    // 3. Fallback: Parse non-empty rows as generic products
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r].filter((c: any) => String(c).trim() !== '');
      if (row.length === 0) continue;

      const rowStr = row.join(' ');
      if (/^(total|grand total|subtotal|date|invoice|bill)/i.test(rowStr)) continue;

      parsedProducts.push({
        id: crypto.randomUUID(),
        name: String(row[0] || `Item ${parsedProducts.length + 1}`).trim(),
        model: String(row[1] || '').trim(),
        description: '',
        quantity: 1,
        hasSerials: false,
        serialNumbers: [],
        isRemoved: false,
        isAdded: false,
        addedAt: Date.now(),
      });
    }
  }

  return {
    customerName: detectedCustomer || 'Customer',
    clientPhoneNumber: detectedPhone || '',
    products: parsedProducts.length > 0 ? parsedProducts : [{
      id: crypto.randomUUID(),
      name: 'Imported Item 1',
      model: '',
      description: '',
      quantity: 1,
      hasSerials: true,
      serialNumbers: [],
      isRemoved: false,
      isAdded: false,
      addedAt: Date.now(),
    }],
    remarks: detectedRemarks,
    sourceFileName: file.name,
  };
};

// ─────────────────────────────────────────────
// PDF (.pdf) INVOICE & DOCUMENT PARSER
// ─────────────────────────────────────────────

export const parsePDFFile = async (file: File): Promise<ParsedBillData> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await (pdfjsLib as any).getDocument({ data: arrayBuffer }).promise;
  const numPages = pdfDoc.numPages;

  let fullText = '';
  const textLines: string[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const pageStrings = content.items.map((item: any) => item.str);
    fullText += pageStrings.join('\n') + '\n';

    // Group items into lines
    let currentLine = '';
    let lastY: number | null = null;

    for (const item of content.items) {
      const y = item.transform ? item.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 5) {
        if (currentLine.trim()) textLines.push(currentLine.trim());
        currentLine = item.str;
      } else {
        currentLine += ' ' + item.str;
      }
      lastY = y;
    }
    if (currentLine.trim()) textLines.push(currentLine.trim());
  }

  // 1. Extract Customer Name & Phone
  const detectedPhone = extractPhoneNumber(fullText);
  let detectedCustomer = '';

  for (const line of textLines) {
    if (/^(customer|client|party|bill to|buyer|buyer name|to:|m\/s\.?)\b/i.test(line)) {
      const cleaned = cleanCustomerName(line);
      if (cleaned && cleaned.length > 2) {
        detectedCustomer = cleaned;
        break;
      }
    }
  }

  // 2. Extract Products & Serials from lines
  const parsedProducts: Product[] = [];
  let currentProduct: Product | null = null;

  for (let i = 0; i < textLines.length; i++) {
    const line = textLines[i].trim();
    if (!line) continue;

    // Skip noise
    if (/^(invoice|tax invoice|bill of supply|original for recipient|terms & conditions|bank details|authorised signatory|total|subtotal|cgst|sgst|igst|hsn\/sac|signature)/i.test(line)) {
      continue;
    }

    // Check if line contains serial numbers / IMEI
    if (/(s\/n|sn:|serial|imei|imei\s*1:|mac:)/i.test(line)) {
      const serials = splitSerialNumbers(line);
      if (serials.length > 0) {
        if (currentProduct) {
          currentProduct.serialNumbers.push(...serials);
          currentProduct.hasSerials = true;
          currentProduct.quantity = Math.max(Number(currentProduct.quantity) || 0, currentProduct.serialNumbers.length);
        } else {
          currentProduct = {
            id: crypto.randomUUID(),
            name: `Product ${parsedProducts.length + 1}`,
            model: '',
            description: '',
            quantity: serials.length,
            hasSerials: true,
            serialNumbers: serials,
            isRemoved: false,
            isAdded: false,
            addedAt: Date.now(),
          };
          parsedProducts.push(currentProduct);
        }
        continue;
      }
    }

    // Detect Table Row Pattern: e.g. "1 iPhone 15 Pro Max 256GB 2 Nos" or "Dell Latitude 5420 Qty: 1"
    const itemMatch = line.match(/^(\d+\.?\s+)?([A-Za-z0-9\s\-+/&().]+?)\s+(?:qty[:\s]+)?(\d+)\s*(?:nos|pcs|units)?$/i);
    if (itemMatch && itemMatch[2] && itemMatch[2].length > 2 && !/^(total|subtotal|gst|tax|date|page|amount)/i.test(itemMatch[2].trim())) {
      const itemName = itemMatch[2].trim();
      const itemQty = parseInt(itemMatch[3], 10) || 1;

      currentProduct = {
        id: crypto.randomUUID(),
        name: itemName,
        model: '',
        description: '',
        quantity: itemQty,
        hasSerials: false,
        serialNumbers: [],
        isRemoved: false,
        isAdded: false,
        addedAt: Date.now(),
      };
      parsedProducts.push(currentProduct);
    }
  }

  return {
    customerName: detectedCustomer || 'Customer',
    clientPhoneNumber: detectedPhone || '',
    products: parsedProducts.length > 0 ? parsedProducts : [{
      id: crypto.randomUUID(),
      name: 'Imported PDF Item 1',
      model: '',
      description: '',
      quantity: 1,
      hasSerials: true,
      serialNumbers: [],
      isRemoved: false,
      isAdded: false,
      addedAt: Date.now(),
    }],
    remarks: `Imported from ${file.name}`,
    sourceFileName: file.name,
  };
};
