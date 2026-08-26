import JSZip from 'jszip';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { format } from 'date-fns';
import type { BillRecord, UserProfile } from './db';
import { billsDB, getAllBills, sanitizeForFirestore } from './db';
import { firestore, isFirebaseConfigured } from './firebase';
import { doc, setDoc } from 'firebase/firestore';

export interface BackupPayload {
  version: string;
  exportDate: string;
  businessName?: string;
  totalBills: number;
  profile?: UserProfile | null;
  bills: BillRecord[];
}

/**
 * Exports all local bills + profile into a compressed .ZIP file.
 */
export const exportBackupArchive = async (profile?: UserProfile | null): Promise<string> => {
  const allBills = await getAllBills();
  if (allBills.length === 0) {
    throw new Error('No bills found in your business vault to back up.');
  }

  const backupData: BackupPayload = {
    version: '1.0',
    exportDate: new Date().toISOString(),
    businessName: profile?.businessName || 'My Business',
    totalBills: allBills.length,
    profile: profile || null,
    bills: allBills
  };

  const zip = new JSZip();
  const jsonContent = JSON.stringify(backupData, null, 2);
  zip.file('backup.json', jsonContent);
  zip.file('README.txt', `BillItUp Business Data Backup\nExported: ${new Date().toLocaleString()}\nTotal Bills: ${allBills.length}\nBusiness: ${backupData.businessName}\n\nDo not manually modify the JSON file.`);

  const dateTag = format(new Date(), 'yyyy-MM-dd-HHmm');
  const fileName = `BillItUp-Backup-${dateTag}.zip`;

  if (Capacitor.isNativePlatform()) {
    const base64Data = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
    
    // 1. Save to permanent Documents directory
    try {
      await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Documents,
      });
    } catch (e) {
      console.warn('[BACKUP_EXPORT] Documents write failed:', e);
    }

    // 2. Also save to Cache for native Share dialog
    const file = await Filesystem.writeFile({
      path: fileName,
      data: base64Data,
      directory: Directory.Cache,
    });

    await Share.share({
      title: 'BillItUp Data Backup',
      text: `Backup of ${allBills.length} bills from ${backupData.businessName}.`,
      url: file.uri,
      dialogTitle: 'Save Backup ZIP Archive'
    });
    return fileName;
  } else {
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    return fileName;
  }
};

/**
 * Validates whether an object has the essential properties of a BillRecord.
 */
function isValidBillRecord(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false;
  // Must have an id and products array or timestamp
  const hasId = typeof obj.id === 'string' && obj.id.trim().length > 0;
  const hasProducts = Array.isArray(obj.products);
  const hasTimestamp = typeof obj.timestamp === 'number' || typeof obj.dateString === 'string';
  return hasId && (hasProducts || hasTimestamp);
}

/**
 * Recursively searches any parsed JSON object or array for BillRecord items.
 */
function extractBillsFromObject(obj: any): BillRecord[] {
  if (!obj) return [];
  const results: BillRecord[] = [];

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (isValidBillRecord(item)) {
        results.push(item as BillRecord);
      } else if (typeof item === 'object') {
        results.push(...extractBillsFromObject(item));
      }
    }
    return results;
  }

  if (typeof obj === 'object') {
    if (Array.isArray(obj.bills)) {
      for (const item of obj.bills) {
        if (isValidBillRecord(item)) {
          results.push(item as BillRecord);
        }
      }
    } else {
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object') {
          results.push(...extractBillsFromObject(obj[key]));
        }
      }
    }
  }

  return results;
}

/**
 * Sanitizes and normalizes raw bill objects for database storage.
 */
function sanitizeImportedBill(raw: any, currentUser?: any): BillRecord {
  const ts = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
  const d = new Date(ts);
  const dateString = raw.dateString && /^\d{4}\/\d{2}\/\d{2}$/.test(raw.dateString)
    ? raw.dateString
    : `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;

  const timeString = raw.timeString || `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `${dateString}-${timeString}-1`;

  const products = Array.isArray(raw.products)
    ? raw.products.map((p: any) => ({
        id: p.id || crypto.randomUUID(),
        name: p.name || 'Unnamed Item',
        modelNumber: p.modelNumber || '',
        quantity: Number(p.quantity) || 1,
        isRemoved: Boolean(p.isRemoved),
        removedAt: p.removedAt ?? null,
        isAdded: Boolean(p.isAdded),
        addedAt: p.addedAt || ts,
        hasSerials: Boolean(p.hasSerials ?? (p.serialNumbers && p.serialNumbers.length > 0)),
        serialNumbers: Array.isArray(p.serialNumbers)
          ? p.serialNumbers.map((sn: any) => {
              if (typeof sn === 'string') {
                return { value: sn, isRemoved: false, isAdded: false, timestamp: ts };
              }
              return {
                value: sn.value || '',
                isRemoved: Boolean(sn.isRemoved),
                isAdded: Boolean(sn.isAdded),
                timestamp: sn.timestamp || ts
              };
            })
          : []
      }))
    : [];

  const totalQuantity = products.reduce((sum: number, p: any) => (!p.isRemoved ? sum + (p.quantity || 1) : sum), 0);

  const cleanAdminPhone = (currentUser?.phoneNumber || raw.adminPhone || '').replace(/\D/g, '').slice(-10);
  const cleanAdminId = currentUser?.uid || raw.adminId || undefined;
  const cleanBusinessName = currentUser?.businessName || raw.businessName || undefined;

  return {
    id,
    sequenceNumber: typeof raw.sequenceNumber === 'number' ? raw.sequenceNumber : 0,
    customerName: raw.customerName || 'Customer',
    timestamp: ts,
    dateString,
    timeString,
    products,
    totalQuantity,
    isViewed: Boolean(raw.isViewed),
    remarks: raw.remarks || '',
    logs: Array.isArray(raw.logs) && raw.logs.length > 0
      ? raw.logs
      : [{ action: 'Imported from Backup', timestamp: Date.now() }],
    isSynced: false,
    adminId: cleanAdminId,
    adminPhone: cleanAdminPhone || undefined,
    businessName: cleanBusinessName
  };
}

