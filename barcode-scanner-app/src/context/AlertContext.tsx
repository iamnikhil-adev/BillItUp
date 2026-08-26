import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FiAlertCircle, FiHelpCircle, FiCheckCircle, FiInfo } from 'react-icons/fi';

interface AlertOptions {
  title?: string;
  message: string;
  type?: 'error' | 'warning' | 'info' | 'success' | 'confirm';
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
  actionText?: string;
  onAction?: () => void;
}

interface AlertContextType {
  showAlert: (options: AlertOptions) => void;
  showConfirm: (message: string, onConfirm: () => void, title?: string, onCancel?: () => void, confirmText?: string, cancelText?: string) => void;
  hideAlert: () => void;
}

const AlertContext = createContext<AlertContextType | undefined>(undefined);

export const useAlert = () => {
  const context = useContext(AlertContext);
  if (!context) throw new Error('useAlert must be used within an AlertProvider');
  return context;
};

export const AlertProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [alert, setAlert] = useState<AlertOptions | null>(null);

  const showAlert = (options: AlertOptions) => {
    setAlert({ ...options, type: options.type || 'error' });
  };

  const showConfirm = (
    message: string, 
    onConfirm: () => void, 
    title: string = 'Confirm Action', 
    onCancel?: () => void,
    confirmText: string = 'Confirm',
    cancelText: string = 'Cancel'
  ) => {
    setAlert({ title, message, type: 'confirm', onConfirm, onCancel, confirmText, cancelText });
  };

  const hideAlert = () => setAlert(null);

  const handleConfirm = () => {
    if (alert?.onConfirm) alert.onConfirm();
    hideAlert();
  };

  const handleCancel = () => {
    if (alert?.onCancel) alert.onCancel();
    hideAlert();
  };

  const handleAction = () => {
    if (alert?.onAction) alert.onAction();
    hideAlert();
  };

  return (
    <AlertContext.Provider value={{ showAlert, showConfirm, hideAlert }}>
      {children}
      <AnimatePresence>
        {alert && (
          <AlertComponent 
            title={alert.title || (alert.type === 'error' ? 'Error' : 'Alert')}
            message={alert.message}
            type={alert.type || 'error'}
            confirmText={alert.confirmText}
            cancelText={alert.cancelText}
            actionText={alert.actionText}
            onClose={handleCancel}
            onConfirm={handleConfirm}
            onAction={handleAction}
          />
        )}
      </AnimatePresence>
    </AlertContext.Provider>
  );
};

const AlertComponent: React.FC<{ 
  title: string; 
  message: string; 
  type: string; 
  confirmText?: string;
  cancelText?: string;
  actionText?: string;
  onClose: () => void;
  onConfirm: () => void;
  onAction: () => void;
}> = ({ title, message, type, confirmText, cancelText, actionText, onClose, onConfirm, onAction }) => {
  const isConfirm = type === 'confirm';

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    return () => {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    };
  }, []);
  
  const getIcon = () => {
    switch (type) {
      case 'success': return <FiCheckCircle className="w-8 h-8 text-secondary" />;
      case 'info': return <FiInfo className="w-8 h-8 text-primary" />;
      case 'confirm': return <FiHelpCircle className="w-8 h-8 text-primary" />;
      default: return <FiAlertCircle className="w-8 h-8 text-error" />;
    }
  };

  const getIconBg = () => {
    switch (type) {
      case 'success': return 'bg-secondary/10';
      case 'error': return 'bg-error/10';
      default: return 'bg-primary/10';
    }
  };

  const modal = (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md touch-none select-none overscroll-none">
      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 1, opacity: 0, filter: 'blur(10px)', transition: { duration: 0.2 } }}
        transition={{ type: 'spring', damping: 25, stiffness: 400 }}
        className="bg-surface-container-lowest w-full max-w-sm rounded-[32px] overflow-hidden shadow-2xl border border-outline-variant/10"
      >
        <div className="p-8 flex flex-col items-center text-center">
          <div className={`w-16 h-16 ${getIconBg()} rounded-full flex items-center justify-center mb-5 shadow-inner`}>
            {getIcon()}
          </div>
          
          <h3 className="text-2xl font-['Manrope'] font-bold text-on-surface mb-2 tracking-tight">
            {title}
          </h3>
          
          <p className="font-body text-on-surface-variant mb-8 leading-relaxed text-[15px]">
            {message}
          </p>
          
          <div className="flex flex-col gap-3 w-full">
            <button
              onClick={isConfirm ? onConfirm : onClose}
              className={`w-full h-14 ${isConfirm ? 'bg-primary text-on-primary' : 'bg-on-surface text-surface'} font-headline font-bold rounded-full shadow-lg transition-all active:scale-95`}
            >
              {isConfirm ? (confirmText || 'Continue') : (confirmText || 'Dismiss')}
            </button>

            {actionText && (
              <button
                onClick={onAction}
                className="w-full h-14 bg-gradient-to-br from-primary to-primary-container text-on-primary font-headline font-bold rounded-full shadow-md transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[20px]">visibility</span>
                {actionText}
              </button>
            )}
            
            {isConfirm && (
              <button
                onClick={onClose}
                className="w-full h-14 bg-surface-container-high text-on-surface font-headline font-bold rounded-full transition-all active:scale-95"
              >
                {cancelText || 'Cancel'}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );

  return createPortal(modal, document.body);
};
