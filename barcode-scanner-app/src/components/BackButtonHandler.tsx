import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { useAlert } from '../context/AlertContext';

export default function BackButtonHandler() {
  const navigate = useNavigate();
  const { showConfirm } = useAlert();

  useEffect(() => {
    let isProcessing = false;
    const handleBackButton = async () => {
      if (isProcessing) return;
      isProcessing = true;
      setTimeout(() => { isProcessing = false; }, 500); // 500ms debounce

      // If scanner is active, just stop it and don't navigate
      if ((window as any).isScannerActive && (window as any).stopScanner) {
        (window as any).stopScanner();
        return;
      }

      const currentPath = window.location.pathname;

      if (currentPath === '/' || currentPath === '') {
        showConfirm('Are you sure you want to exit the app?', () => {
          CapacitorApp.exitApp();
        }, 'Exit App');
      } else if (currentPath.includes('/create')) {
        // Special Handling for Create Bill flow
        // We use .includes in case of sub-routes or query params
        if ((window as any).showCustomerModal) {
          if ((window as any).triggerCustomerBackWarning) {
            (window as any).triggerCustomerBackWarning();
          }
        } else if ((window as any).isBillDirty) {
          if ((window as any).triggerBillBackWarning) {
            (window as any).triggerBillBackWarning();
          }
        } else {
          navigate(-1);
        }
      } else if (currentPath.includes('/profile') && (window as any).isProfileDirty) {
        showConfirm("Changes not saved. Are you sure you want to exit and revert your changes?", () => {
          (window as any).isProfileDirty = false;
          navigate(-1);
        }, "Unsaved Changes");
      } else {
        // Default behavior for other screens
        navigate(-1);
      }
    };

    const backListener = CapacitorApp.addListener('backButton', handleBackButton);

    return () => {
      backListener.then(l => l.remove());
    };
  }, [navigate, showConfirm]);

  return null;
}
