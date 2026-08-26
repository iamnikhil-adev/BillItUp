import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { FiX } from 'react-icons/fi';

interface BarcodeOverlayProps {
  onCancel: () => void;
  onScanClick: () => void;
  onCaptureClick: () => void;
  isScanning: boolean;
  mediaStream: MediaStream | null;
  scanProgress?: number;
}

export default function BarcodeOverlay({ 
  onCancel, 
  onScanClick, 
  onCaptureClick, 
  isScanning, 
  mediaStream,
  scanProgress = 0
}: BarcodeOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
    }
  }, [mediaStream]);

  return (
    <div className={`fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${isScanning ? 'bg-transparent' : 'bg-black/60 backdrop-blur-[4px]'}`}>
      
      {/* Live Preview Feed */}
      <AnimatePresence>
        {!isScanning && mediaStream && (
          <motion.video
            ref={videoRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            autoPlay
            playsInline
            className="absolute inset-0 w-full h-full object-cover z-0"
            style={{ filter: 'contrast(1.08) saturate(1.15) brightness(1.05) sepia(0.04)' }}
          />
        )}
      </AnimatePresence>

      {/* RAZOR Barcode Viewfinder (40px) */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="scanner-viewfinder flex items-center justify-center relative w-full z-10"
        style={{ height: '50px', minHeight: '50px' }} // INCREASED TO 50PX
      >
        {/* Simple Pulsing Razor Laser */}
        {isScanning && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
              className="absolute left-2 right-2 h-[3px] bg-red-600 shadow-[0_0_12px_rgba(220,38,38,0.9),0_0_3px_#fff] z-20 rounded-full"
            />
            {/* Alignment Progress Feedback */}
            {scanProgress > 0 && scanProgress < 100 ? (
              <div className="absolute -top-12 left-0 w-full text-center">
                <span className="bg-primary/90 px-4 py-1.5 rounded-full text-on-primary text-[10px] font-black tracking-widest uppercase shadow-lg animate-pulse">
                  Aligning... {Math.round(scanProgress)}%
                </span>
              </div>
            ) : scanProgress === 0 && (
              <div className="absolute -top-12 left-0 w-full text-center">
                <span className="bg-green-500/90 px-6 py-1.5 rounded-full text-white text-[10px] font-black tracking-widest uppercase shadow-lg">
                  READY
                </span>
              </div>
            )}
          </>
        )}

        {/* Minimal Corner Accents */}
        <div className="absolute top-0 left-0 w-6 h-6 border-t-[3px] border-l-[3px] border-primary/60 rounded-tl-xl" />
        <div className="absolute top-0 right-0 w-6 h-6 border-t-[3px] border-r-[3px] border-primary/60 rounded-tr-xl" />
        <div className="absolute bottom-0 left-0 w-6 h-6 border-b-[3px] border-l-[3px] border-primary/60 rounded-bl-xl" />
        <div className="absolute bottom-0 right-0 w-6 h-6 border-b-[3px] border-r-[3px] border-primary/60 rounded-br-xl" />
      </motion.div>

      {/* Action Buttons */}
      <div className="absolute bottom-16 left-0 w-full flex flex-col items-center gap-6 px-8 z-[210]">
        
        {!isScanning && (
          <div className="flex w-full gap-4 max-w-[420px]">
            <motion.button 
              whileTap={{ scale: 0.95 }}
              onClick={onScanClick}
              disabled={isScanning}
              className="flex-1 h-16 flex items-center justify-center gap-3 rounded-[28px] font-black tracking-tight transition-all bg-primary text-on-primary shadow-2xl shadow-primary/40 border-0"
            >
              <span className="material-symbols-outlined text-[26px]">barcode_scanner</span>
              <span className="text-base uppercase tracking-wider">SCAN</span>
            </motion.button>

            <motion.button 
              whileTap={{ scale: 0.95 }}
              onClick={onCaptureClick}
              className="flex-1 h-16 flex items-center justify-center gap-3 bg-white/10 backdrop-blur-3xl border border-white/20 rounded-[28px] text-white font-black tracking-tight hover:bg-white/20 transition-all shadow-2xl"
            >
              <span className="material-symbols-outlined text-[26px]">photo_camera</span>
              <span className="text-base uppercase tracking-wider">OCR</span>
            </motion.button>
          </div>
        )}

        <motion.button 
          whileTap={{ scale: 0.95 }}
          onClick={onCancel}
          className="w-full max-w-[420px] h-16 flex items-center justify-center gap-2 bg-error/10 border border-error/20 text-error font-black uppercase tracking-widest text-[13px] rounded-[28px] transition-all backdrop-blur-xl shadow-xl"
        >
          <FiX className="w-5 h-5" />
          Cancel
        </motion.button>

      </div>
    </div>
  );
}
