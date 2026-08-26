import localforage from 'localforage';
import { Capacitor } from '@capacitor/core';
import { firestore, isFirebaseConfigured } from './firebase';
export { isFirebaseConfigured };
import { collection, doc, setDoc, deleteDoc, query, onSnapshot, getDocs, orderBy, limit } from "firebase/firestore";

const sessionId = Math.random().toString(36).substring(7);
export interface SerialNumberRecord {
  value: string;
  isRemoved: boolean;
  isAdded: boolean;
  timestamp: number;
}

export interface Product {
  id: string;
  name: string;
  model: string;
  description?: string; // Optional context
  quantity: number | '';
  hasSerials: boolean;
  serialNumbers: SerialNumberRecord[];
  isRemoved: boolean;
  removedAt?: number;
  isAdded: boolean;
  addedAt: number;
}

export interface AuditLog {
  action: string;
  timestamp: number;
  targetId?: string; // Product ID or serial identifier for jump-to
  targetType?: 'product' | 'serial'; // What kind of element to scroll to
}

export interface BillRecord {
  id: string; // Unique identifier: YYYY/MM/DD-HH:MM-(Sequence Number)
  sequenceNumber: number; // Daily incrementing number
  customerName: string;
  timestamp: number; // Unix timestamp for sorting
  dateString: string; // YYYY/MM/DD
  timeString: string; // HH:MM
  products: Product[]; // Array of scanned items
  totalQuantity: number; // Sum of all product quantities
  isViewed?: boolean; // Track if the bill has been viewed/marked
  remarks?: string; // Additional notes
  logs: AuditLog[]; // Audit trail
  isSynced?: boolean; // Metadata: Has this bill reached the cloud?
  createdByUserId?: string; // Phase 1: Support for roles
  clientPhoneNumber?: string; // Phase 1: Support for roles
  adminId?: string; // Multi-tenant: The business admin who owns this bill
  adminPhone?: string; // Multi-tenant: Business admin phone
  businessName?: string; // Multi-tenant: Business name attached to this bill
}

export let billsDB = localforage.createInstance({
  name: 'BillItUpDB',
  storeName: 'bills_default'
});

export const initUserVault = (userId: string) => {
  billsDB = localforage.createInstance({
    name: 'BillItUpDB',
    storeName: `bills_${userId}`
  });
  console.log(`[VAULT] Switched to local vault for user: ${userId}`);
};

export const clearUserVault = async () => {
  await billsDB.clear();
  console.log(`[VAULT] Cleared local vault`);
};

// ──────────────────────────────────────────────────
// CORE BILL OPERATIONS — BULLETPROOF
// ──────────────────────────────────────────────────

// ──────────────────────────────────────────────────
// USER & SESSION OPERATIONS
// ──────────────────────────────────────────────────

export const getUserRole = async (phoneNumber: string): Promise<{role: string, name?: string} | null> => {
  if (!isFirebaseConfigured || !firestore) return null;
  try {
    const target = phoneNumber.replace(/\D/g, '').slice(-10);
    const snap = await getDocs(collection(firestore, "users"));
    const userDoc = snap.docs.find(d => {
      const p = (d.data().phoneNumber || '').replace(/\D/g, '').slice(-10);
      return p === target;
    });
    if (userDoc) return userDoc.data() as {role: string, name?: string};
    return null;
  } catch (e) {
    console.error("Failed to get user role", e);
    return null;
  }
};

export const getClientSession = async (phoneNumber: string, tempPassword: string) => {
  if (!isFirebaseConfigured || !firestore) return null;
  try {
    const target = phoneNumber.replace(/\D/g, '').slice(-10);
    const snap = await getDocs(collection(firestore, "sessions"));
    const session = snap.docs.find(d => {
      const data = d.data();
      const p = (data.phoneNumber || '').replace(/\D/g, '').slice(-10);
      return p === target && (data.tempPassword || '').trim() === tempPassword.trim();
    });
    if (session) return session.data();
    return null;
  } catch (e) {
    console.error("Failed to get client session", e);
    return null;
  }
};

/**
 * Persists a completed bill to IndexedDB AND Firestore.
 * Local save is instant. Cloud save retries up to 3 times.
 * A bill is NEVER silently lost.
 */
/**
 * Helper to strip 'undefined' values from nested objects/arrays before Firestore save.
 * Firestore throws errors if any field or nested property is explicitly 'undefined'.
 */
