import { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Capacitor } from '@capacitor/core';
import { BarcodeScanner, BarcodeFormat, Resolution } from '@capacitor-mlkit/barcode-scanning';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { createWorker } from 'tesseract.js';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

import { saveBill, saveDraft, clearDraft, getNextSequenceForDate, checkIsViewerMode, deleteBill, type Product, type AuditLog } from '../utils/db';
import type { BillRecord } from '../utils/db';
import { generatePDFBlob } from '../utils/pdfGenerator';
import { useAlert } from '../context/AlertContext';
import { useAuth } from '../context/AuthContext';
import { clearDashboardSession, getDashboardSession } from '../utils/session';
import BarcodeOverlay from '../components/BarcodeOverlay';
import BillViewer from '../components/BillViewer';
import { parseExcelFile, parsePDFFile, type ParsedBillData } from '../utils/importParser';
import { ImportPreviewModal } from '../components/ImportPreviewModal';


export default function CreateBill({ direction }: { direction: number }) {
  const { showAlert, showConfirm } = useAlert();
  const location = useLocation();

  // Scroll to top on mount to ensure bill opens from the very top
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  const editingBill = location.state?.billToEdit as BillRecord | undefined;

  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showBackWarning, setShowBackWarning] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const isReadOnly = location.state?.isViewOnly || checkIsViewerMode();
  const [remarks, setRemarks] = useState(editingBill?.remarks || '');
  const [showRemarks, setShowRemarks] = useState(!!editingBill?.remarks);
  const productRefs = useRef<Record<string, HTMLElement | null>>({});
  const [isScanning, setIsScanning] = useState<{ productId: string; index: number } | null>(null);
  const [isScanningModel, setIsScanningModel] = useState<{ productId: string } | null>(null);

  // Customer Name Modal State
  const [customerName, setCustomerName] = useState(editingBill?.customerName || '');
  const [showCustomerModal, setShowCustomerModal] = useState(!editingBill);
  const [logs, setLogs] = useState<AuditLog[]>(editingBill?.logs || []);
  const [tempCustomerName, setTempCustomerName] = useState(editingBill?.customerName || '');
  const [showCustomerBackWarning, setShowCustomerBackWarning] = useState(false);
  const [clientPhoneNumber, setClientPhoneNumber] = useState(editingBill?.clientPhoneNumber || '');
  const [tempClientPhone, setTempClientPhone] = useState(editingBill?.clientPhoneNumber || '');
  const { currentUser } = useAuth();
  const [isScannerActive, setIsScannerActive] = useState(false);
  const [activeMediaStream, setActiveMediaStream] = useState<MediaStream | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  
  // Cropping State
  const [croppingImage, setCroppingImage] = useState<string | null>(null);
  const [croppingContext, setCroppingContext] = useState<{ productId: string; index: number | 'MODEL' } | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [isProcessingCrop, setIsProcessingCrop] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const scrollPosRef = useRef(0);
  const workerRef = useRef<any>(null);
  const [scanProgress, setScanProgress] = useState(0);
  const scanStartTimeRef = useRef(0);
  const [isSaving, setIsSaving] = useState(false);
  
  // Data Import State
  const [parsedImportData, setParsedImportData] = useState<ParsedBillData | null>(null);
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeScan = isScanning || isScanningModel;

  const scrollSession = getDashboardSession();
  const isRestoring = scrollSession.scrollY != null && scrollSession.scrollY >= 0;

  // SCROLL RESTORATION LOGIC
  useEffect(() => {
    if (!activeScan) {
      // Restore position after scanner closes
      const timer = setTimeout(() => {
        if (scrollPosRef.current > 0) {
          window.scrollTo({
            top: scrollPosRef.current,
            behavior: 'instant' as ScrollBehavior
          });
        }
      }, 150); // Increased delay for Android keyboard/UI stability
      return () => clearTimeout(timer);
    }
  }, [activeScan]);


  const [products, setProducts] = useState<Product[]>(() => {
    // Attempt to restore from location state (draft or edit) immediately during initialization
    const recoveredDraft = location.state?.restoredDraft;
    if (recoveredDraft) return recoveredDraft.products;

    if (!editingBill) return [{
      id: crypto.randomUUID(),
      name: '',
      quantity: '',
      model: '',
      description: '',
      hasSerials: true,
      serialNumbers: [],
      isRemoved: false,
      isAdded: false,
      addedAt: Date.now(),
    }];

    return editingBill.products.map(p => ({
      ...p,
      id: p.id || crypto.randomUUID(),
      hasSerials: typeof p.hasSerials === 'boolean' ? p.hasSerials : (p.serialNumbers?.length > 0),
      serialNumbers: p.serialNumbers || [],
      isRemoved: p.isRemoved || false,
      isAdded: p.isAdded || false,
      addedAt: p.addedAt || Date.now(),
    }));
  });

  // BASILINE STATE: Capture the exact state on load to ensure isDirty works reliably
  const [initialProducts] = useState(products);
  const [initialCustomerName] = useState(location.state?.restoredDraft?.customerName || editingBill?.customerName || '');
  const [initialRemarks] = useState(location.state?.restoredDraft?.remarks || editingBill?.remarks || '');

  const isDirty = useMemo(() => {
    // A brand new bill (not from draft) uses "has content" logic
    if (!editingBill && !location.state?.restoredDraft) {
      const hasContent = customerName.trim() !== '' || 
                        remarks.trim() !== '' ||
                        products.length > 1 || 
                        (products.length === 1 && (products[0].name.trim() !== '' || products[0].model.trim() !== '' || products[0].serialNumbers.length > 0));
      return hasContent;
    }
    
    // Edits or restored drafts compare against the baseline state
    const productsChanged = JSON.stringify(products) !== JSON.stringify(initialProducts);
    const customerChanged = customerName !== initialCustomerName;
    const remarksChanged = remarks !== initialRemarks;

    return productsChanged || customerChanged || remarksChanged;
  }, [products, initialProducts, customerName, initialCustomerName, remarks, initialRemarks, editingBill]);

  // If the bill is no longer dirty (e.g., added and then removed a mistake), clear the draft
  useEffect(() => {
    if (!isDirty && !isReadOnly) {
      clearDraft();
    }
  }, [isDirty, isReadOnly]);

  // Sync state ONLY if editingBill actually changes (unlikely during mount, but safe for HMR)
  useEffect(() => {
    if (editingBill) {
      setProducts(editingBill.products.map(p => ({
        ...p,
        id: p.id || crypto.randomUUID(),
        hasSerials: typeof p.hasSerials === 'boolean' ? p.hasSerials : (p.serialNumbers?.length > 0),
        serialNumbers: p.serialNumbers || [],
        isRemoved: p.isRemoved || false,
        isAdded: p.isAdded || false,
        addedAt: p.addedAt || Date.now(),
      })));
      
      if (!isReadOnly) {
        setLogs([...(editingBill.logs || []), { action: 'Edit Session Started', timestamp: Date.now() }]);
      } else {
        setLogs(editingBill.logs || []);
      }
    }
  }, [editingBill, isReadOnly]);

  // CRITICAL: Cleanup scanner on unmount (back swipe, navigation, etc.)
  useEffect(() => {
    return () => {
      BarcodeScanner.stopScan().catch(() => {});
      BarcodeScanner.removeAllListeners().catch(() => {});
      document.documentElement.classList.remove('scanner-active');
      document.body.classList.remove('scanner-active');
      delete (window as any).isScannerActive;
      delete (window as any).stopScanner;
    };
  }, []);

  // OCR WORKER LIFECYCLE
  const initOCRWorker = async () => {
    if (workerRef.current) return;
    try {
      const worker = await createWorker('eng', 1);
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/. ',
        tessedit_pageseg_mode: '7' as any, // Treat as single text line (High Accuracy for labels)
        tessjs_create_hocr: '0',
        tessjs_create_tsv: '0',
      });
      workerRef.current = worker;
    } catch (err) {
      console.error("Failed to init OCR worker:", err);
    }
  };

  // ─────────────────────────────────────────────
  // IMPORT DATA HANDLERS (Excel / PDF)
  // ─────────────────────────────────────────────
  const handleTriggerImport = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase();
      let parsed: ParsedBillData;

      if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
        parsed = await parseExcelFile(file);
      } else if (ext === 'pdf') {
        parsed = await parsePDFFile(file);
      } else {
        showAlert({
          title: 'Unsupported File',
          message: 'Please select an Excel (.xlsx, .xls, .csv) or PDF (.pdf) file.',
          type: 'warning',
        });
        setIsImporting(false);
        return;
      }

      setParsedImportData(parsed);
      setShowImportPreview(true);
    } catch (err: any) {
      showAlert({
        title: 'Import Failed',
        message: err.message || 'Could not parse the selected file. Please check the document format.',
        type: 'error',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleConfirmImport = (confirmed: ParsedBillData) => {
    setCustomerName(confirmed.customerName);
    setTempCustomerName(confirmed.customerName);
    setClientPhoneNumber(confirmed.clientPhoneNumber);
    setTempClientPhone(confirmed.clientPhoneNumber);
    setProducts(confirmed.products);
    if (confirmed.remarks) {
      setRemarks(confirmed.remarks);
      setShowRemarks(true);
    }
    setShowCustomerModal(false);
    setShowImportPreview(false);
    setIsMenuOpen(false);
    showAlert({
      title: 'Bill Populated',
      message: `Successfully loaded ${confirmed.products.length} product(s) from ${confirmed.sourceFileName}.`,
      type: 'success',
    });
  };

  useEffect(() => {
    // Lazy init worker when scanner opens to save startup time
    if (activeScan) {
      initOCRWorker();
    }
  }, [activeScan]);

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  // Handle State Exposure to Global BackButtonHandler
  useEffect(() => {
    (window as any).isBillDirty = isDirty;
    (window as any).showCustomerModal = showCustomerModal;
    (window as any).triggerBillBackWarning = () => setShowBackWarning(true);
    (window as any).triggerCustomerBackWarning = () => setShowCustomerBackWarning(true);

    return () => {
      delete (window as any).isBillDirty;
      delete (window as any).showCustomerModal;
      delete (window as any).triggerBillBackWarning;
      delete (window as any).triggerCustomerBackWarning;
    };
  }, [isDirty, showCustomerModal]);

  // AUTO-SAVE DRAFT
  useEffect(() => {
    if (!isDirty || isSaving || isReadOnly) return;
    
    const draftData = {
      products,
      customerName,
      editingBillId: editingBill?.id
    };
    
    const timer = setTimeout(() => {
      if (!isSaving) {
        saveDraft(draftData);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [products, customerName, isDirty, editingBill, isReadOnly, isSaving]);

  // Sync additional fields from draft if present
  useEffect(() => {
    const recoveredDraft = location.state?.restoredDraft;
    if (recoveredDraft) {
      setCustomerName(recoveredDraft.customerName || '');
      // Clear state once loaded to avoid re-triggering on future renders
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Removed legacy alert-on-mount logic

  const handleInterceptBack = () => {
    if (isReadOnly) {
      navigate(-1);
    } else if (isDirty) {
      setShowBackWarning(true);
    } else {
      if (!editingBill) clearDashboardSession();
      navigate(-1);
    }
  };

  const variants = {
    initial: (direction: number) => ({
      opacity: 0,
      x: direction > 0 ? 25 : direction < 0 ? -25 : 0,
      filter: 'blur(8px)'
    }),
    animate: {
      opacity: 1,
      x: 0,
      filter: 'blur(0px)'
    },
    exit: (direction: number) => ({
      opacity: 0,
      x: direction > 0 ? -20 : direction < 0 ? 20 : 0,
      filter: 'blur(6px)'
    })
  };

  const handleAddProduct = () => {
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID) 
      ? crypto.randomUUID() 
      : `p-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    setProducts(prev => [
      ...prev,
      {
        id,
        name: '',
        quantity: '',
        model: '',
        description: '',
        hasSerials: true,
        serialNumbers: [],
        isRemoved: false,
        isAdded: !!editingBill,
        addedAt: Date.now(),
      }
    ]);
    if (editingBill) {
      addLog(`Product Added: (New Product)`, id, 'product');
    }
  };

  const addLog = (action: string, targetId?: string, targetType?: 'product' | 'serial') => {
    setLogs(prev => [...prev, { action, timestamp: Date.now(), targetId, targetType }]);
  };

  const handleRemoveProduct = (id: string, name: string) => {
    if (!editingBill) {
      // First creation: physically remove from array
      setProducts(prev => prev.filter(p => p.id !== id));
    } else {
      // Editing: check if it's a new product added in THIS session
      const originalProduct = editingBill.products.find(p => p.id === id);
      const isNewToSession = !originalProduct;

      if (isNewToSession) {
        // Just added now, so remove completely
        setProducts(prev => prev.filter(p => p.id !== id));
      } else {
        // Previously saved, so soft-delete (mark as removed)
        setProducts(prev => prev.map(p => {
          if (p.id !== id) return p;
          return { ...p, isRemoved: true, removedAt: Date.now() };
        }));
        addLog(`Product Removed: ${name || '(Unnamed)'}`, id, 'product');
      }
    }
  };

  const handleQuantityStep = (id: string, delta: number) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const currentQty = typeof p.quantity === 'number' ? p.quantity : 0;
      const newQty = Math.max(0, currentQty + delta);
      if (newQty === currentQty) return p;

      let newSerials = [...p.serialNumbers];

      if (p.hasSerials) {
        if (newQty > newSerials.length) {
          const toAdd = newQty - newSerials.length;
          const addedSerials = Array(toAdd).fill(null).map(() => ({
            value: '',
            isRemoved: false,
            isAdded: !!editingBill,
            timestamp: Date.now()
          }));
          newSerials = newSerials.concat(addedSerials);
        } else if (newQty < newSerials.length) {
          if (!editingBill) {
            // First creation: physically slice extra serials
            newSerials = newSerials.slice(0, newQty);
          } else {
            // Editing: mark as removed
            let removedCount = 0;
            const targetToRemove = newSerials.length - newQty;
            newSerials = newSerials.map((sn) => {
              if (!sn.isRemoved && removedCount < targetToRemove) {
                removedCount++;
                return { ...sn, isRemoved: true, timestamp: Date.now() };
              }
              return sn;
            });
          }
        }
      }

      return { ...p, quantity: newQty, serialNumbers: newSerials };
    }));
  };

  const updateProduct = (id: string, field: keyof Product, value: any) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== id) return p;

      let val = value;
      if (field === 'model' && typeof value === 'string') {
        val = value.toUpperCase();
      }

      let updatedProduct = { ...p, [field]: val };
      
      // If quantity updates manually (fallback if typing exists), adjust serialNumbers array length
      if (field === 'quantity') {
        const qty = val === '' ? 0 : parseInt(val, 10);
        
        let newSerials = [...p.serialNumbers];
        if (p.hasSerials) {
          if (qty > newSerials.length) {
            const toAdd = qty - newSerials.length;
            const addedSerials = Array(toAdd).fill(null).map(() => ({
              value: '',
              isRemoved: false,
              isAdded: !!editingBill,
              timestamp: Date.now()
            }));
            newSerials = newSerials.concat(addedSerials);
          } else if (qty < newSerials.length) {
            if (!editingBill) {
              // First creation: physically slice extra serials
              newSerials = newSerials.slice(0, qty);
            } else {
              // Editing: mark as removed
              let removedCount = 0;
              const targetToRemove = newSerials.length - qty;
              for (let i = newSerials.length - 1; i >= 0 && removedCount < targetToRemove; i--) {
                if (!newSerials[i].isRemoved) {
                  newSerials[i] = { ...newSerials[i], isRemoved: true, timestamp: Date.now() };
                  removedCount++;
                }
              }
            }
          }
        }
        updatedProduct.serialNumbers = newSerials;
      }
      return updatedProduct;
    }));
  };

  const handleToggleSerials = (id: string, toggle: boolean) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const qty = typeof p.quantity === 'number' ? p.quantity : 0;
      let newSerials = toggle ? Array(qty).fill(null).map(() => ({
        value: '',
        isRemoved: false,
        isAdded: !!editingBill,
        timestamp: Date.now()
      })) : [];
      return { ...p, hasSerials: toggle, serialNumbers: newSerials };
    }));
  };

  const updateSerialNumber = (productId: string, index: number, value: string) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== productId) return p;
      const newSerials = [...p.serialNumbers];
      newSerials[index] = { 
        ...newSerials[index], 
        value: value.toUpperCase(),
        timestamp: Date.now()
      };
      return { ...p, serialNumbers: newSerials };
    }));
  };

  const handleRemoveSerialNumber = (productId: string, index: number, value: string) => {
    if (!editingBill) {
      // First creation: physically remove from array
      setProducts(prev => prev.map(p => {
        if (p.id !== productId) return p;
        const newSerials = p.serialNumbers.filter((_, i) => i !== index);
        return { ...p, serialNumbers: newSerials, quantity: newSerials.length };
      }));
    } else {
      // Editing: check if this serial entry existed in the original bill
      const originalProduct = editingBill.products.find(p => p.id === productId);
      // A serial is new if the product itself is new, or if the index is beyond original serials
      const isNewToSession = !originalProduct || index >= originalProduct.serialNumbers.length;

      if (isNewToSession) {
        // Just added now, so remove completely
        setProducts(prev => prev.map(p => {
          if (p.id !== productId) return p;
          const newSerials = p.serialNumbers.filter((_, i) => i !== index);
          // Only update quantity if it wasn't manually set (though usually serials set qty)
          return { ...p, serialNumbers: newSerials, quantity: p.hasSerials ? newSerials.filter(sn => !sn.isRemoved).length : p.quantity };
        }));
      } else {
        // Previously saved, so soft-delete
        setProducts(prev => prev.map(p => {
          if (p.id !== productId) return p;
          const newSerials = [...p.serialNumbers];
          newSerials[index] = { 
            ...newSerials[index], 
            isRemoved: true, 
            timestamp: Date.now() 
          };
          return { ...p, serialNumbers: newSerials };
        }));
        const product = products.find(p => p.id === productId);
        addLog(`Serial Removed: ${value || '(Empty)'} from ${product?.name || 'Product'}`, productId, 'serial');
      }
    }
  };

  const stopAndCleanScanner = async () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    
    try {
      // 1. Reset scanner active state to trigger UI fade-outs
      setIsScannerActive(false);
      
      // 2. Stop persistent media stream if active (BROWSER CAMERA)
      if (activeMediaStream) {
        activeMediaStream.getTracks().forEach(track => {
          track.stop();
          track.enabled = false;
        });
        setActiveMediaStream(null);
      }

      // 3. Stop native scanner engine (NATIVE HARDWARE)
      // We must await this sequentially on some Android devices to prevent lockup
      await BarcodeScanner.stopScan().catch(() => {});
      await BarcodeScanner.removeAllListeners().catch(() => {});
      
      // 4. Clean up global UI markers
      document.documentElement.classList.remove('scanner-active');
      document.body.classList.remove('scanner-active');
      
      // 5. Final state reset
      setIsScanning(null);
      setIsScanningModel(null);
    } finally {
      setIsTransitioning(false);
    }
  };

  const startBarcodeScanner = async (onResult: (value: string) => void) => {
    if (!Capacitor.isNativePlatform()) {
      const fakeSns = ["SN-999-XYZ", "SN-888-ABC", "CODE128-001"];
      const r_sn = fakeSns[Math.floor(Math.random() * fakeSns.length)];
      const simulatedScan = window.prompt("SIMULATION MODE: Enter barcode value", r_sn);
      if (simulatedScan) onResult(simulatedScan);
      return;
    }

    const ALL_FORMATS = [
      BarcodeFormat.Code128,
      BarcodeFormat.Code39,
      BarcodeFormat.Code93,
      BarcodeFormat.Codabar,
      BarcodeFormat.Ean13,
      BarcodeFormat.Ean8,
      BarcodeFormat.Itf,
      BarcodeFormat.UpcA,
      BarcodeFormat.UpcE,
      BarcodeFormat.Pdf417,
      BarcodeFormat.Aztec,
      BarcodeFormat.DataMatrix,
      BarcodeFormat.QrCode
    ];

    try {
      // CRITICAL: Force a preliminary stop to clear any stale hardware sessions
      await BarcodeScanner.stopScan().catch(() => {});

      const { camera } = await BarcodeScanner.requestPermissions();
      if (camera !== 'granted' && camera !== 'limited') {
        showAlert({ title: "Permission Denied", message: "Camera permission is required to scan barcodes.", type: 'error' });
        return;
      }

      document.documentElement.classList.add('scanner-active');
      document.body.classList.add('scanner-active');

      // The user prefers the default zoom levels.
      try {
        await BarcodeScanner.setZoomRatio({ zoomRatio: 1.0 });
      } catch (zoomErr) {
        console.warn("Zoom reset not supported", zoomErr);
      }

      // RECORD START TIME FOR 2S ALIGNMENT DELAY
      scanStartTimeRef.current = Date.now();

      const listener = await BarcodeScanner.addListener('barcodesScanned', async (event: any) => {
        const now = Date.now();
        const elapsed = now - scanStartTimeRef.current;

        if (event.barcodes && event.barcodes.length > 0) {
           // 1. FAST ALIGNMENT WINDOW (800ms)
           if (elapsed < 800) {
             setScanProgress((elapsed / 800) * 100);
             return;
           }
           setScanProgress(0);

           // 2. HIGH-SENSITIVITY ROI (20% Wide Belt)
           // Viewfinder is 40px visual, but we listen to a larger buffer for reliability.
           const validBarcodes = event.barcodes.filter((bc: any) => {
             if (!bc.cornerPoints) return false;
             const p = bc.cornerPoints;
             const cx = (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4;
             const cy = (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4;
             
             const normX = cx / 1080;
             const normY = cy / 1920;
             // 20% vertical belt centered on the razor line
             return normY > 0.40 && normY < 0.60 && normX > 0.05 && normX < 0.95;
           });

           if (validBarcodes.length === 0) return;

           // 3. PROXIMITY SNAP -> Instant Capture
           // Always pick the one closest to absolute center of sensor
           let targetBarcode = validBarcodes[0];
           if (validBarcodes.length > 1) {
             let minCenterDist = Infinity;
             validBarcodes.forEach((bc: any) => {
               const p = bc.cornerPoints;
               const cx = (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4;
               const cy = (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4;
               const dist = Math.sqrt(Math.pow(cx - 540, 2) + Math.pow(cy - 960, 2));
               if (dist < minCenterDist) {
                 minCenterDist = dist;
                 targetBarcode = bc;
               }
             });
           }

           const val = targetBarcode.displayValue;
           if (!val) return;

           // SUCCESS: INSTANT SNAP
           await listener.remove();
           await stopAndCleanScanner();
           
           await Haptics.impact({ style: ImpactStyle.Heavy });
           onResult(val);
        } else {
          if (elapsed < 800) {
            setScanProgress((elapsed / 800) * 100);
          } else {
            setScanProgress(0);
          }
        }
      });

      await BarcodeScanner.startScan({
        formats: ALL_FORMATS,
        resolution: Resolution['1920x1080']
      });
    } catch (e) {
      console.error("Barcode Initialization Error:", e);
      setIsScannerActive(false);
      setIsTransitioning(false);
      showAlert({ title: "Scan Error", message: "Hardware busy. Please wait a moment and try again.", type: 'error' });
    }
  };

  const startPreviewStream = async () => {
    try {
      const constraints = {
        video: { 
          facingMode: { ideal: 'environment' },
          aspectRatio: { ideal: 1.7777777778 }, // 16:9
          width: { ideal: 4096 }, // Request 4K
          height: { ideal: 2160 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = stream.getVideoTracks()[0];

      // ADVANCED MACRO FOCUS & PERFORMANCE
      if (track && track.getCapabilities) {
        const capabilities = track.getCapabilities() as any;
        const advanced: any = {};
        
        // 1. Try to enable continuous focus or manual focus at min distance for macro
        if (capabilities.focusMode) {
          if (capabilities.focusMode.includes('continuous')) {
            advanced.focusMode = 'continuous';
          }
        }
        
        // 2. Set focus distance to minimum if supported (Macro support)
        if (capabilities.focusDistance) {
          // Setting it to a very small value helps for close up OCR
          advanced.focusDistance = capabilities.focusDistance.min;
        }

        if (Object.keys(advanced).length > 0) {
          try {
            await track.applyConstraints({ advanced: [advanced] });
          } catch (err) {
            console.warn("Could not apply advanced camera constraints:", err);
          }
        }
      }

      setActiveMediaStream(stream);
    } catch (err) {
      console.error("Error starting preview stream:", err);
    }
  };

  const handleScan = async (productId: string, index: number) => {
    scrollPosRef.current = window.scrollY;
    setIsScanning({ productId, index });
    await startPreviewStream();
  };

  const handleScanModel = async (productId: string) => {
    scrollPosRef.current = window.scrollY;
    setIsScanningModel({ productId });
    await startPreviewStream();
  };

  const preprocessImageForOCR = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    const { width, height } = canvas;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    
    // Step 1: Grayscale + Optimized Contrast (Balanced for OCR)
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i+1];
      const b = data[i+2];
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      
      // Increased contrast but not extreme (1.4 instead of 1.8)
      // This preserves text detail and doesn't black out dark-ish photos.
      const contrast = 1.4; 
      let val = (gray - 128) * contrast + 128;
      
      // Soft thresholding / Linear contrast stretch
      val = Math.max(0, Math.min(255, val));
      
      data[i] = data[i+1] = data[i+2] = val;
    }
    
    ctx.putImageData(imageData, 0, 0);
  };

  const performOCR = async (image: string): Promise<string> => {
    try {
      if (!workerRef.current) {
        await initOCRWorker();
      }
      
      const worker = workerRef.current;
      if (!worker) throw new Error("Worker failed to init");

      const { data: { text, confidence } } = await worker.recognize(image);
      
      // CLEANUP & VALIDATION
      const cleaned = text.trim().replace(/[\r\n\t]+/g, ' ').replace(/\s\s+/g, ' ');
      
      console.log(`OCR Result (Conf: ${confidence}):`, cleaned);

      // Low confidence guard: if confidence < 60, its likely junk
      if (confidence < 60 && cleaned.length < 3) return "";
      
      return cleaned;
    } catch (e) {
      console.error("OCR Error:", e);
      throw e;
    }
  };

  const handleIntegratedCapture = async (productId: string, index: number | 'MODEL') => {
    try {
      if (!activeMediaStream) return;
      
      const video = document.createElement('video');
      video.srcObject = activeMediaStream;
      await video.play();

      const canvas = document.createElement('canvas');
      // Capture at exactly the sensor output size (1080p)
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95); 
      
      setCroppingImage(dataUrl);
      setCroppingContext({ productId, index });
      
      // Stop scanner feed while cropping to save resources
      await stopAndCleanScanner();
      await Haptics.impact({ style: ImpactStyle.Medium });
      
    } catch (err) {
      console.error("Inbuilt Capture error:", err);
      showAlert({ title: "Camera Error", message: "Could not capture image from stream.", type: 'error' });
    }
  };

  const handleApplyCrop = async () => {
    if (!completedCrop || !croppingImage || !croppingContext || !imgRef.current) return;
    
    setIsProcessingCrop(true);
    try {
      const image = imgRef.current;
      const canvas = document.createElement('canvas');
      const scaleX = image.naturalWidth / image.width;
      const scaleY = image.naturalHeight / image.height;
      
      // MODERATE UPSCALE
      // 2x is usually enough for 1080p source and much faster/lighter than 3x.
      const upscaleFactor = 2.0;
      canvas.width = (completedCrop.width * scaleX) * upscaleFactor;
      canvas.height = (completedCrop.height * scaleY) * upscaleFactor;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      // IMPROVED OCR FILTER: Less aggressive contrast, added slight sharpen/threshold feel
      // High contrast (300) often destroys thin font features. 180-200 is safer.
      ctx.filter = 'grayscale(100%) contrast(180%) brightness(110%)';

      ctx.drawImage(
        image,
        completedCrop.x * scaleX,
        completedCrop.y * scaleY,
        completedCrop.width * scaleX,
        completedCrop.height * scaleY,
        0,
        0,
        canvas.width,
        canvas.height
      );

      // APPLY ADVANCED BITMAP PRE-PROCESSING
      preprocessImageForOCR(canvas);

      const croppedBase64 = canvas.toDataURL('image/jpeg', 0.90);
      const { productId, index } = croppingContext;

      // AWAIT OCR SO LOADING STATE PERSISTS
      const text = await performOCR(croppedBase64);
      
      if (text) {
        if (index === 'MODEL') {
          updateProduct(productId, 'model', text);
        } else {
          updateSerialNumber(productId, index as number, text);
        }
        await Haptics.impact({ style: ImpactStyle.Light });
      } else {
        showAlert({ title: "OCR Failed", message: "No legible text found in the selected area. Try zooming in or improving lighting.", type: 'warning' });
      }

      // Cleanup
      setCroppingImage(null);
      setCroppingContext(null);
      setCrop(undefined);
      setCompletedCrop(undefined);
    } catch (e) {
      console.error("Crop/OCR Error:", e);
      showAlert({ title: "Extraction Error", message: "Failed to process the image. Please try again with a clearer angle.", type: 'error' });
    } finally {
      setIsProcessingCrop(false);
    }
  };

  const handleTakeSerialPhoto = async (productId: string, index: number | 'MODEL') => {
    // We now prefer integrated capture to stay in-app
    await handleIntegratedCapture(productId, index);
  };

  const handleClearEntries = () => {
    showConfirm("Are you sure you want to clear all data? This cannot be undone.", async () => {
      setProducts([{ 
        id: crypto.randomUUID(), 
        name: '', 
        quantity: '', 
        model: '', 
        description: '', 
        hasSerials: true, 
        serialNumbers: [],
        isRemoved: false,
        isAdded: false,
        addedAt: Date.now(),
      }]);
      setCustomerName('');
      await clearDraft();
      setIsMenuOpen(false);
    }, 'Clear All Data');
  };



  const triggerSave = async (type: 'SAVE' | 'SHARE' | 'DOWNLOAD') => {
    if (isSaving) return;
    setIsSaving(true);
    
    try {
      // Basic validation
      const errors: string[] = [];
      products.forEach((p, idx) => {
        const pErrors: string[] = [];
        if (!p.name.trim()) pErrors.push("Name");
        if (!p.model.trim()) pErrors.push("Model No.");
        if (p.quantity === '' || p.quantity <= 0) pErrors.push("Quantity");
        
        if (pErrors.length > 0) {
          errors.push(`Product ${idx + 1}: Missing ${pErrors.join(", ")}`);
        }
      });

      if (errors.length > 0 || products.length === 0) {
        const msg = products.length === 0 ? "Please add at least one product." : errors.join("\n");
        showAlert({ title: "Check Fields", message: msg, type: 'warning' });
        setIsSaving(false);
        return;
      }

      const totalQty = products.reduce((sum, p) => {
        if (p.isRemoved) return sum;
        const qty = p.hasSerials ? p.serialNumbers.filter(sn => !sn.isRemoved).length : (typeof p.quantity === 'number' ? p.quantity : 0);
        return sum + qty;
      }, 0);
      
      // 1. Create DB Record
      const date = new Date();
      
      let id = editingBill?.id || '';
      let sequenceNumber = editingBill?.sequenceNumber || 0;
      
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      
      const dateString = `${year}/${month}/${day}`;
      const timeString = `${hours}:${minutes}`;

      if (!editingBill) {
        sequenceNumber = await getNextSequenceForDate(dateString);
        id = `${dateString}-${timeString}-${sequenceNumber}`;
      }

      const billRecord: BillRecord = {
        id,
        sequenceNumber,
        customerName,
        timestamp: editingBill ? editingBill.timestamp : date.getTime(), // keep original sorting time if edit
        dateString: editingBill ? editingBill.dateString : dateString,
        timeString: editingBill ? (editingBill.timeString || "00:00") : timeString,
        products: products.map(p => ({
          ...p,
          quantity: p.hasSerials ? p.serialNumbers.filter(sn => !sn.isRemoved).length : p.quantity
        })),
        totalQuantity: totalQty,
        isViewed: editingBill ? (editingBill.isViewed ?? false) : false,
        remarks: remarks.trim() || undefined,
        logs: editingBill ? logs.filter((log, idx, arr) => {
          if (log.action === 'Edit Session Started') {
            const nextLog = arr[idx + 1];
            if (!nextLog || nextLog.action === 'Edit Session Started' || nextLog.action === 'Bill Created') return false;
          }
          return true;
        }) : [{ action: 'Bill Created', timestamp: Date.now() }],
        createdByUserId: editingBill?.createdByUserId || currentUser?.uid || undefined,
        clientPhoneNumber: clientPhoneNumber.replace(/[\s\-()]/g, '') || undefined,
        adminId: editingBill?.adminId || (currentUser?.role === 'admin' ? currentUser.uid : (currentUser as any)?.adminId) || currentUser?.uid || undefined,
        adminPhone: editingBill?.adminPhone || (currentUser?.role === 'admin' ? currentUser.phoneNumber : undefined),
        businessName: editingBill?.businessName || currentUser?.businessName || undefined,
      };

      // 2. Save locally to localforage
      await saveBill(billRecord);
      await clearDraft(); // Clear draft on success

      // 3. Generate PDF Base64
      const pdfBase64 = await generatePDFBlob(billRecord);
      const safeId = id.replace(/\//g, '_');
      const fileName = `${safeId}.pdf`;

      if (Capacitor.isNativePlatform()) {
        // ALWAYS Save to permanent Documents folder (silent)
        try {
          await Filesystem.writeFile({
            path: fileName,
            data: pdfBase64,
            directory: Directory.Documents,
          });
          // Show alert ONLY if it's a silent save (SAVE type)
          if (type === 'SAVE') {
            showAlert({ title: "Bill Saved", message: `PDF automatically stored in Documents/${fileName}`, type: 'success' });
          }
        } catch (saveErr) {
          console.warn("Silent save to Documents failed", saveErr);
        }

        if (type === 'SAVE') {
          if (!editingBill) clearDashboardSession();
          navigate(location.state?.fromDaybook ? '/daybook' : '/', { replace: true });
          return;
        }

        // Use a consistent temp path for sharing to avoid pathing issues
        const sharePath = `share_${fileName}`;
        const cachedFile = await Filesystem.writeFile({
          path: sharePath,
          data: pdfBase64,
          directory: Directory.Cache,
        });

        // Small delay to ensure OS handles the file handle
        await new Promise(r => setTimeout(r, 150));

        await Share.share({
          title: `Bill ${id.split('-').join(' - ')}`,
          text: `Bill Details\nBill No: ${id.split('-').join(' - ')}\nCustomer: ${customerName || 'N/A'}`,
          url: cachedFile.uri,
          dialogTitle: 'Share Bill',
        });
        navigate('/', { replace: true });

      } else {
        // Browser download fallback
        const link = document.createElement('a');
        link.href = `data:application/pdf;base64,${pdfBase64}`;
        link.download = fileName;
        link.click();
        if (!editingBill) clearDashboardSession();
        navigate(location.state?.fromDaybook ? '/daybook' : '/', { replace: true });
      }

    } catch (e) {
      console.error(e);
      showAlert({ title: "Save Error", message: "An unexpected error occurred while saving or sharing the bill.", type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteBill = async () => {
    if (!editingBill || isReadOnly || currentUser?.role !== 'admin') return;
    setIsMenuOpen(false);
    
    showConfirm(
      `Are you sure you want to delete bill ${editingBill.id}? This will remove it from this device and the cloud.`,
      async () => {
        try {
          setIsSaving(true);
          await deleteBill(editingBill.id);
          await clearDraft();
          showAlert({ title: "Deleted", message: "Bill has been permanently removed.", type: 'success' });
          clearDashboardSession();
          navigate(location.state?.fromDaybook ? '/daybook' : '/', { replace: true });
        } catch (_err) {
          showAlert({ title: "Error", message: "Failed to delete bill.", type: 'error' });
        } finally {
          setIsSaving(false);
        }
      },
      "Delete Bill"
    );
  };

  const isDateExpired = useMemo(() => {
    if (!editingBill) return false;
    const now = new Date();
    const today = `${now.getFullYear()}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')}`;
    return today !== editingBill.dateString;
  }, [editingBill]);

  useEffect(() => {
    (window as any).isScannerActive = !!activeScan;
    (window as any).stopScanner = stopAndCleanScanner;
  }, [activeScan]);

  return (
    <>
      <AnimatePresence>
        {activeScan && (
          <BarcodeOverlay 
            isScanning={isScannerActive}
            mediaStream={activeMediaStream}
            scanProgress={scanProgress}
            onCancel={stopAndCleanScanner}
            onScanClick={async () => {
              if (isTransitioning) return;
              setIsTransitioning(true);
              setIsScannerActive(true);
              
              try {
                // 1. Release the browser camera feed (OCR preview)
                if (activeMediaStream) {
                  activeMediaStream.getTracks().forEach(track => {
                    track.stop();
                  });
                  setActiveMediaStream(null);
                }

                // 2. Hardware cooling period (Wait for driver to release camera)
                await new Promise(r => setTimeout(r, 450));

                // 3. Start the Native Scanner
                if (isScanning) {
                  await startBarcodeScanner((val: string) => {
                    updateSerialNumber(isScanning.productId, isScanning.index, val);
                  });
                } else if (isScanningModel) {
                  await startBarcodeScanner((val: string) => {
                    updateProduct(isScanningModel.productId, 'model', val);
                  });
                }
              } finally {
                setIsTransitioning(false);
              }
            }}
            onCaptureClick={() => {
              const info = isScanning || isScanningModel;
              if (info) {
                handleTakeSerialPhoto(info.productId, (info as any).index ?? 'MODEL');
              }
            }}
          />
        )}
      </AnimatePresence>

    <motion.div 
      custom={direction}
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={isRestoring ? { duration: 0 } : { duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
      className={`bg-surface text-on-surface font-body antialiased min-h-screen flex flex-col pb-32 motion-root ${activeScan ? 'pointer-events-none' : ''} ${showCustomerModal ? 'blur-md brightness-75 transition-all duration-300 pointer-events-none' : ''}`}
    >

      <div className="scanner-hide flex flex-col flex-1">
        <header className="flex justify-between items-center w-full px-6 pt-10 pb-4 top-0 bg-surface-container-low flat z-40 sticky border-b border-outline-variant/10">
        <div className="flex items-center gap-4">
          <button onClick={handleInterceptBack} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container-high transition-colors active:scale-90">
            <span className="material-symbols-outlined text-primary">arrow_back</span>
          </button>
          <h1 className="text-xl font-['Manrope'] font-bold text-primary tracking-tight">
            {isReadOnly ? 'View Bill' : (editingBill ? (isDateExpired ? 'Locked Bill' : 'Edit Bill') : 'New Bill')}
          </h1>
          {isDateExpired && (
            <span className="ml-4 px-3 py-1 rounded-full bg-error/10 text-error text-[10px] font-bold uppercase tracking-widest border border-error/20 flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">lock</span>
              Date Expired
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 relative">
          {editingBill && logs.length > 0 && (
            <button
              onClick={() => setShowTimeline(true)}
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container-high transition-colors text-secondary relative"
            >
              <span className="material-symbols-outlined text-[22px]">schedule</span>
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-secondary text-on-secondary text-[8px] font-bold flex items-center justify-center">
                {logs.filter(l => l.action === 'Edit Session Started').length}
              </span>
            </button>
          )}
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)} 
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container-high transition-colors text-on-surface-variant"
          >
            <span className="material-symbols-outlined">more_vert</span>
          </button>

          <AnimatePresence>
            {isMenuOpen && (
              <>
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-40 bg-black/5" 
                  onClick={() => setIsMenuOpen(false)} 
                />
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -5 }}
                  className="absolute top-12 right-0 w-52 bg-surface-container-lowest border border-outline-variant/15 shadow-xl rounded-2xl py-2 z-50 overflow-hidden"
                >
                  {!editingBill ? (
                    <>
                      <button onClick={() => { setIsMenuOpen(false); handleTriggerImport(); }} className="w-full text-left px-4 py-3 text-sm text-on-surface hover:bg-surface-container-low flex items-center gap-3 transition-colors">
                        <span className="material-symbols-outlined text-[20px] text-primary">upload_file</span>
                        Import Data (Excel/PDF)
                      </button>
                      <button onClick={handleClearEntries} className="w-full text-left px-4 py-3 text-sm text-on-surface hover:bg-surface-container-low flex items-center gap-3 transition-colors border-t border-outline-variant/10">
                        <span className="material-symbols-outlined text-[20px]">clear_all</span>
                        Clear All Data
                      </button>
                    </>
                  ) : (
                    <>
                      {!isReadOnly && (
                        <button onClick={() => { setIsMenuOpen(false); handleTriggerImport(); }} className="w-full text-left px-4 py-3 text-sm text-on-surface hover:bg-surface-container-low flex items-center gap-3 transition-colors">
                          <span className="material-symbols-outlined text-[20px] text-primary">upload_file</span>
                          Import Data (Excel/PDF)
                        </button>
                      )}
                      {!isReadOnly && currentUser?.role === 'admin' && (
                        <button onClick={handleDeleteBill} className="w-full text-left px-4 py-3 text-sm text-error hover:bg-error/5 flex items-center gap-3 transition-colors border-t border-outline-variant/10">
                          <span className="material-symbols-outlined text-[20px]">delete</span>
                          Delete Bill
                        </button>
                      )}
                    </>
                  )}

                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </header>

      <main className="flex-1 w-full pt-8">
        {isReadOnly && editingBill ? (
          <BillViewer bill={editingBill} />
        ) : (
          <div className="px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full">
            {/* Bill Summary Card */}
            <div className="bg-surface-container-lowest rounded-3xl p-6 shadow-sm border border-outline-variant/10 mb-8">
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-8 bg-primary rounded-full" />
                  <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant/70">Bill Information</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1 col-span-2">
                    <label className="text-[12px] font-bold text-on-surface-variant/60 ml-2">Customer Name</label>
                    <input 
                      type="text"
                      readOnly
                      value={customerName}
                      onClick={() => setShowCustomerModal(true)}
                      placeholder="Customer Name"
                      className="w-full h-12 px-4 rounded-2xl bg-surface-container-low border border-outline-variant/10 focus:ring-1 focus:ring-primary/30 transition-all font-body text-on-surface cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-6">
          {products.map((product) => {
            const isNameFilled = product.name.trim().length > 0;
            const isQuantityFilled = product.quantity !== '' && Number(product.quantity) > 0;

            return (
              <motion.section 
                ref={(el: HTMLElement | null) => { productRefs.current[product.id] = el; }}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ 
                  opacity: 1, 
                  y: 0,
                  backgroundColor: product.isRemoved ? 'rgba(239, 68, 68, 0.25)' : (product.isAdded ? 'rgba(34, 197, 94, 0.2)' : 'var(--md-sys-color-surface-container-lowest)')
                }}
                exit={{ 
                  x: 100,
                  opacity: 0,
                  scale: 0.9,
                  backgroundColor: 'rgba(239, 68, 68, 0.4)',
                  transition: { duration: 0.3 }
                }}
                key={product.id} 
                id={`product-${product.id}`}
                className={`rounded-[32px] p-6 shadow-md border relative overflow-hidden group transition-colors duration-500 ${product.isRemoved ? 'border-error/60' : (product.isAdded ? 'border-success/60' : 'border-outline-variant/15')}`}
              >
                  <div className="absolute top-0 right-0 p-4">
                    {product.isRemoved ? (
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-[10px] font-bold text-error uppercase tracking-tighter">Removed</span>
                        {product.removedAt && <span className="text-[9px] text-error/60">{new Date(product.removedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>}
                      </div>
                    ) : (
                      <button 
                        onClick={() => !isReadOnly && handleRemoveProduct(product.id, product.name)} 
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${isReadOnly ? 'hidden' : (editingBill ? 'bg-error/10 text-error hover:bg-error/20' : 'bg-error/10 text-error hover:bg-error/20')}`}
                      >
                        <span className="material-symbols-outlined text-[20px]">{editingBill ? 'close' : 'delete'}</span>
                      </button>
                    )}
                  </div>

                  {product.isAdded && !product.isRemoved && (
                    <div className="absolute top-4 left-6 flex flex-col gap-0.5">
                      <span className="text-[10px] font-bold text-success uppercase tracking-widest">Newly Added</span>
                      <span className="text-[9px] text-success/60">{new Date(product.addedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                  )}

                  <div className={`flex flex-col gap-5 ${(product.isAdded && !product.isRemoved) ? 'mt-6' : ''}`}>
                    <div className="space-y-1">
                      <label className="text-[12px] font-bold text-on-surface-variant/60 ml-2">Product Name</label>
                      <input 
                        type="text"
                        readOnly={isReadOnly || (!!editingBill && !product.isAdded)}
                        value={product.name}
                        onChange={(e) => updateProduct(product.id, 'name', e.target.value)}
                        placeholder="Product Name"
                        className={`w-full h-12 px-4 rounded-2xl bg-surface-container border border-outline-variant/10 focus:ring-1 focus:ring-primary/30 transition-all font-bold ${(isReadOnly || (!!editingBill && (!product.isAdded || isDateExpired))) ? 'opacity-70' : ''}`}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[12px] font-bold text-on-surface-variant/60 ml-2">Model</label>
                        <div className="relative group/input">
                          <input 
                            type="text"
                            readOnly={isReadOnly || (!!editingBill && !product.isAdded)}
                            value={product.model}
                            onChange={(e) => updateProduct(product.id, 'model', e.target.value)}
                            placeholder="Model"
                            className={`w-full h-12 pl-4 pr-11 rounded-2xl bg-surface-container border border-outline-variant/10 focus:ring-1 focus:ring-primary/30 transition-all ${(isReadOnly || (!!editingBill && (!product.isAdded || isDateExpired))) ? 'opacity-70' : ''}`}
                          />
                          {!(isReadOnly || (!!editingBill && (!product.isAdded || isDateExpired))) && (
                            <button 
                              onClick={() => handleScanModel(product.id)}
                              className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl flex items-center justify-center text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
                            >
                              <span className="material-symbols-outlined text-[22px]">center_focus_strong</span>
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[12px] font-bold text-on-surface-variant/60 ml-2">Quantity</label>
                        <div className="flex items-center bg-surface-container border border-outline-variant/10 rounded-2xl h-12 w-full overflow-hidden relative">
                          <button 
                            onClick={() => handleQuantityStep(product.id, -1)}
                            className="w-10 h-10 shrink-0 flex items-center justify-center hover:bg-surface-container-high active:scale-90 transition-all text-primary disabled:opacity-30 z-10"
                            disabled={isReadOnly || !product.quantity || product.quantity <= 0 || (!!editingBill && !product.isAdded)}
                          >
                            <span className="material-symbols-outlined text-[20px]">remove</span>
                          </button>
                          <input 
                            type="number"
                            inputMode="numeric"
                            readOnly={isReadOnly || (!!editingBill && !product.isAdded)}
                            value={product.hasSerials ? product.serialNumbers.filter(sn => !sn.isRemoved).length : product.quantity}
                            onChange={(e) => updateProduct(product.id, 'quantity', e.target.value === '' ? '' : parseInt(e.target.value))}
                            placeholder="0"
                            className="flex-1 w-0 min-w-0 bg-transparent border-0 text-center font-bold focus:ring-0 px-0 text-on-surface"
                          />
                          <button 
                            onClick={() => handleQuantityStep(product.id, 1)}
                            className="w-10 h-10 shrink-0 flex items-center justify-center hover:bg-surface-container-high active:scale-90 transition-all text-primary z-10"
                            disabled={isReadOnly || (!!editingBill && !product.isAdded)}
                          >
                            <span className="material-symbols-outlined text-[20px]">add</span>
                          </button>
                        </div>
                      </div>
                    </div>

                {/* Serial Toggle Block */}
                {isNameFilled && (
                  <div className="flex items-center justify-between bg-surface-container-low border border-outline-variant/20 rounded-2xl px-5 py-4 mt-2">
                      <span className="text-sm font-bold text-on-surface-variant">Add Serial Numbers?</span>
                    <div className="flex items-center gap-6">
                      <label className={`flex items-center gap-2 cursor-pointer group ${!!editingBill && !product.isAdded ? 'pointer-events-none opacity-50' : ''}`}>
                        <div className={`w-5 h-5 rounded-full border-[2px] flex items-center justify-center transition-colors ${product.hasSerials ? 'border-primary' : 'border-outline-variant/60 group-hover:border-primary/50'}`}>
                          {product.hasSerials && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                        </div>
                        <span className={`text-sm font-medium ${product.hasSerials ? 'text-primary font-bold' : 'text-on-surface-variant'}`}>Yes</span>
                        <input type="radio" className="hidden" checked={product.hasSerials} onChange={() => handleToggleSerials(product.id, true)} disabled={isReadOnly || (!!editingBill && !product.isAdded)} />
                      </label>
                      <label className={`flex items-center gap-2 cursor-pointer group ${!!editingBill && !product.isAdded ? 'pointer-events-none opacity-50' : ''}`}>
                        <div className={`w-5 h-5 rounded-full border-[2px] flex items-center justify-center transition-colors ${!product.hasSerials ? 'border-primary' : 'border-outline-variant/60 group-hover:border-primary/50'}`}>
                          {!product.hasSerials && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                        </div>
                        <span className={`text-sm font-medium ${!product.hasSerials ? 'text-primary font-bold' : 'text-on-surface-variant'}`}>No</span>
                        <input type="radio" className="hidden" checked={!product.hasSerials} onChange={() => handleToggleSerials(product.id, false)} disabled={isReadOnly || (!!editingBill && !product.isAdded)} />
                      </label>
                    </div>
                  </div>
                )}

                {/* Serial Number Module */}
                {isQuantityFilled && product.hasSerials && product.serialNumbers.length > 0 && (
                  <div className="bg-surface-container-low rounded-2xl p-5 mt-4">
                    <h3 className="font-bold text-xs uppercase tracking-wider text-on-surface-variant/60 mb-4">Serial Numbers</h3>
                    <div className="flex flex-col gap-3 mt-2 animations-container">
                        {product.serialNumbers.map((sn, idx) => (
                          <motion.div 
                            layout
                            key={idx} 
                            className={`flex gap-2 items-center p-2 rounded-xl transition-colors duration-500 ${product.isRemoved ? 'bg-error/20 border border-error/40' : sn.isRemoved ? 'bg-error/20 border border-error/40' : (sn.isAdded ? 'bg-success/15 border border-success/40' : '')}`}
                          >
                            <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${sn.isRemoved ? 'bg-error/30 text-error font-extrabold' : 'bg-primary/5 text-primary'}`}>
                              {idx + 1}
                            </span>
                            <div className="relative flex-grow">
                              <input 
                                type="text"
                                disabled={isReadOnly || sn.isRemoved || (!!editingBill && !sn.isAdded)}
                                value={sn.value}
                                onChange={(e) => updateSerialNumber(product.id, idx, e.target.value)}
                                placeholder={`Serial Number ${idx + 1}`}
                                className={`w-full h-11 px-4 pr-11 rounded-xl bg-surface-container border border-outline-variant/10 focus:ring-1 focus:ring-primary/30 transition-all font-body text-sm ${sn.isRemoved ? 'line-through text-on-surface-variant/40' : ''} ${!!editingBill && (!sn.isAdded || isDateExpired) && !sn.isRemoved ? 'opacity-70' : ''}`}
                              />
                              {!sn.isRemoved && !(isReadOnly || (!!editingBill && (!sn.isAdded || isDateExpired))) && (
                                <button 
                                  onClick={() => handleScan(product.id, idx)}
                                  className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center text-secondary bg-secondary/5 hover:bg-secondary/10 transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[20px]">barcode_scanner</span>
                                </button>
                              )}
                            </div>
                            {product.isRemoved ? (
                              <div className="flex flex-col items-end min-w-[50px]">
                                <span className="text-[8px] font-bold text-error uppercase">Removed</span>
                                {product.removedAt && <span className="text-[8px] text-error/60">{new Date(product.removedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>}
                              </div>
                            ) : sn.isRemoved ? (
                              <div className="flex flex-col items-end min-w-[50px]">
                                <span className="text-[8px] font-bold text-error uppercase">Removed</span>
                                <span className="text-[8px] text-error/60">{new Date(sn.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                 {sn.isAdded && (
                                   <div className="flex flex-col items-end mr-1">
                                     <span className="text-[8px] font-bold text-success uppercase">Added</span>
                                     <span className="text-[8px] text-success/60">{new Date(sn.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                   </div>
                                 )}
                                 {!sn.isRemoved && !isReadOnly && (
                                   <button 
                                     onClick={() => handleRemoveSerialNumber(product.id, idx, sn.value)}
                                     className="w-8 h-8 rounded-full flex items-center justify-center text-error/40 hover:text-error hover:bg-error/5 transition-all"
                                   >
                                     <span className="material-symbols-outlined text-[18px]">{editingBill ? 'close' : 'delete'}</span>
                                   </button>
                                 )}
                              </div>
                            )}
                          </motion.div>
                        ))}
                    </div>
                  </div>
                )}
                </div>

                <div className="absolute -inset-1 bg-gradient-to-b from-white/40 to-transparent pointer-events-none mix-blend-overlay z-0"></div>
              </motion.section>
            );
          })}

          {!isReadOnly && (
            <div className="flex flex-col items-center gap-4 mt-8 mb-12">
              <button 
                onClick={handleAddProduct} 
                className="flex items-center gap-2 px-6 py-3 rounded-full bg-transparent text-secondary font-body font-medium hover:bg-secondary-container/10 transition-colors"
              >
                <span className="material-symbols-outlined" style={{fontVariationSettings: "'FILL' 0"}}>add_circle</span>
                Add Another Product
              </button>

              {!showRemarks && (
                <button 
                  onClick={() => setShowRemarks(true)} 
                  className="flex items-center gap-2 px-6 py-2 rounded-full bg-transparent text-primary/60 font-body text-sm hover:bg-primary/5 transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">add_comment</span>
                  Add Additional Remarks
                </button>
              )}
            </div>
          )}

          {/* Additional Remarks Card */}
          <AnimatePresence>
            {showRemarks && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="rounded-[32px] p-6 mb-12 bg-surface-container-lowest border border-outline-variant/15 shadow-sm relative overflow-hidden mx-1"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                      <span className="material-symbols-outlined text-[20px]">notes</span>
                    </div>
                    <h3 className="font-headline font-bold text-lg text-on-surface">Additional Remarks</h3>
                  </div>
                  {!isReadOnly && (
                    <button 
                      onClick={() => { setRemarks(''); setShowRemarks(false); }}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-error/60 hover:bg-error/10 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                  )}
                </div>

                <div className="space-y-1">
                  <textarea
                    readOnly={isReadOnly}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Add any specific instructions, notes, or terms here..."
                    rows={4}
                    className={`w-full p-4 rounded-2xl bg-surface-container border border-outline-variant/10 focus:ring-1 focus:ring-primary/30 transition-all font-body text-[15px] resize-none ${isReadOnly ? 'opacity-70' : ''}`}
                  />
                </div>
                
                <div className="absolute -inset-1 bg-gradient-to-b from-white/40 to-transparent pointer-events-none mix-blend-overlay z-0"></div>
              </motion.section>
            )}
          </AnimatePresence>

            </div>
          </div>
        )}
      </main>

      <div className="fixed bottom-0 left-0 w-full p-6 bg-gradient-to-t from-surface via-surface/90 to-transparent z-50 flex flex-col justify-end gap-3 backdrop-blur-sm pointer-events-none">
        
        <div className="flex gap-4 w-full max-w-sm mx-auto pointer-events-auto">
          {!isReadOnly && (
            <button 
              onClick={() => triggerSave('SAVE')}
              disabled={isSaving}
              className="flex-1 h-14 rounded-full border border-primary/20 bg-surface-container text-primary font-headline font-bold text-sm shadow-[0_4px_14px_rgba(26,35,126,0.08)] hover:bg-primary-container transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none">
              {isSaving ? (
                <><div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div> Saving...</>
              ) : (
                <><span className="material-symbols-outlined text-[20px]">save</span> Save</>
              )}
            </button>
          )}
          
          {!isReadOnly && (
            <button 
              onClick={() => triggerSave('DOWNLOAD')}
              disabled={isSaving}
              className="flex-1 h-14 rounded-full bg-gradient-to-br from-primary to-primary-container text-on-primary font-headline font-bold text-sm tracking-wide shadow-[0_8px_24px_rgba(26,35,126,0.15)] hover:shadow-[0_12px_32px_rgba(26,35,126,0.25)] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none">
              {isSaving ? (
                <><div className="w-5 h-5 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin"></div> Saving...</>
              ) : (
                <><span className="material-symbols-outlined text-[20px]" style={{fontVariationSettings: "'FILL' 1"}}>share</span> Share</>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Back Button Escape Modal */}
      {showBackWarning && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center animate-in fade-in duration-300 px-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => setShowBackWarning(false)}></div>
          <div className="bg-surface-container-lowest w-full max-w-sm rounded-[28px] p-8 shadow-2xl relative z-10 animate-in zoom-in-95 duration-300">
            <div className="w-16 h-16 rounded-full bg-error-container text-error flex items-center justify-center mx-auto mb-5 shadow-inner">
              <span className="material-symbols-outlined text-[32px]">warning</span>
            </div>
            
            <h2 className="font-['Manrope'] font-bold text-2xl text-center text-on-surface mb-2">Wait, Bill Not Saved!</h2>
            <p className="font-body text-on-surface-variant text-center text-[15px] leading-relaxed mb-8">
              Are you absolutely sure you want to leave? Your changes will be lost.
            </p>
            
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => { setShowBackWarning(false); triggerSave('SAVE'); }}
                className="w-full h-12 rounded-full bg-primary text-on-primary font-headline font-bold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[20px]">save</span> 
                Save
              </button>
              <button 
                onClick={() => { clearDraft(); if (!editingBill) clearDashboardSession(); navigate(location.state?.fromDaybook ? '/daybook' : '/'); }}
                className="w-full h-12 rounded-full border-2 border-error/20 bg-error/10 text-error font-headline font-bold hover:bg-error/20 transition-all flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[20px]">delete_forever</span> 
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </motion.div>

    {/* Customer Name Pop-up Modal */}
    <AnimatePresence>
      {showCustomerModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center px-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="bg-surface-container-lowest w-full max-w-sm rounded-[32px] p-8 shadow-[0_24px_48px_rgba(0,0,0,0.2)] relative z-10 border border-outline-variant/10"
          >
            <button 
              onClick={() => setShowCustomerBackWarning(true)}
              className="absolute top-6 left-6 w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container transition-colors text-primary"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </button>

            <div className="w-16 h-16 rounded-full bg-primary-container text-primary flex items-center justify-center mx-auto mb-6 mt-4 shadow-sm">
              <span className="material-symbols-outlined text-[32px]">person_add</span>
            </div>
            
            <h2 className="font-headline font-bold text-2xl text-center text-on-surface mb-2">Customer Details</h2>
            <p className="font-body text-on-surface-variant text-center text-[15px] mb-8">
              Please enter the customer details to continue.
            </p>

            <div className="relative mb-4">
              <input 
                autoFocus
                className="w-full h-14 px-5 rounded-2xl bg-surface-container-highest border-2 border-transparent focus:border-primary/30 focus:bg-surface-container-lowest transition-all font-body text-on-surface text-lg text-center"
                placeholder="Enter Customer Name"
                type="text"
                value={tempCustomerName}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || /^[A-Za-z\s]+$/.test(val)) {
                    setTempCustomerName(val);
                  }
                }}
              />
              <p className="text-[10px] text-center mt-2 text-on-surface-variant uppercase tracking-widest font-bold opacity-60">Alphabets Only</p>
            </div>

            <div className="relative mb-8">
              <input 
                className="w-full h-14 px-5 rounded-2xl bg-surface-container-highest border-2 border-transparent focus:border-primary/30 focus:bg-surface-container-lowest transition-all font-body text-on-surface text-lg text-center"
                placeholder="Phone Number"
                type="tel"
                value={tempClientPhone}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^\d\s\-+()]/g, '');
                  setTempClientPhone(val);
                }}
              />
              <p className="text-[10px] text-center mt-2 text-error/70 uppercase tracking-widest font-bold">Required *</p>
            </div>
            
            <button 
              disabled={tempCustomerName.trim().length === 0 || tempClientPhone.replace(/[\s\-()]/g, '').length < 10}
              onClick={() => {
                setCustomerName(tempCustomerName.trim());
                setClientPhoneNumber(tempClientPhone.replace(/[\s\-()]/g, ''));
                setShowCustomerModal(false);
              }}
              className="w-full h-14 rounded-full bg-gradient-to-br from-primary to-primary-container text-on-primary font-headline font-bold text-base shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:grayscale disabled:shadow-none"
            >
              Continue
              <span className="material-symbols-outlined text-[20px]">chevron_right</span>
            </button>

            <div className="relative flex py-4 items-center">
              <div className="flex-grow border-t border-outline-variant/15"></div>
              <span className="flex-shrink mx-3 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/50">OR</span>
              <div className="flex-grow border-t border-outline-variant/15"></div>
            </div>

            <button 
              type="button"
              onClick={handleTriggerImport}
              disabled={isImporting}
              className="w-full h-12 rounded-2xl bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant/20 text-primary font-headline font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">upload_file</span>
              {isImporting ? 'Reading Document...' : 'Import from File (Excel / PDF)'}
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

    {/* Customer Back Warning Modal */}
    <AnimatePresence>
      {showCustomerBackWarning && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCustomerBackWarning(false)}></div>
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="bg-surface-container-lowest w-full max-w-sm rounded-[28px] p-8 shadow-2xl relative z-10"
          >
            <div className="w-16 h-16 rounded-full bg-error-container text-error flex items-center justify-center mx-auto mb-5 shadow-inner">
              <span className="material-symbols-outlined text-[32px]">warning</span>
            </div>
            
            <h2 className="font-headline font-bold text-2xl text-center text-on-surface mb-2">Exit Creation?</h2>
            <p className="font-body text-on-surface-variant text-center text-[15px] leading-relaxed mb-8">
              Are you sure you want to exit? Your progress will not be saved.
            </p>
            
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => { clearDraft(); if (!editingBill) clearDashboardSession(); navigate(location.state?.fromDaybook ? '/daybook' : '/'); }}
                className="w-full h-12 rounded-full bg-error text-on-error font-headline font-bold shadow-md hover:bg-error/90 transition-all flex items-center justify-center gap-2"
              >
                Yes, Exit
              </button>
              <button 
                onClick={() => setShowCustomerBackWarning(false)}
                className="w-full h-12 rounded-full bg-surface-container-high text-on-surface font-headline font-bold transition-all hover:bg-surface-container-highest flex items-center justify-center"
              >
                No, Stay
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

    {/* Cropping Modal Overlay */}
    <AnimatePresence>
      {croppingImage && (
        <div className="fixed inset-0 z-[1000] bg-black/95 flex flex-col justify-between overflow-hidden">
          {/* Header Area (Optional space) */}
          <div className="h-10 shrink-0" />

          {/* Image / Cropping Area - Flex-1 ensures it takes available space without pushing footer */}
          <div className="flex-1 flex items-center justify-center px-4 overflow-hidden">
            <div className="bg-black/50 p-2 rounded-xl shadow-2xl border border-white/5 max-w-full">
              <div className="relative">
                <ReactCrop
                  crop={crop}
                  onChange={c => setCrop(c)}
                  onComplete={c => setCompletedCrop(c)}
                >
                  <img 
                    ref={imgRef}
                    src={croppingImage} 
                    className="max-w-full max-h-[50vh] object-contain rounded-lg"
                    style={{ filter: 'contrast(1.05) saturate(1.1) brightness(1.02) sepia(0.06)' }}
                    alt="Crop preview" 
                  />
                </ReactCrop>
              </div>
            </div>
          </div>
          
          {/* Footer Controls Area - Persistent and Shielded */}
          <div className="w-full bg-surface-container-low p-6 flex flex-col gap-4 z-10 border-t border-outline-variant/10 shadow-[0_-12px_40px_rgba(0,0,0,0.6)] backdrop-blur-3xl shrink-0">
            <div className="space-y-1">
              <h2 className="text-on-surface font-headline font-bold text-center text-xl">Precise Cropping</h2>
              <p className="text-center text-xs text-on-surface-variant font-medium opacity-70">
                Ensure text is inside the capture zone
              </p>
            </div>

            <div className="flex gap-4 pb-4">
              <button 
                onClick={() => { setCroppingImage(null); setCroppingContext(null); setCrop(undefined); }}
                className="flex-1 h-14 rounded-full bg-surface-container-highest text-on-surface font-headline font-bold transition-all active:scale-95 flex items-center justify-center gap-2 border border-outline-variant/10"
              >
                <span className="material-symbols-outlined">close</span> Reject
              </button>
              
              <button 
                onClick={handleApplyCrop}
                disabled={isProcessingCrop || !completedCrop}
                className="flex-1 h-14 rounded-full bg-primary text-on-primary font-headline font-bold shadow-lg shadow-primary/20 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isProcessingCrop ? (
                  <>
                    <div className="w-5 h-5 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin"></div>
                    Extracting...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined">content_paste_search</span> Extract
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </AnimatePresence>

    {/* Audit Timeline Modal */}
    <AnimatePresence>
      {showTimeline && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex flex-col"
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowTimeline(false)} />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="relative z-10 mt-auto bg-surface rounded-t-[32px] max-h-[85vh] flex flex-col shadow-2xl"
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-outline-variant/30" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-secondary/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-secondary">schedule</span>
                </div>
                <div>
                  <h2 className="font-['Manrope'] font-bold text-lg text-on-surface">Audit Timeline</h2>
                  <p className="text-[11px] text-on-surface-variant/60 font-medium">{logs.length} events logged</p>
                </div>
              </div>
              <button
                onClick={() => setShowTimeline(false)}
                className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-on-surface-variant">close</span>
              </button>
            </div>

            {/* Timeline Content */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="space-y-1 relative">
                {logs.filter((log, idx, arr) => {
                  if (log.action === 'Edit Session Started') {
                    const nextLog = arr[idx + 1];
                    if (!nextLog || nextLog.action === 'Edit Session Started' || nextLog.action === 'Bill Created') return false;
                  }
                  return true;
                }).map((log, idx) => {
                  const isSessionBoundary = log.action === 'Edit Session Started' || log.action === 'Bill Created' || log.action === 'Bill Saved' || log.action === 'Bill Shared';
                  const isClickable = !!log.targetId;

                  // Enrich "Product Added: (New Product)" with actual product name and number
                  let displayAction = log.action;
                  if (log.action.includes('(New Product)') && log.targetId) {
                    const targetProduct = products.find(p => p.id === log.targetId);
                    if (targetProduct) {
                      const productIndex = products.indexOf(targetProduct) + 1;
                      const productName = targetProduct.name || 'Unnamed';
                      displayAction = log.action.replace('(New Product)', `#${productIndex} ${productName}`);
                    }
                  }

                  return (
                    <div key={idx}>
                      {isSessionBoundary && (
                        <div className={`flex items-center gap-3 ${idx > 0 ? 'mt-6 mb-4' : 'mb-4'}`}>
                          <div className="flex-1 h-px bg-outline-variant/15" />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/50 flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[12px]">
                              {log.action.includes('Created') ? 'add_circle' : log.action.includes('Edit') ? 'edit' : 'save'}
                            </span>
                            {log.action}
                          </span>
                          <div className="flex-1 h-px bg-outline-variant/15" />
                        </div>
                      )}
                      {!isSessionBoundary && (
                        <button
                          onClick={() => {
                            if (isClickable && log.targetId) {
                              setShowTimeline(false);
                              setTimeout(() => {
                                const el = document.getElementById(`product-${log.targetId}`);
                                if (el) {
                                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  el.classList.add('ring-2', 'ring-secondary', 'ring-offset-2');
                                  setTimeout(() => el.classList.remove('ring-2', 'ring-secondary', 'ring-offset-2'), 2000);
                                }
                              }, 300);
                            }
                          }}
                          disabled={!isClickable}
                          className={`w-full text-left flex items-center gap-4 py-3 px-4 rounded-xl transition-colors ${isClickable ? 'hover:bg-surface-container-low cursor-pointer active:scale-[0.99]' : 'cursor-default'}`}
                        >
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${displayAction.includes('Removed') ? 'bg-error' : displayAction.includes('Added') ? 'bg-success' : 'bg-primary/40'}`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium leading-tight truncate ${displayAction.includes('Removed') ? 'text-error' : (displayAction.includes('Added') ? 'text-success' : 'text-on-surface')}`}>
                              {displayAction}
                            </p>
                            <p className="text-[10px] text-on-surface-variant/40 font-medium mt-0.5">
                              {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                          {isClickable && (
                            <span className="material-symbols-outlined text-[16px] text-on-surface-variant/30">arrow_forward</span>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* Hidden Document File Picker for Excel / PDF */}
    <input
      type="file"
      ref={fileInputRef}
      onChange={handleFileSelected}
      accept=".xlsx,.xls,.csv,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
      className="hidden"
    />

    {/* Data Import Preview Confirmation Modal */}
    <ImportPreviewModal
      isOpen={showImportPreview}
      data={parsedImportData}
      onConfirm={handleConfirmImport}
      onCancel={() => setShowImportPreview(false)}
    />

    </>
  );
}
