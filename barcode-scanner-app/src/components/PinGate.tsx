import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function PinGate({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  
  const requiredPin = import.meta.env.VITE_WEB_PIN_CODE || '1234';
  const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const isViewerMode = import.meta.env.VITE_APP_MODE === 'viewer' && !isLocalhost;

  // Only enforce PIN in viewer mode
  if (!isViewerMode) {
    return <>{children}</>;
  }

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val.length <= 4) {
      setPin(val);
      setError(false);
    }
    
    if (val.length === 4) {
      if (val === requiredPin) {
        setIsAuthenticated(true);
      } else {
        setError(true);
        setTimeout(() => {
          setPin('');
          setError(false);
        }, 800);
      }
    }
  };

  return (
    <AnimatePresence mode="wait">
      {isAuthenticated ? (
        <motion.div
          key="app"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="h-full w-full"
        >
          {children}
        </motion.div>
      ) : (
        <motion.div
          key="pin"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.05 }}
          className="min-h-screen bg-surface flex flex-col items-center justify-center px-6"
        >
          <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center text-primary mb-8 shadow-inner">
            <span className="material-symbols-outlined text-[40px]">lock</span>
          </div>
          <h1 className="font-['Manrope'] font-bold text-3xl text-on-surface mb-2">Web Viewer</h1>
          <p className="font-body text-on-surface-variant text-center mb-10 max-w-xs">
            Please enter your 4-digit security PIN to view real-time synchronized bills.
          </p>
          
          <div className="flex gap-4 justify-center mb-6">
            {[0, 1, 2, 3].map((i) => (
              <div 
                key={i} 
                className={`w-14 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold font-mono transition-all duration-300 ${pin.length > i ? 'bg-primary text-on-primary shadow-lg shadow-primary/20 scale-105' : 'bg-surface-container border border-outline-variant/20 text-transparent'} ${error ? 'border-error/50 bg-error/10 text-error' : ''}`}
              >
                {pin.length > i ? '•' : ''}
              </div>
            ))}
          </div>

          <input
            type="number"
            autoFocus
            value={pin}
            onChange={handlePinChange}
            className="opacity-0 absolute w-full h-full inset-0 z-10 cursor-pointer"
            style={{ fontSize: '16px' }} // Prevent iOS zoom
          />
          
          {error && (
            <motion.p 
              initial={{ opacity: 0, y: -10 }} 
              animate={{ opacity: 1, y: 0 }} 
              className="text-error font-bold text-sm"
            >
              Incorrect PIN
            </motion.p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