export const sanitizeForFirestore = (obj: any): any => {
  if (obj === null || obj === undefined) {
    return null;
  }
  if (typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForFirestore(item));
  }
  const clean: any = {};
  Object.keys(obj).forEach(key => {
    const val = obj[key];
    if (val !== undefined) {
      clean[key] = sanitizeForFirestore(val);
    }
  });
  return clean;
};

export const saveBill = async (bill: BillRecord) => {
  // 1. ALWAYS save locally first — this is instant and never fails
  await billsDB.setItem(bill.id, bill);
  console.log(`[SAVE] Bill ${bill.id} saved locally.`);
  
  // 2. Push to Firestore with retry
  if (isFirebaseConfigured && firestore) {
    const flatId = bill.id.replace(/\//g, '_');
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        const sanitized = sanitizeForFirestore({ ...bill, isSynced: true });
        await setDoc(doc(firestore, "bills", flatId), sanitized);
        // Update local status ONLY after cloud success
        await billsDB.setItem(bill.id, { ...bill, isSynced: true });
        console.log(`[SAVE] Bill ${bill.id} synced to cloud.`);
        
        // 3. Send a Sync Ping for other devices to see
        await sendSyncPing(bill.id, bill.customerName);
        
        break; // Success — exit loop
      } catch (e) {
        attempts++;
        console.warn(`[SAVE] Cloud sync attempt ${attempts}/${maxAttempts} failed for ${bill.id}:`, e);
        if (attempts < maxAttempts) {
          await new Promise(r => setTimeout(r, 1000 * attempts)); // Exponential backoff
        } else {
          // Mark as unsynced locally so background sync picks it up later
          await billsDB.setItem(bill.id, { ...bill, isSynced: false });
          console.error(`[SAVE] Cloud sync FAILED for ${bill.id}. Marked for background retry.`);
        }
      }
    }
  } else {
    // No firebase? Mark for later sync
    await billsDB.setItem(bill.id, { ...bill, isSynced: false });
  }
};

/**
 * Retrieves all saved bills, sorted by most recent first.
 */
export const getAllBills = async (): Promise<BillRecord[]> => {
  const bills: BillRecord[] = [];
  await billsDB.iterate((value: BillRecord) => {
    bills.push(value);
  });
  return bills.sort((a, b) => b.timestamp - a.timestamp);
};

// ──────────────────────────────────────────────────
// CLOUD RESTORE — REINSTALL SAFETY NET
// ──────────────────────────────────────────────────

export interface UserScope {
  uid?: string;
  phoneNumber?: string;
  role?: string;
  adminId?: string;
}

export const isBillInScope = (bill: BillRecord, userScope?: UserScope): boolean => {
  if (!userScope) return true;
  const cleanPhone = (userScope.phoneNumber || '').replace(/\D/g, '').slice(-10);
  const isAdmin = userScope.role === 'admin';
  const isClient = userScope.role === 'client';
  const isStaff = userScope.role === 'user';

  if (isAdmin) {
    const billAdminPhone = (bill.adminPhone || '').replace(/\D/g, '').slice(-10);
    const isOwner = (bill.adminId && bill.adminId === userScope.uid) || (billAdminPhone && billAdminPhone === cleanPhone);
    return !!isOwner;
  } else if (isStaff) {
    if (bill.adminId && userScope.adminId && bill.adminId !== userScope.adminId) return false;
    return true;
  } else if (isClient) {
    const billClientPhone = (bill.clientPhoneNumber || '').replace(/\D/g, '').slice(-10);
    return billClientPhone === cleanPhone;
  }
  return true;
};

/**
 * Pulls ALL scoped bills from Firestore into local IndexedDB.
 * This guarantees that even after a complete app uninstall/reinstall,
 * all bills for the active business are recovered from the cloud.
 */
export const restoreFromCloud = async (userScope?: UserScope): Promise<number> => {
  if (!isFirebaseConfigured || !firestore) return 0;
  
  try {
    const q = query(collection(firestore, "bills"));
    const snapshot = await getDocs(q);
    
    let restoredCount = 0;
    for (const d of snapshot.docs) {
      const bill = d.data() as BillRecord;
      if (!isBillInScope(bill, userScope)) continue;

      // Only add if not already in local (preserve local edits)
      const existing = await billsDB.getItem<BillRecord>(bill.id);
      if (!existing) {
        await billsDB.setItem(bill.id, bill);
        restoredCount++;
      }
    }
    
    if (restoredCount > 0) {
      console.log(`[RESTORE] Recovered ${restoredCount} bills from cloud for ${userScope?.uid || 'all'}.`);
    }
    
    return restoredCount;
  } catch (e) {
    console.warn("[RESTORE] Cloud restore failed (offline?):", e);
    return 0;
  }
};

