import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capawesome-team/capacitor-file-opener';
import { Share } from '@capacitor/share';
import { getProfile, getDraft, clearDraft, saveBill, getAllBills, restoreFromCloud, migrateLegacyBills, subscribeToBills, syncLocalBillsToFirebase, isFirebaseConfigured, checkIsViewerMode, isBillInScope, type UserScope } from '../utils/db';
import type { BillRecord } from '../utils/db';
import { generatePDFBlob } from '../utils/pdfGenerator';
import { useAlert } from '../context/AlertContext';
import { useAuth } from '../context/AuthContext';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import VersionLabel from '../components/VersionLabel';
import { getDashboardSession, setDashboardSession, getCachedBills, setCachedBills } from '../utils/session';

export default function Dashboard({ direction }: { direction: number }) {
  const { showAlert, showConfirm } = useAlert();
  const { currentUser } = useAuth();
  const [bills, setBills] = useState<BillRecord[]>(() => {
    return getCachedBills() || [];
  });
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error' | 'success'>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [savedBill, setSavedBill] = useState<BillRecord | null>(null);
  const [isViewerMode] = useState(() => checkIsViewerMode());
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(() => {
    const cached = getCachedBills();
    return cached !== null && cached.length > 0;
  });
  
  // Scroll restoration state — scrollY >= 0 means we have a saved position (including top of page)
  const _scrollSession = getDashboardSession();
  const pendingScrollY = useRef<number | null>(
    (_scrollSession.scrollY != null && _scrollSession.scrollY >= 0) ? _scrollSession.scrollY : null
  );
  const hasRestoredScroll = useRef(false);
  const scrollTimeouts = useRef<any[]>([]);
  
  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState(() => {
    const session = getDashboardSession();
    return session.search || '';
  });
  const [filterType, setFilterType] = useState<'all' | 'today' | 'yesterday' | 'custom' | 'tomorrow'>(() => {
    const session = getDashboardSession();
    return (session.filter as any) || 'all';
  });
  const [selectedDate, setSelectedDate] = useState(() => {
    const session = getDashboardSession();
    return session.date || '';
  });
  const dateInputRef = useRef<HTMLInputElement>(null);

  // Update session whenever filters or search change
  useEffect(() => {
    setDashboardSession(filterType, selectedDate, searchQuery);
  }, [filterType, selectedDate, searchQuery]);
  
  const navigate = useNavigate();
  const location = useLocation();

  const handleCreateBill = async (billToEdit?: BillRecord, isViewOnly?: boolean) => {
    if (!isViewerMode) {
      const profile = await getProfile();
      const isComplete = profile && profile.businessName.trim() && profile.userName.trim() && profile.phone.trim();
      
      if (!isComplete) {
        showAlert({ 
          title: "Profile Incomplete", 
          message: "Complete profile entries first then you can create bills.", 
          type: "warning" 
        });
        navigate('/profile');
        return;
      }
    }

    // Save scroll position before navigating away
    setDashboardSession(filterType, selectedDate, searchQuery, window.scrollY);

    if (billToEdit) {
      navigate('/create', { state: { billToEdit, isViewOnly: isViewerMode || isViewOnly, fromDashboard: true } });
    } else {
      navigate('/create');
    }
  };

  // PROACTIVE DRAFT CHECK
  useEffect(() => {
    if (isViewerMode) return;
    const checkDraft = async () => {
      // Small delay for smooth entry
      const timer = setTimeout(async () => {
        const draft = await getDraft();
        if (draft && !(window as any).hasCheckedDraft) {
          (window as any).hasCheckedDraft = true;
          showConfirm(
            "We found an unsaved draft from your previous session. Would you like to restore it?",
            () => {
              navigate('/create', { state: { restoredDraft: draft } });
            },
            "Draft Found",
            async () => {
              await clearDraft();
              (window as any).hasCheckedDraft = false; 
            },
            "Continue",
            "Discard"
          );
        }
      }, 600); // Slightly faster check
      return () => clearTimeout(timer);
    };
    checkDraft();
  }, [navigate, isViewerMode]);

  // If no saved scroll position, scroll to top instantly on mount
  useLayoutEffect(() => {
    if (pendingScrollY.current == null) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, []);

  // Clean up any pending scroll timeouts only on actual unmount
  useEffect(() => {
    return () => {
      scrollTimeouts.current.forEach(clearTimeout);
    };
  }, []);

  // When bills load, restore scroll position BEFORE browser paints (useLayoutEffect prevents visible jump)
  useLayoutEffect(() => {
    if (pendingScrollY.current != null && bills.length > 0 && isInitialLoadComplete && !hasRestoredScroll.current) {
      const y = pendingScrollY.current;
      hasRestoredScroll.current = true;
      
      // 1. Instant sync scroll (works if browser layout is ready)
      window.scrollTo(0, y);

      // 2. Deferred scroll fallbacks (handles active transitions and layout changes at various ticks)
      const t1 = setTimeout(() => window.scrollTo(0, y), 50);
      const t2 = setTimeout(() => window.scrollTo(0, y), 150);
      const t3 = setTimeout(() => {
        window.scrollTo(0, y);
        // Only clear saved scroll position and ref once we are sure scroll has settled,
        // which prevents StrictMode double-mount from wiping the saved state prematurely.
        pendingScrollY.current = null;
        setDashboardSession(filterType, selectedDate, searchQuery, null);
      }, 350);
      
      scrollTimeouts.current.push(t1, t2, t3);
    }
  }, [bills, isInitialLoadComplete]);

  useEffect(() => {
    if (location.state?.showSuccessAlert && location.state?.savedBill) {
      setSavedBill(location.state.savedBill);
      window.history.replaceState({}, document.title);
    }
  }, [location]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    
    const startupSync = async () => {
      try {
        const userScope: UserScope | undefined = currentUser ? {
          uid: currentUser.uid,
          phoneNumber: currentUser.phoneNumber,
          role: currentUser.role || undefined,
          adminId: (currentUser as any).adminId,
        } : undefined;

        // STEP 1: Show local bills IMMEDIATELY (strictly filtered by active user scope)
        const localBills = await getAllBills();
        const scopedLocal = localBills.filter(b => isBillInScope(b, userScope));
        setBills(scopedLocal);
        setCachedBills(scopedLocal);
        
        // STEP 2: If local is empty, check cloud for bills (reinstall recovery)
        if (scopedLocal.length === 0 && isFirebaseConfigured) {
          const restoredCount = await restoreFromCloud(userScope);
          if (restoredCount > 0) {
            // Show the recovered bills immediately
            const recovered = await getAllBills();
            const scopedRecovered = recovered.filter(b => isBillInScope(b, userScope));
            setBills(scopedRecovered);
            setCachedBills(scopedRecovered);
          }
        }
        
        // STEP 3: Migrate legacy formats & assign admin ownership
        await migrateLegacyBills(currentUser?.role === 'admin' ? currentUser : undefined);
        
        // STEP 4: Repair Sync - Push any missed bills to cloud
        if (isFirebaseConfigured) {
          setSyncStatus('syncing');
          try {
            const result = await syncLocalBillsToFirebase();
            if (result.error) {
              setSyncStatus('error');
              setSyncError(result.error);
            } else if (result.total > 0) {
              setSyncStatus('success');
              setTimeout(() => setSyncStatus('idle'), 5000);
            } else {
              setSyncStatus('idle');
            }
          } catch (e: any) {
            setSyncStatus('error');
            setSyncError(e.message || "Unknown Error");
          }
        }
        
        // STEP 5: Start real-time listener for ongoing changes
        unsubscribe = subscribeToBills((records) => {
          setBills(records);
          setCachedBills(records);
        }, userScope);
      } catch (err) {
        console.error(err);
        pendingScrollY.current = null;
      } finally {
        setIsInitialLoadComplete(true);
      }
    };
    
    startupSync();
    
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const filteredBills = useMemo(() => {
    return bills.filter(bill => {
      const searchLower = searchQuery.toLowerCase().trim();
      const matchesSearch = !searchLower || 
        bill.id.toLowerCase().includes(searchLower) ||
        bill.customerName.toLowerCase().includes(searchLower) ||
        bill.products.some(p => 
          p.name.toLowerCase().includes(searchLower) || 
          p.model.toLowerCase().includes(searchLower)
        );

      if (!matchesSearch) return false;

      if (filterType === 'tomorrow') return false;

      const billDate = new Date(bill.timestamp);
      if (filterType === 'today') return isToday(billDate);
      if (filterType === 'yesterday') return isYesterday(billDate);
      if (filterType === 'custom' && selectedDate) {
        return format(billDate, 'yyyy-MM-dd') === selectedDate;
      }

      return true;
    });
  }, [bills, searchQuery, filterType, selectedDate]);

  // Role-based bill visibility
  const roleScopedBills = useMemo(() => {
    if (!currentUser) return filteredBills;
    if (currentUser.role === 'admin') return filteredBills;
    if (currentUser.role === 'user') {
      return filteredBills.filter(bill =>
        bill.createdByUserId === currentUser.uid || !bill.createdByUserId // legacy bills
      );
    }
    if (currentUser.role === 'client') {
      return filteredBills.filter(bill =>
        bill.clientPhoneNumber === currentUser.phoneNumber
      );
    }
    return filteredBills;
  }, [filteredBills, currentUser]);

  const totalScanned = bills.length;
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const thisMonthScanned = bills.filter(b => {
    const d = new Date(b.timestamp);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  }).length;

  const handleReExport = async (bill: BillRecord) => {
    if (isExporting) return;
    setIsExporting(bill.id);
    
    try {
      const pdfBase64 = await generatePDFBlob(bill);
      const safeId = bill.id.replace(/\//g, '_');
      const fileName = `${safeId}-copy.pdf`;

      if (Capacitor.isNativePlatform()) {
        const savedFile = await Filesystem.writeFile({
          path: fileName,
          data: pdfBase64,
          directory: Directory.Cache,
        });

        await FileOpener.openFile({
          path: savedFile.uri,
        });
      } else {
        const link = document.createElement('a');
        link.href = `data:application/pdf;base64,${pdfBase64}`;
        link.download = fileName;
        link.click();
      }
    } catch (e) {
      console.error(e);
      showAlert({ title: "Export Failed", message: "An error occurred while re-exporting the PDF. Please try again.", type: 'error' });
    } finally {
      setIsExporting(null);
    }
  };

  const handleShare = async (e: React.MouseEvent, bill: BillRecord) => {
    e.stopPropagation();
    if (isExporting) return;
    setIsExporting(bill.id);
    
    try {
      const pdfBase64 = await generatePDFBlob(bill);
      const safeId = bill.id.replace(/\//g, '_');
      const fileName = `${safeId}.pdf`;

      if (Capacitor.isNativePlatform()) {
        const cachedFile = await Filesystem.writeFile({
          path: fileName,
          data: pdfBase64,
          directory: Directory.Cache,
        });

        await Share.share({
          title: `Bill ${bill.id.split('-').join(' - ')}`,
          text: `*Bill Details*\nBill No: ${bill.id.split('-').join(' - ')}\nCustomer: ${bill.customerName || 'N/A'}`,
          url: cachedFile.uri,
          dialogTitle: 'Share Bill via WhatsApp',
        });
      } else {
        const link = document.createElement('a');
        link.href = `data:application/pdf;base64,${pdfBase64}`;
        link.download = fileName;
        link.click();
      }
    } catch (e) {
      console.error(e);
      showAlert({ title: "Share Failed", message: "An error occurred while sharing the PDF. Please try again.", type: 'error' });
    } finally {
      setIsExporting(null);
    }
  };



  const handleToggleViewed = async (e: React.MouseEvent, bill: BillRecord) => {
    e.stopPropagation();
    
    const updatedBill = { ...bill, isViewed: !bill.isViewed };
    
    // 1. Instant UI update so you never have to refresh
    setBills(prevBills => {
      const updated = prevBills.map(b => b.id === bill.id ? updatedBill : b);
      setCachedBills(updated);
      return updated;
    });
    
    // 2. Save silently in the background
    await saveBill(updatedBill);
  };

  const isRestoring = pendingScrollY.current != null;

  const variants = {
    initial: (direction: number) => ({
      opacity: isRestoring ? 1 : 0,
      x: isRestoring ? 0 : (direction > 0 ? 25 : direction < 0 ? -25 : 0),
      filter: isRestoring ? 'blur(0px)' : 'blur(8px)'
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

  return (
    <>
      <motion.div 
        custom={direction}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={isRestoring ? { duration: 0 } : { duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
        className="bg-surface min-h-screen flex flex-col relative pb-24 font-body motion-root"
      >
        <header className="flex justify-between items-center w-full px-6 pt-10 pb-4 bg-surface-container-low flat z-40 sticky top-0 border-b border-outline-variant/10">
          <div className="flex flex-col">
            <h1 className="text-xl font-['Manrope'] font-bold text-primary tracking-tight leading-none">Bill History</h1>
            {!isViewerMode && syncStatus !== 'idle' && (
              <motion.span 
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className={`text-[10px] font-extrabold uppercase tracking-[0.15em] mt-1.5 flex items-center gap-1.5 ${
                  syncStatus === 'syncing' ? 'text-secondary animate-pulse' : 
                  syncStatus === 'success' ? 'text-success' : 'text-error'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]" style={{fontVariationSettings: "'FILL' 1"}}>
                  {syncStatus === 'syncing' ? 'sync' : syncStatus === 'success' ? 'cloud_done' : 'cloud_off'}
                </span>
                {syncStatus === 'syncing' ? 'Syncing Cloud...' : 
                 syncStatus === 'success' ? 'Cloud Safe' : 
                 `Sync Error: ${syncError ? (syncError.length > 20 ? syncError.substring(0, 20) + '...' : syncError) : 'Check Internet'}`}
              </motion.span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link to="/daybook" title="Daybook" className="w-10 h-10 rounded-full overflow-hidden transition-all cursor-pointer hover:scale-105 active:scale-95 border border-outline-variant/15 flex items-center justify-center bg-surface-container-high text-secondary">
              <span className="material-symbols-outlined" style={{fontVariationSettings: "'FILL' 1"}}>menu_book</span>
            </Link>
            {!isViewerMode && (
              <Link to="/profile" title="Business Profile" className="w-10 h-10 rounded-full overflow-hidden transition-all cursor-pointer hover:scale-105 active:scale-95 border border-outline-variant/15 flex items-center justify-center bg-surface-container-high text-primary">
                <span className="material-symbols-outlined" style={{fontVariationSettings: "'FILL' 1"}}>account_circle</span>
              </Link>
            )}
          </div>
        </header>

        <main className="flex-grow px-4 md:px-8 py-6 max-w-4xl mx-auto w-full flex flex-col gap-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.05 }}
            className="bg-surface-container-lowest rounded-[28px] p-6 mb-2 flex justify-between items-center shadow-sm border border-outline-variant/5"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/5 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-2xl">analytics</span>
              </div>
              <div>
                <p className="text-[12px] font-bold text-on-surface-variant/60 uppercase tracking-wider">Total Bills</p>
                <h2 className="text-3xl font-['Manrope'] font-bold text-primary">{totalScanned}</h2>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[12px] font-bold text-on-surface-variant/60 uppercase tracking-wider">This Month</p>
              <h2 className="text-xl font-['Manrope'] font-bold text-secondary">+{thisMonthScanned}</h2>
            </div>
          </motion.div>

          <div className="flex flex-col gap-4 mb-6">
            <div className="relative group">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant group-focus-within:text-primary transition-colors">search</span>
              <input 
                type="text"
                placeholder="Search by name, product, or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-12 pl-12 pr-4 rounded-2xl bg-surface-container border border-outline-variant/10 focus:ring-1 focus:ring-primary/30 focus:bg-surface-container-lowest transition-all font-body text-on-surface placeholder:text-on-surface-variant/50"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {['all', 'today', 'yesterday', 'tomorrow'].map((type) => (
                <button 
                  key={type}
                  onClick={() => setFilterType(type as any)}
                  className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex-shrink-0 ${filterType === type ? 'bg-primary text-on-primary shadow-md' : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest'}`}
                >
                  {type === 'all' ? 'All Bills' : type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
              <div className="relative flex-shrink-0">
                <button 
                  onClick={() => dateInputRef.current?.showPicker()}
                  className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${filterType === 'custom' ? 'bg-primary text-on-primary shadow-md' : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest'}`}
                >
                  <span className="material-symbols-outlined text-[16px]">calendar_month</span>
                  {filterType === 'custom' && selectedDate ? format(parseISO(selectedDate), 'MMM d, yyyy') : 'Select Date'}
                </button>
                <input 
                  ref={dateInputRef}
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    setFilterType('custom');
                  }}
                  className="absolute inset-0 opacity-0 pointer-events-none"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {!isInitialLoadComplete ? (
              <div className="flex flex-col gap-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="glass-card rounded-[28px] p-5 h-[104px] animate-pulse bg-surface-container-low/40 border border-outline-variant/10" />
                ))}
              </div>
            ) : roleScopedBills.length === 0 ? (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center p-12 custom-border border-outline-variant/30 rounded-xl bg-surface-container-lowest/50"
              >
                <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-3 block">
                  {filterType === 'tomorrow' ? 'auto_fix_high' : 'receipt_long'}
                </span>
                <p className="text-on-surface-variant font-medium">
                  {filterType === 'tomorrow' 
                    ? 'Ahhh, i see you are a time traveller, or you can see future.' 
                    : 'No bills found.'}
                </p>
              </motion.div>
            ) : (
              roleScopedBills.map((bill) => (
                <div 
                  key={bill.id} 
                  onClick={() => handleReExport(bill)}
                  className={`glass-card rounded-[28px] p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center cursor-pointer transition-all duration-300 ease-out hover:scale-[1.01] shadow-[0_4px_24px_rgba(26,35,126,0.04)] hover:shadow-[0_12px_40px_rgba(26,35,126,0.08)] border border-outline-variant/15 group relative overflow-hidden ${bill.isViewed ? 'opacity-75' : ''}`}
                >
                    <div className="absolute inset-0 bg-surface-tint opacity-0 group-hover:opacity-[0.02] transition-opacity"></div>
                    <div className="flex items-center gap-4 mb-3 sm:mb-0 relative z-10 w-full sm:w-auto">
                      <button 
                        onClick={(e) => handleToggleViewed(e, bill)}
                        className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${bill.isViewed ? 'bg-primary border-primary text-on-primary' : 'border-outline-variant/50 text-transparent'} hover:border-primary`}
                      >
                        <span className="material-symbols-outlined text-[18px] font-bold">check</span>
                      </button>
                      <div className="w-12 h-12 rounded-full bg-surface-container-low flex items-center justify-center text-secondary group-hover:bg-secondary-fixed transition-colors flex-shrink-0">
                        <span className="material-symbols-outlined" style={{fontVariationSettings: "'FILL' 1"}}>
                          {isExporting === bill.id ? 'downloading' : 'receipt_long'}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1 -ml-1">
                        <h3 className="font-headline font-bold text-on-surface text-sm truncate flex items-center gap-1 uppercase tracking-tight">
                          {bill.id.split('-').join(' - ')}
                        </h3>
                        <p className="font-body text-sm text-primary font-bold truncate mb-1">{bill.customerName || 'Generic Customer'}</p>
                        <p className="font-label text-sm text-on-surface-variant flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">calendar_today</span> 
                          {bill.dateString}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 w-full sm:w-auto justify-between sm:justify-end relative z-10">
                      <div className="text-left sm:text-right">
                        <p className="font-label text-xs text-on-surface-variant uppercase tracking-wider mb-0.5">Total Products</p>
                        <p className="font-body font-medium text-on-surface">{bill.products.length} {bill.products.length === 1 ? 'Product' : 'Products'}</p>
                      </div>
                      <div className="flex items-center gap-2 mt-3 sm:mt-0">
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleCreateBill(bill); }}
                          className="w-10 h-10 rounded-2xl border border-outline-variant/30 flex items-center justify-center text-primary bg-surface-container hover:bg-surface-container-high transition-colors"
                          title={isViewerMode ? "View Bill" : "Edit Bill"}
                        >
                          <span className="material-symbols-outlined text-[20px]">{isViewerMode ? 'visibility' : 'edit'}</span>
                        </button>
                        <button
                          onClick={(e) => handleShare(e, bill)}
                          className="w-10 h-10 rounded-full bg-primary text-on-primary shadow-sm hover:shadow-lg transition-all flex items-center justify-center"
                          title="Share PDF"
                        >
                          <span className="material-symbols-outlined text-[20px]" style={{fontVariationSettings: "'FILL' 1"}}>
                            {isExporting === bill.id ? 'downloading' : 'share'}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
          </div>
        </main>

        <AnimatePresence>
          {savedBill && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center"
            >
              <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => setSavedBill(null)}></div>
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 10 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="bg-surface-container-lowest w-[85%] max-w-sm rounded-[28px] p-8 shadow-2xl relative z-10"
              >
                <div className="w-16 h-16 rounded-full bg-primary-container text-primary flex items-center justify-center mx-auto mb-5 shadow-inner">
                  <span className="material-symbols-outlined text-[32px]">check_circle</span>
                </div>
                
                <h2 className="font-['Manrope'] font-bold text-2xl text-center text-on-surface mb-2">Success!</h2>
                <p className="font-body text-on-surface-variant text-center text-[15px] leading-relaxed mb-8">
                  Successfully saved the PDF to your mobile device.
                </p>
                
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => { handleReExport(savedBill); setSavedBill(null); }}
                    className="w-full h-12 rounded-full bg-gradient-to-r from-primary to-primary-container text-on-primary font-headline font-bold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-[20px]" style={{fontVariationSettings: "'FILL' 1"}}>share</span> 
                    Share PDF
                  </button>
                  <button 
                    onClick={() => setSavedBill(null)}
                    className="w-full h-12 rounded-full bg-surface-container-high text-on-surface font-headline font-bold transition-all hover:bg-surface-container-highest">
                    Dismiss
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {!isViewerMode && (
        <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-40 w-max">
          <motion.button 
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => handleCreateBill()} 
            className="flex items-center justify-center gap-2 bg-gradient-to-br from-primary to-primary-container text-on-primary rounded-full px-6 py-4 shadow-[0_8px_24px_rgba(26,35,126,0.25)] relative overflow-hidden group border-0 focus:outline-none"
          >
            <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity"></div>
            <span className="material-symbols-outlined text-xl">add</span>
            <span className="font-headline font-bold text-sm tracking-wide">Create New Bill</span>
          </motion.button>
        </div>
      )}
      <VersionLabel />
      {!isViewerMode && (
        <div className="fixed bottom-4 left-4 z-50">
          <div className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-2 ${
            !isFirebaseConfigured ? 'bg-gray-100 text-gray-600' :
            syncStatus === 'syncing' ? 'bg-blue-100 text-blue-700' :
            syncStatus === 'error' ? 'bg-red-100 text-red-700' :
            'bg-green-100 text-green-700'
          }`}>
            <div className={`w-2 h-2 rounded-full ${
              !isFirebaseConfigured ? 'bg-gray-400' :
              syncStatus === 'syncing' ? 'bg-blue-500 animate-pulse' :
              syncStatus === 'error' ? 'bg-red-500' :
              'bg-green-500 animate-pulse'
            }`} />
            {!isFirebaseConfigured ? 'Offline Mode' :
             syncStatus === 'syncing' ? 'Syncing Cloud...' :
             syncStatus === 'error' ? 'Sync Error' :
             'Cloud Safe'}
          </div>
        </div>
      )}
    </>
  );
}
