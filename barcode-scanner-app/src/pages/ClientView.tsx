import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useAlert } from '../context/AlertContext';
import { subscribeToBills } from '../utils/db';
import type { BillRecord } from '../utils/db';
import { firestore, isFirebaseConfigured } from '../utils/firebase';
import { collection, query, getDocs, updateDoc, doc } from 'firebase/firestore';

const ease: any = [0.23, 1, 0.32, 1];

export default function ClientView({ direction }: { direction: number }) {
  const { currentUser, clientSession, logout } = useAuth();
  const { showConfirm } = useAlert();
  const [bills, setBills] = useState<BillRecord[]>([]);
  const [timeLeft, setTimeLeft] = useState(0);
  const [showExpiry, setShowExpiry] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [isLocked, setIsLocked] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const intervalRef = useRef<any>(null);

  const [selectedBill, setSelectedBill] = useState<BillRecord | null>(null);

  // Load bills filtered by client phone number
  useEffect(() => {
    if (!currentUser) return;
    const target = (currentUser.phoneNumber || '').replace(/\D/g, '').slice(-10);
    const unsubscribe = subscribeToBills((records) => {
      const myBills = records.filter((b) => {
        const clientP = (b.clientPhoneNumber || '').replace(/\D/g, '').slice(-10);
        return clientP === target;
      });
      setBills(myBills);
    });
    return () => { if (unsubscribe) unsubscribe(); };
  }, [currentUser]);

  const performDeactivateAndLogout = async () => {
    setIsLoggingOut(true);
    try {
      if (isFirebaseConfigured && firestore && clientSession?.phoneNumber && clientSession?.tempPassword) {
        const cleanPhone = clientSession.phoneNumber.replace(/\D/g, '').slice(-10);
        const q = query(collection(firestore, 'sessions'));
        const snap = await getDocs(q);
        const sessionDoc = snap.docs.find(d => {
          const data = d.data();
          const p = (data.phoneNumber || '').replace(/\D/g, '').slice(-10);
          return p === cleanPhone && (data.tempPassword || '').trim() === clientSession.tempPassword.trim();
        });
        if (sessionDoc) {
          await updateDoc(doc(firestore, 'sessions', sessionDoc.id), {
            isActive: false,
            expiresAt: Date.now()
          });
        }
      }
    } catch (e) {
      console.warn('[CLIENT_LOGOUT] Failed to deactivate session in Firestore:', e);
    } finally {
      clearInterval(intervalRef.current);
      await logout();
    }
  };

  const handleLogoutPrompt = () => {
    showConfirm(
      'Are you sure you want to end your session? This temporary password will be permanently deactivated and cannot be used again.',
      performDeactivateAndLogout,
      'End Session',
      undefined,
      'End Session & Log Out',
      'Stay'
    );
  };

  // Countdown timer
  useEffect(() => {
    if (!clientSession) return;
    
    intervalRef.current = setInterval(() => {
      const remaining = Math.max(0, clientSession.expiresAt - Date.now());
      setTimeLeft(remaining);

      const seconds = Math.floor(remaining / 1000);

      // 5 minutes warning (red timer)
      if (seconds <= 300 && seconds > 60) {
        setShowWarning(false);
        setShowExpiry(false);
        setIsLocked(false);
      }

      // 1 minute warning message
      if (seconds <= 60 && seconds > 10) {
        setShowWarning(true);
        setIsLocked(false);
      }

      // 10 second lockout
      if (seconds <= 10 && seconds > 0) {
        setIsLocked(true);
        setShowExpiry(true);
        setCountdown(seconds);
      }

      // Expired
      if (seconds <= 0) {
        clearInterval(intervalRef.current);
        performDeactivateAndLogout();
      }
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, [clientSession]);

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const seconds = Math.floor(timeLeft / 1000);
  const isTimerRed = seconds <= 300;

  const variants = {
    initial: (dir: number) => ({ opacity: 0, x: dir > 0 ? 25 : dir < 0 ? -25 : 0, filter: 'blur(8px)' }),
    animate: { opacity: 1, x: 0, filter: 'blur(0px)' },
    exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -20 : dir < 0 ? 20 : 0, filter: 'blur(6px)' })
  };

  return (
    <motion.div
      custom={direction}
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.35, ease }}
      className="bg-surface text-on-surface font-body antialiased min-h-screen flex flex-col motion-root"
    >
      {/* Timer Bar with Safe Top Padding */}
      <div className={`sticky top-0 z-50 flex items-center justify-between px-6 pt-14 pb-3 transition-colors duration-500 shadow-md ${
        isTimerRed ? 'bg-error text-on-error' : 'bg-primary text-on-primary'
      }`}>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] animate-pulse">timer</span>
          <span className="font-['Manrope'] font-bold text-sm">Session Active</span>
        </div>
        <div className="font-mono font-bold text-lg tracking-wider">
          {formatTime(timeLeft)}
        </div>
      </div>

      {/* 1-minute warning banner */}
      <AnimatePresence>
        {showWarning && !isLocked && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-error/10 border-b border-error/20 px-5 py-3 overflow-hidden"
          >
            <p className="font-body text-error text-sm font-medium text-center">
              ⚠️ Your session is about to expire. Kindly contact the business admin for a new password, or an extension on the same session.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header with Log Out Button */}
      <header className="px-6 pt-6 pb-4 flex items-center justify-between">
        <div>
          <h1 className="font-['Manrope'] font-extrabold text-2xl text-on-surface tracking-tight">
            Your Bills
          </h1>
          <p className="font-body text-on-surface-variant/60 text-sm mt-0.5">
            Welcome, {currentUser?.name || 'Client'}
          </p>
        </div>
        <button
          onClick={handleLogoutPrompt}
          disabled={isLoggingOut}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-error/10 text-error font-['Manrope'] font-bold text-xs hover:bg-error/20 transition-all active:scale-95 border border-error/20 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">logout</span>
          {isLoggingOut ? 'Ending...' : 'Log Out'}
        </button>
      </header>

      {/* Bills List */}
      <main className="flex-1 px-6 pb-8">
        {bills.length === 0 ? (
          <div className="text-center p-12 rounded-xl bg-surface-container-lowest/50 border border-outline-variant/30">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-3 block">receipt_long</span>
            <p className="text-on-surface-variant font-medium">No bills found for your account.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {bills.map((bill) => (
              <motion.div
                key={bill.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => setSelectedBill(bill)}
                className="glass-card rounded-[28px] p-5 border border-outline-variant/15 shadow-sm cursor-pointer hover:border-primary/30 transition-all active:scale-[0.99]"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="font-['Manrope'] font-bold text-on-surface text-base">
                      {bill.customerName}
                    </h3>
                    <p className="font-body text-on-surface-variant/60 text-xs mt-0.5">
                      {bill.dateString} • {bill.timeString}
                    </p>
                  </div>
                  <div className="bg-primary-container text-on-primary-container px-3 py-1 rounded-full text-xs font-bold">
                    {bill.totalQuantity} items
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {bill.products.filter(p => !p.isRemoved).slice(0, 3).map((p, i) => (
                    <span key={i} className="bg-surface-container-high text-on-surface-variant px-2.5 py-1 rounded-lg text-[11px] font-medium">
                      {p.name || p.model || 'Product'}
                    </span>
                  ))}
                  {bill.products.filter(p => !p.isRemoved).length > 3 && (
                    <span className="bg-surface-container-high text-on-surface-variant px-2.5 py-1 rounded-lg text-[11px] font-medium">
                      +{bill.products.filter(p => !p.isRemoved).length - 3} more
                    </span>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </main>

      {/* Bill Details Modal */}
      <AnimatePresence>
        {selectedBill && (
          <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedBill(null)}>
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface-container-lowest w-full max-w-md max-h-[85vh] rounded-[32px] overflow-hidden shadow-2xl border border-outline-variant/15 flex flex-col p-6"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-['Manrope'] font-extrabold text-xl text-on-surface">{selectedBill.customerName}</h3>
                  <p className="text-xs text-on-surface-variant/60">{selectedBill.dateString} at {selectedBill.timeString}</p>
                </div>
                <button onClick={() => setSelectedBill(null)} className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant">
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3 my-2">
                {selectedBill.products.filter(p => !p.isRemoved).map((p, idx) => (
                  <div key={idx} className="bg-surface-container-low rounded-2xl p-3.5 border border-outline-variant/10">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-['Manrope'] font-bold text-sm text-on-surface">{p.name || 'Item'}</span>
                      <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-md text-xs font-bold font-mono">
                        Qty: {p.hasSerials ? p.serialNumbers.filter(s => !s.isRemoved).length : p.quantity}
                      </span>
                    </div>
                    {p.model && <p className="text-xs text-on-surface-variant/70 font-mono mb-1.5">Model: {p.model}</p>}
                    {p.hasSerials && p.serialNumbers.filter(s => !s.isRemoved).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t border-outline-variant/10">
                        {p.serialNumbers.filter(s => !s.isRemoved).map((sn, sIdx) => (
                          <span key={sIdx} className="bg-surface-container-highest font-mono text-[10px] text-on-surface px-1.5 py-0.5 rounded">
                            {sn.value}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-outline-variant/15 flex justify-between items-center mt-2">
                <span className="text-xs font-bold text-on-surface-variant/70">Total Items:</span>
                <span className="font-['Manrope'] font-extrabold text-lg text-primary">{selectedBill.totalQuantity}</span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 10-Second Lockout Popup */}
      <AnimatePresence>
        {isLocked && showExpiry && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-lg flex flex-col items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              className="flex flex-col items-center"
            >
              <motion.div
                key={countdown}
                initial={{ scale: 1.3, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.3, ease }}
                className="w-32 h-32 rounded-full bg-error flex items-center justify-center shadow-2xl mb-8"
              >
                <span className="text-on-error font-['Manrope'] font-extrabold text-6xl">
                  {countdown}
                </span>
              </motion.div>
              <h2 className="font-['Manrope'] font-extrabold text-2xl text-white mb-3 text-center">
                Session Expiring
              </h2>
              <p className="font-body text-white/70 text-center text-sm max-w-xs leading-relaxed">
                Your session is about to expire. Please contact the business admin for a new password.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
