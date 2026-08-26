import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getProfile } from './db';
import type { BillRecord, SerialNumberRecord } from './db';

// Extending jsPDF type to handle autoTable hook correctly
interface jsPDFWithAutoTable extends jsPDF {
  lastAutoTable: { finalY: number };
}

/** Extract the value from a serial number entry */
function getSerialValue(sn: string | SerialNumberRecord): string {
  if (typeof sn === 'string') return sn;
  return sn.value || '';
}

/** Get formatted status for serial */
function getSerialStatusLabel(sn: string | SerialNumberRecord, product?: { isRemoved: boolean; removedAt?: number }): string {
  if (typeof sn === 'string') return '';
  // Product removal overrides all serial-level timestamps
  if (product?.isRemoved && product?.removedAt) {
    const time = new Date(product.removedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    return ` [REMOVED ${time}]`;
  }
  if (sn.isRemoved) {
    const time = new Date(sn.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    return ` [REMOVED ${time}]`;
  }
  if (sn.isAdded) {
    const time = new Date(sn.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    return ` [ADDED ${time}]`;
  }
  return '';
}

export const generatePDFBlob = async (bill: BillRecord): Promise<string> => {
  const doc = new jsPDF() as jsPDFWithAutoTable;
  const profile = await getProfile();

  // ── Header ────────────────────────────────────────────────────────────────
  doc.setFontSize(22);
  doc.setTextColor(26, 35, 126);
  const businessTitle = profile?.businessName?.trim() ? profile.businessName : 'BillItUp Invoice';
  doc.text(businessTitle, 105, 20, { align: 'center' });

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Bill ID: ${bill.id}`, 105, 29, { align: 'center' });
  doc.text(`Customer Name: ${bill.customerName}`, 105, 35, { align: 'center' });
  
  doc.setFontSize(9);
  doc.text(`Date: ${bill.dateString} | Time: ${bill.timeString || ''}`, 14, 45);
  doc.text(`Total Inventory Count: ${bill.totalQuantity}`, 14, 50);

  // ── Unified Table for Entire Bill ───────────────────────────────────────
  const tableData = bill.products.map((product, pIndex) => {
    // Ghost Row Filter for PDF: Hide if removed but never scanned
    const filteredSerials = (product.serialNumbers || []).filter(sn => {
      if (typeof sn === 'string') return true;
      if (sn.isRemoved && !sn.value) return false;
      return true;
    });

    const serialsList = filteredSerials.length > 0
      ? filteredSerials.map((sn, i) => `${i + 1}. ${getSerialValue(sn)}${getSerialStatusLabel(sn, product)}`).join('\n')
      : 'No Serials tracked';

    let productName = product.name;
    if (product.isRemoved && product.removedAt) {
      const time = new Date(product.removedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      productName += ` [REMOVED ${time}]`;
    } else if (product.isAdded) {
      const time = new Date(product.addedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      productName += ` [ADDED ${time}]`;
    } else if (product.isRemoved) {
      productName += ' [REMOVED]';
    }

    return [
      (pIndex + 1).toString().padStart(2, '0'),
      productName,
      product.model || 'N/A',
      product.quantity.toString(),
      serialsList
    ];
  });

  autoTable(doc, {
    startY: 56,
    head: [['S.No', 'Product', 'Model', 'Qty', 'Serial Numbers']],
    body: tableData,
    theme: 'grid',
    headStyles: { 
      fillColor: [26, 35, 126], 
      textColor: [255, 255, 255],
      fontSize: 9,
      fontStyle: 'bold',
      halign: 'center'
    },
    styles: { 
      fontSize: 8, // Slightly smaller for dense serial lists
      cellPadding: 3,
      valign: 'top',
      overflow: 'linebreak'
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 35 },
      3: { cellWidth: 12, halign: 'center' },
      4: { cellWidth: 65 }
    },
    rowPageBreak: 'auto',
    margin: { left: 14, right: 14, bottom: 20 },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const product = bill.products[data.row.index];
        if (product && product.isRemoved) {
          data.cell.styles.textColor = [220, 50, 50]; // Red for removed products
        }
        
        // For the serial numbers column (index 4)
        if (data.column.index === 4) {
           // We use text tags ([REMOVED], [ADDED]) within the string as the primary indicator
           // since jspdf-autotable doesn't easily support multi-color within a single cell.
        }
      }
    },
    didDrawPage: (_data) => {
      const pageCount = (doc.internal as any).getNumberOfPages();
      const currPage = (doc.internal as any).getCurrentPageInfo().pageNumber;
      
      const userNameStr = profile?.userName?.trim() ? profile.userName : 'Admin';
      const userPhoneStr = profile?.phone?.trim() ? profile.phone : 'N/A';
      
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`Generated by: ${userNameStr} | Contact: ${userPhoneStr}`, 14, 287);
      doc.text(`Page ${currPage} of ${pageCount}`, 196, 287, { align: 'right' });
    }
  });

  // ── Remarks Section ─────────────────────────────────────────────────────
  if (bill.remarks?.trim()) {
    const finalY = (doc as any).lastAutoTable.finalY || 56;
    const pageHeight = doc.internal.pageSize.height;
    
    // Check if we need a new page for remarks (approx 20px buffer)
    if (finalY + 20 > pageHeight - 30) {
      doc.addPage();
    }

    const currentY = (finalY + 15 > pageHeight - 30) ? 25 : finalY + 12;
    
    doc.setFontSize(10);
    doc.setTextColor(26, 35, 126);
    doc.setFont('helvetica', 'bold');
    doc.text('Additional Remarks:', 14, currentY);
    
    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.setFont('helvetica', 'normal');
    
    // Wrap text to fit page width
    const splitRemarks = doc.splitTextToSize(bill.remarks, 182);
    doc.text(splitRemarks, 14, currentY + 6);
  }

  const pdfOutput = doc.output('datauristring');
  const base64Data = pdfOutput.split(',')[1];

  return base64Data;
};