export type ProgressCallback = (step: number, message: string, progressPercent: number) => void;

/**
 * Main Restore Pipeline:
 * Extracts, searches, validates, sanitizes, imports into local vault, and syncs to cloud.
 */
export const restoreBackupFile = async (
  file: File,
  currentUser: any,
  onProgress: ProgressCallback
): Promise<{ success: boolean; count: number }> => {
  const fileName = file.name;
  const lowerName = fileName.toLowerCase();

  // 1. File Type Validation Check
  const isZip = lowerName.endsWith('.zip') || file.type.includes('zip') || file.type.includes('compressed');
  const isJson = lowerName.endsWith('.json') || file.type.includes('json');

  if (!isZip && !isJson) {
    throw new Error('INVALID_FILE_TYPE: Invalid file type. Please select a valid .ZIP or .JSON backup file exported from BillItUp.');
  }

  // ── STEP 1: Extracting filename.extension ──
  onProgress(1, `Extracting ${fileName}...`, 15);
  await new Promise(r => setTimeout(r, 450));

  let extractedJsonStrings: string[] = [];

  if (isZip) {
    try {
      const zip = await JSZip.loadAsync(file);
      const jsonFiles = Object.keys(zip.files).filter(k => !zip.files[k].dir && k.toLowerCase().endsWith('.json'));

      if (jsonFiles.length === 0) {
        throw new Error('NO_JSON_IN_ZIP');
      }

      for (const jf of jsonFiles) {
        const text = await zip.files[jf].async('text');
        extractedJsonStrings.push(text);
      }
    } catch (e: any) {
      if (e.message === 'NO_JSON_IN_ZIP') {
        throw new Error('INVALID_ARCHIVE: The selected ZIP file does not contain any valid backup files. Kindly repick or check for discrepancies.');
      }
      throw new Error('CORRUPTED_ZIP: Could not decompress ZIP archive. The file may be damaged or corrupted. Kindly repick or check for discrepancies.');
    }
  } else {
    try {
      const text = await file.text();
      extractedJsonStrings.push(text);
    } catch (_e) {
      throw new Error('CORRUPTED_JSON: Could not read JSON file. Kindly repick or check for discrepancies.');
    }
  }

  // ── STEP 2: Searching for bills in filename.extension ──
  onProgress(2, `Searching for bills in ${fileName}...`, 35);
  await new Promise(r => setTimeout(r, 450));

  const candidateBills: any[] = [];
  for (const jsonStr of extractedJsonStrings) {
    try {
      const parsed = JSON.parse(jsonStr);
      const billsFound = extractBillsFromObject(parsed);
      candidateBills.push(...billsFound);
    } catch (_ignore) {
      // Discard invalid JSON entries gracefully without failing
    }
  }

  if (candidateBills.length === 0) {
    throw new Error('NO_VALID_BILLS: The selected file does not contain any valid bill records. Kindly repick or check for discrepancies.');
  }

  // ── STEP 3: Found N bills in filename.extension ──
  onProgress(3, `Found ${candidateBills.length} bill${candidateBills.length > 1 ? 's' : ''} in ${fileName}`, 55);
  await new Promise(r => setTimeout(r, 600));

  // ── STEP 4: Sanitizing and removing discrepancies from the bills for cleanliness ──
  onProgress(4, 'Sanitizing and removing discrepancies from bills for cleanliness...', 75);
  await new Promise(r => setTimeout(r, 500));

  const sanitizedBills: BillRecord[] = candidateBills.map(b => sanitizeImportedBill(b, currentUser));

  // ── STEP 5: Importing N bills into the system ──
  onProgress(5, `Importing ${sanitizedBills.length} bill${sanitizedBills.length > 1 ? 's' : ''} into the system...`, 90);
  await new Promise(r => setTimeout(r, 450));

  for (const bill of sanitizedBills) {
    await billsDB.setItem(bill.id, bill);
  }

  // ── STEP 6: Syncing the bills to the cloud and local storage ──
  onProgress(6, 'Syncing the bills to the cloud and local storage...', 100);
  await new Promise(r => setTimeout(r, 450));

  if (isFirebaseConfigured && firestore) {
    for (const bill of sanitizedBills) {
      try {
        const flatId = bill.id.replace(/\//g, '_');
        const sanitizedForCloud = sanitizeForFirestore({ ...bill, isSynced: true });
        await setDoc(doc(firestore, 'bills', flatId), sanitizedForCloud);
        await billsDB.setItem(bill.id, { ...bill, isSynced: true });
      } catch (cloudErr) {
        console.warn(`[RESTORE_SYNC] Deferred cloud push for ${bill.id}:`, cloudErr);
      }
    }
  }

  return { success: true, count: sanitizedBills.length };
};
