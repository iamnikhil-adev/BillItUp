import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface RestoreProgressModalProps {
  isOpen: boolean;
  message: string;
  progressPercent: number;
  isCompleted: boolean;
  restoredCount: number;
  onRestart: () => void;
}

export const RestoreProgressModal: React.FC<RestoreProgressModalProps> = ({
  isOpen,
  message,
  progressPercent,
  isCompleted,
  restoredCount,
  onRestart,
}) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
    } else {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const content = (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md touch-none select-none overscroll-none">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 15 }}
        transition={{ type: 'spring', damping: 25, stiffness: 350 }}
        className="bg-surface-container-lowest w-full max-w-sm rounded-[32px] p-8 shadow-[0_24px_48px_rgba(0,0,0,0.4)] relative z-10 border border-outline-variant/15 flex flex-col items-center text-center overflow-hidden"
      >
        {!isCompleted ? (
          <>
            {/* Animated Extract/Restore Icon */}
            <div className="w-18 h-18 rounded-3xl bg-primary/10 text-primary flex items-center justify-center mb-6 shadow-inner relative">
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
                className="material-symbols-outlined text-[36px]"
              >
                sync
              </motion.span>
            </div>

            <h2 className="font-headline font-extrabold text-xl text-on-surface mb-2">
              Restoring Backup
            </h2>

            {/* Progress Bar */}
            <div className="w-full bg-surface-container-highest rounded-full h-2.5 overflow-hidden mb-6 relative">
              <motion.div
                className="h-full bg-gradient-to-r from-primary to-secondary rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, Math.max(5, progressPercent))}%` }}
                transition={{ ease: 'easeOut', duration: 0.4 }}
              />
            </div>

            {/* Status Message with Wipe-Down Transition */}
            <div className="h-16 flex items-center justify-center w-full px-2">
              <AnimatePresence mode="wait">
                <motion.p
                  key={message}
                  initial={{ opacity: 0, y: -12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 12 }}
                  transition={{ duration: 0.28, ease: 'easeOut' }}
                  className="font-body text-xs sm:text-sm text-on-surface-variant font-semibold leading-relaxed"
                >
                  {message}
                </motion.p>
              </AnimatePresence>
            </div>

            <p className="text-[10px] text-on-surface-variant/40 font-bold uppercase tracking-widest mt-4">
              Please keep the app open
            </p>
          </>
        ) : (
          <>
            {/* Completed State */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', damping: 15, stiffness: 200 }}
              className="w-18 h-18 rounded-full bg-success-container text-success flex items-center justify-center mb-6 shadow-md"
            >
              <span className="material-symbols-outlined text-[40px]">check_circle</span>
            </motion.div>

            <h2 className="font-headline font-bold text-2xl text-on-surface mb-2">
              Backup Restored!
            </h2>
            <p className="font-body text-on-surface-variant text-sm leading-relaxed mb-8 px-2">
              <strong className="text-primary font-bold">{restoredCount} bill{restoredCount > 1 ? 's' : ''}</strong> {restoredCount > 1 ? 'have' : 'has'} been successfully extracted, cleaned, and synced to your business account.
            </p>

            <button
              onClick={onRestart}
              className="w-full h-14 rounded-full bg-gradient-to-br from-primary to-primary-container text-on-primary font-headline font-bold text-sm tracking-wide shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 active:scale-98"
            >
              <span className="material-symbols-outlined text-[20px]">restart_alt</span>
              Restart Application
            </button>
          </>
        )}
      </motion.div>
    </div>
  );

  return createPortal(content, document.body);
};