// ──────────────────────────────────────────────────
// REAL-TIME SYNC LISTENER
// ──────────────────────────────────────────────────

export const checkIsViewerMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  // 1. Check if running on a native platform (Android/iOS)
  const isNative = Capacitor.isNativePlatform();
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isNative && !isLocalhost) return true; // Web is viewer mode, EXCEPT localhost
  
  // 2. Check environment variable as secondary
  const envMode = import.meta.env.VITE_APP_MODE;
  if (envMode === 'viewer') return true;
  
  return (window as any).__VITE_APP_MODE__ === 'viewer';
};

export const subscribeToBills = (
  callback: (bills: BillRecord[]) => void,
  userScope?: UserScope
) => {
  const isViewerMode = checkIsViewerMode();

  if (isFirebaseConfigured && firestore) {
    const q = query(collection(firestore, "bills"));
    return onSnapshot(q, async (snapshot) => {
      if (isViewerMode) {
        // VIEWER MODE (website): Cloud is the ONLY source of truth.
        const cloudBills: BillRecord[] = snapshot.docs
          .map(d => d.data() as BillRecord)
          .filter(b => isBillInScope(b, userScope));
        callback(cloudBills.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
      } else {
        // ADMIN MODE (phone/localhost): Local-first, merge cloud changes in.
        for (const change of snapshot.docChanges()) {
          const cloudBill = change.doc.data() as BillRecord;
          if (!isBillInScope(cloudBill, userScope)) continue;

          if (change.type === "added" || change.type === "modified") {
            const localBill = await billsDB.getItem<BillRecord>(cloudBill.id);
            // Only update local if cloud version is actually newer
            if (!localBill || (cloudBill.timestamp > (localBill.timestamp || 0))) {
              await billsDB.setItem(cloudBill.id, cloudBill);
            }
          } else if (change.type === "removed") {
            console.log(`[SYNC] Bill ${change.doc.id} removed from cloud.`);
            await billsDB.removeItem(change.doc.id);
          }
        }

        // Read the complete local DB (includes local + cloud bills)
        const allBills: BillRecord[] = [];
        await billsDB.iterate((value: BillRecord) => {
          if (isBillInScope(value, userScope)) {
            allBills.push(value);
          }
        });
        
        callback(allBills.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
      }
    }, (error) => {
      console.warn("Real-time sync error:", error);
      getAllBills().then(bills => callback(bills.filter(b => isBillInScope(b, userScope))));
    });
  } else {
    getAllBills().then(bills => callback(bills.filter(b => isBillInScope(b, userScope))));
    return () => {};
  }
};

export const deleteBill = async (id: string) => {
  await billsDB.removeItem(id);
  if (isFirebaseConfigured && firestore) {
    const flatId = id.replace(/\//g, '_');
    deleteDoc(doc(firestore, "bills", flatId)).catch(e => {
      console.warn("Failed to delete from Firebase", e);
    });
  }
};

/**
 * Calculates the next sequence number for a given date.
 */
export const getNextSequenceForDate = async (datePrefix: string): Promise<number> => {
  let count = 0;
  await billsDB.iterate((value: BillRecord) => {
    if (value.id.startsWith(datePrefix)) {
      count++;
    }
  });
  return count + 1;
};

export interface UserProfile {
  businessName: string;
  userName: string;
  phone: string;
}

const profileDB = localforage.createInstance({
  name: 'BillItUpDB',
  storeName: 'profile'
});

const draftDB = localforage.createInstance({
  name: 'BillItUpDB',
  storeName: 'drafts'
});

export const saveProfile = async (profile: UserProfile, userId?: string) => {
  if (userId) {
    await profileDB.setItem(`user_profile_${userId}`, profile);
  }
  await profileDB.setItem('user_profile', profile);
};

export const getProfile = async (userId?: string): Promise<UserProfile | null> => {
  if (userId) {
    const userScoped = await profileDB.getItem<UserProfile>(`user_profile_${userId}`);
    if (userScoped) return userScoped;
  }
  return await profileDB.getItem<UserProfile>('user_profile');
};

export const saveDraft = async (draft: any) => {
  await draftDB.setItem('current_bill_draft', draft);
};

export const getDraft = async (): Promise<any | null> => {
  return await draftDB.getItem('current_bill_draft');
};

export const clearDraft = async () => {
  await draftDB.removeItem('current_bill_draft');
};

// ──────────────────────────────────────────────────
// MIGRATION — SAFE FOR LEGACY BILLS
// ──────────────────────────────────────────────────

/**
 * Automatically adopts all pre-auth legacy bills (from bills_default)
 * into the newly registered Admin's vault, attaching adminId and syncing to cloud.
 */
export const adoptLegacyBillsToAdmin = async (adminUser: { uid: string; phoneNumber: string; businessName?: string }): Promise<number> => {
  const defaultDB = localforage.createInstance({
    name: 'BillItUpDB',
    storeName: 'bills_default'
  });

  const legacyBills: BillRecord[] = [];
  await defaultDB.iterate((value: BillRecord) => {
    legacyBills.push(value);
  });

  if (legacyBills.length === 0) return 0;

  console.log(`[MIGRATION] Adopting ${legacyBills.length} legacy bills from bills_default to ${adminUser.uid}`);
  let adoptedCount = 0;

  for (const bill of legacyBills) {
    const updated: BillRecord = {
      ...bill,
      adminId: bill.adminId || adminUser.uid,
      adminPhone: bill.adminPhone || adminUser.phoneNumber,
      businessName: bill.businessName || adminUser.businessName,
    };

    // Save into active admin vault
    await billsDB.setItem(updated.id, updated);
    
    // Push to Firestore with admin metadata
    if (isFirebaseConfigured && firestore) {
      const flatId = updated.id.replace(/\//g, '_');
      await setDoc(doc(firestore, "bills", flatId), sanitizeForFirestore({ ...updated, isSynced: true })).catch(e => {
        console.warn(`[MIGRATION] Cloud sync for legacy bill ${updated.id} deferred:`, e);
      });
    }
    adoptedCount++;
  }

  // Clear default store once adopted so it never runs again
  await defaultDB.clear();
  console.log(`[MIGRATION] Successfully adopted ${adoptedCount} legacy bills.`);
  return adoptedCount;
};

/**
 * Migrates all existing bills to the new schema.
 * - Converts plain string serialNumbers to SerialNumberRecord[]
 * - Adds missing product tracking fields (isRemoved, isAdded, addedAt)
 * - Initializes logs array with a migration entry
 * - Adds sequenceNumber: 0 for legacy bills
 * - Normalizes dateString to YYYY/MM/DD format
 * - Stamped with admin metadata if provided
 * Safe to call multiple times — skips already-migrated bills.
 */
export const migrateLegacyBills = async (adminUser?: { uid: string; phoneNumber?: string; businessName?: string }): Promise<number> => {
  let migratedCount = 0;
  const bills: { key: string; value: any }[] = [];

  await billsDB.iterate((value: any, key: string) => {
    bills.push({ key, value });
  });

  for (const { key, value } of bills) {
    let needsMigration = false;

    // Check if logs array exists
    if (!value.logs || !Array.isArray(value.logs)) {
      needsMigration = true;
    }

    // Check if sequenceNumber exists
    if (typeof value.sequenceNumber !== 'number') {
      needsMigration = true;
    }

    // Check if admin ownership is missing
    if (adminUser && (!value.adminId || !value.adminPhone)) {
      needsMigration = true;
    }

    // Check products for old string-based serialNumbers
    if (value.products && Array.isArray(value.products)) {
      for (const p of value.products) {
        if (typeof p.isRemoved === 'undefined') {
          needsMigration = true;
          break;
        }
        if (p.serialNumbers && p.serialNumbers.length > 0 && typeof p.serialNumbers[0] === 'string') {
          needsMigration = true;
          break;
        }
      }
    }

    if (!needsMigration) continue;

    // Normalize dateString to YYYY/MM/DD if it's in a different format
    let dateString = value.dateString || '';
    if (dateString && !dateString.match(/^\d{4}\/\d{2}\/\d{2}$/)) {
      // Try to parse from timestamp
      const d = new Date(value.timestamp);
      dateString = `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
    }

    // Normalize timeString
    let timeString = value.timeString || '00:00';
    if (timeString.includes('AM') || timeString.includes('PM')) {
      // Convert 12h to 24h format
      const d = new Date(value.timestamp);
      timeString = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    }

    const migratedProducts = (value.products || []).map((p: any) => ({
      ...p,
      id: p.id || crypto.randomUUID(),
      isRemoved: p.isRemoved ?? false,
      removedAt: p.removedAt ?? undefined,
      isAdded: p.isAdded ?? false,
      addedAt: p.addedAt ?? value.timestamp,
      hasSerials: typeof p.hasSerials === 'boolean' ? p.hasSerials : (p.serialNumbers?.length > 0),
      serialNumbers: (p.serialNumbers || []).map((sn: any) => {
        if (typeof sn === 'string') {
          return { value: sn, isRemoved: false, isAdded: false, timestamp: value.timestamp };
        }
        return sn;
      }),
    }));

    const migrated: BillRecord = {
      id: value.id,
      sequenceNumber: value.sequenceNumber ?? 0,
      customerName: value.customerName || '',
      timestamp: value.timestamp,
      dateString,
      timeString,
      products: migratedProducts,
      totalQuantity: value.totalQuantity || 0,
      isViewed: value.isViewed ?? false,
      logs: value.logs && Array.isArray(value.logs) && value.logs.length > 0
        ? value.logs
        : [{ action: 'Legacy Bill Migrated', timestamp: Date.now() }],
      adminId: value.adminId || (adminUser ? adminUser.uid : undefined),
      adminPhone: value.adminPhone || (adminUser ? adminUser.phoneNumber : undefined),
      businessName: value.businessName || (adminUser ? adminUser.businessName : undefined),
    };

    await billsDB.setItem(key, migrated);
    if (isFirebaseConfigured && firestore && adminUser) {
      const flatId = key.replace(/\//g, '_');
      await setDoc(doc(firestore, "bills", flatId), sanitizeForFirestore({ ...migrated, isSynced: true })).catch(() => {});
    }
    migratedCount++;
  }

  return migratedCount;
};

// ──────────────────────────────────────────────────
// FULL SYNC — PUSH ALL LOCAL TO CLOUD (AWAITED)
// ──────────────────────────────────────────────────

/**
 * Pushes ALL local bills to Firebase. AWAITS every write.
 * No bill is left behind. Called after migration to ensure cloud is complete.
 */
/**
 * Pushes any locally unsynced bills to Firebase.
 * Returns the number of successful syncs and any error message.
 */
export const syncLocalBillsToFirebase = async (): Promise<{ success: number; total: number; error?: string }> => {
  if (!isFirebaseConfigured || !firestore) return { success: 0, total: 0, error: "Firebase not configured" };
  
  const allBills: BillRecord[] = [];
  await billsDB.iterate((value: BillRecord) => {
    if (value.isSynced !== true) {
      allBills.push(value);
    }
  });
  
  if (allBills.length === 0) return { success: 0, total: 0 };
  
  let successCount = 0;
  let lastError = "";

  for (const bill of allBills) {
    try {
      const flatId = bill.id.replace(/\//g, '_');
      const sanitized = sanitizeForFirestore({ ...bill, isSynced: true });
      await setDoc(doc(firestore, "bills", flatId), sanitized);
      await billsDB.setItem(bill.id, { ...bill, isSynced: true });
      successCount++;
    } catch (e: any) {
      console.error(`[SYNC] Failed to sync ${bill.id}:`, e);
      lastError = e.message || String(e);
    }
  }
  
  return { 
    success: successCount, 
    total: allBills.length, 
    error: lastError || undefined 
  };
};

// ──────────────────────────────────────────────────
// NOTIFICATION SYNC — SYNC PINGS
// ──────────────────────────────────────────────────

/**
 * Sends a tiny ping to Firestore to notify other devices of a new bill.
 */
export const sendSyncPing = async (billId: string, customerName: string) => {
  if (!isFirebaseConfigured || !firestore) return;
  try {
    const pingId = `ping_${Date.now()}`;
    await setDoc(doc(firestore, "sync_pings", pingId), {
      billId,
      customerName,
      timestamp: Date.now(),
      senderId: sessionId
    });
    console.log(`[PING] Sent sync notification for ${billId}`);
  } catch (e) {
    console.warn("[PING] Failed to send sync notification:", e);
  }
};

/**
 * Listens for pings from OTHER devices and triggers a callback.
 */
export const subscribeToSyncPings = (onNewPing: (billId: string, customerName: string) => void) => {
  if (!isFirebaseConfigured || !firestore) return () => {};

  const q = query(
    collection(firestore, "sync_pings"),
    orderBy("timestamp", "desc"),
    limit(1)
  );

  let initialLoad = true;
  return onSnapshot(q, (snapshot) => {
    if (initialLoad) {
      initialLoad = false;
      return;
    }

    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        const data = change.doc.data();
        // ONLY notify if it came from someone else
        if (data.senderId !== sessionId) {
          onNewPing(data.billId, data.customerName);
        }
      }
    });
  });
};
