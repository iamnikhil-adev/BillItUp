import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { saveProfile, getProfile, getAllBills, isFirebaseConfigured } from '../utils/db';
import type { UserProfile } from '../utils/db';
import { useAlert } from '../context/AlertContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import VersionLabel from '../components/VersionLabel';
import { exportBackupArchive, restoreBackupFile } from '../utils/backupRestore';
import { RestoreProgressModal } from '../components/RestoreProgressModal';

export default function Profile({ direction }: { direction: number }) {
  const { showAlert, showConfirm } = useAlert();
  const { theme, toggleTheme } = useTheme();
  const { currentUser, updateUser, logout } = useAuth();
  const [profile, setProfile] = useState<UserProfile>({
    businessName: currentUser?.businessName || '',
    userName: currentUser?.name || '',
    phone: currentUser?.phoneNumber || '',
  });
  const [originalProfile, setOriginalProfile] = useState<UserProfile>({
    businessName: currentUser?.businessName || '',
    userName: currentUser?.name || '',
    phone: currentUser?.phoneNumber || '',
  });
  const [isSaved, setIsSaved] = useState(false);
  const [isExportingBackup, setIsExportingBackup] = useState(false);

  // Restore Modal State
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState('');
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restoreCompleted, setRestoreCompleted] = useState(false);
  const [restoredCount, setRestoredCount] = useState(0);

  const navigate = useNavigate();

  useEffect(() => {
    getProfile(currentUser?.uid).then(saved => {
      const loaded: UserProfile = {
        businessName: currentUser?.businessName || saved?.businessName || '',
        userName: currentUser?.name || saved?.userName || '',
        phone: currentUser?.phoneNumber || saved?.phone || '',
      };
      setProfile(loaded);
      setOriginalProfile(loaded);
    });
    return () => { (window as any).isProfileDirty = false; };
  }, [currentUser]);

  useEffect(() => {
    (window as any).isProfileDirty = profile.businessName !== originalProfile.businessName || 
                                     profile.userName !== originalProfile.userName || 
                                     profile.phone !== originalProfile.phone;
  }, [profile, originalProfile]);

  const handleExit = (e: React.MouseEvent) => {
    e.preventDefault();
    const isDirty = profile.businessName !== originalProfile.businessName || 
                    profile.userName !== originalProfile.userName || 
                    profile.phone !== originalProfile.phone;
                    
    if (isDirty) {
      showConfirm("Changes not saved. Are you sure you want to exit and revert your changes?", () => {
        navigate(-1);
      }, "Unsaved Changes");
    } else {
      navigate(-1);
    }
  };

  const handleSave = async () => {
    if (!profile.businessName.trim() || !profile.userName.trim() || !profile.phone.trim()) {
      showAlert({ title: "Fields Missing", message: "Please fill out all fields to save your business profile.", type: 'warning' });
      return;
    }

    if (!/^\d{10}$/.test(profile.phone.trim())) {
      showAlert({ title: "Invalid Number", message: "Please enter a valid 10-digit mobile number.", type: 'error' });
      return;
    }

    const cleanPhone = profile.phone.trim();
    const updatedProfile: UserProfile = {
      ...profile,
      phone: cleanPhone,
    };

    await saveProfile(updatedProfile, currentUser?.uid);
    if (updateUser) {
      await updateUser({
        businessName: profile.businessName.trim(),
        name: profile.userName.trim(),
        phoneNumber: cleanPhone,
      });
    }

    setOriginalProfile(updatedProfile);
    (window as any).isProfileDirty = false;
    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      navigate('/', { replace: true });
    }, 800);
  };

  const handleExportBackup = async () => {
    if (isExportingBackup) return;
    setIsExportingBackup(true);
    try {
      const fileName = await exportBackupArchive(profile);
      showAlert({
        title: "Backup Exported",
        message: `Successfully created ${fileName}. Keep this file safe for instant recovery.`,
        type: 'success'
      });
    } catch (e: any) {
      console.error(e);
      showAlert({
        title: "Backup Failed",
        message: e.message || "An error occurred during backup export.",
        type: 'error'
      });
    } finally {
      setIsExportingBackup(false);
    }
  };

  const handleTriggerRestore = () => {
    if (restoreInputRef.current) {
      restoreInputRef.current.value = '';
      restoreInputRef.current.click();
    }
  };

  const handleRestoreFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset and open modal
    setIsRestoring(true);
    setRestoreCompleted(false);
    setRestoredCount(0);
    setRestoreProgress(10);
    setRestoreMessage(`Extracting ${file.name}...`);

    try {
      const result = await restoreBackupFile(
        file,
        currentUser,
        (_step, msg, pct) => {
          setRestoreMessage(msg);
          setRestoreProgress(pct);
        }
      );

      setRestoredCount(result.count);
      setRestoreCompleted(true);
    } catch (err: any) {
      setIsRestoring(false);
      console.error('[RESTORE_ERROR]', err);
      const msg = err.message || '';

      if (msg.includes('INVALID_FILE_TYPE')) {
        showAlert({
          title: "Invalid File Type",
          message: "Invalid file type. Please select a valid .ZIP or .JSON backup file exported from BillItUp.",
          type: 'error'
        });
      } else if (msg.includes('NO_JSON_IN_ZIP') || msg.includes('INVALID_ARCHIVE')) {
        showAlert({
          title: "Invalid Backup Archive",
          message: "The selected ZIP file does not contain any valid backup files. Kindly repick or check for discrepancies.",
          type: 'error'
        });
      } else if (msg.includes('NO_VALID_BILLS') || msg.includes('CORRUPTED')) {
        showAlert({
          title: "Invalid Backup Content",
          message: "The selected file does not contain any valid bill records. Kindly repick or check for discrepancies.",
          type: 'error'
        });
      } else {
        showAlert({
          title: "Restore Failed",
          message: msg || "An unexpected error occurred during restoration. Kindly check for discrepancies.",
          type: 'error'
        });
      }
    }
  };

  const handleRestartApp = () => {
    window.location.href = '/';
  };

  const handleTestConnection = async () => {
    if (!isFirebaseConfigured) {
      showAlert({ title: "Not Configured", message: "Firebase is not configured in this app.", type: 'warning' });
      return;
    }
    
    showAlert({ title: "Testing...", message: "Attempting to reach cloud database...", type: 'info' });
    
    try {
      // Small delay to simulate test
      await new Promise(r => setTimeout(r, 1000));
      // If we got this far, it's generally working (we checked isFirebaseConfigured)
      showAlert({ title: "Connection Success", message: "Successfully verified cloud configuration. Your data is ready to sync.", type: 'success' });
    } catch (e: any) {
      showAlert({ title: "Connection Error", message: e.message || "Failed to reach cloud database.", type: 'error' });
    }
  };

  const handleLogout = async () => {
    try {
      const allBills = await getAllBills();
      const unsyncedCount = allBills.filter(b => b.isSynced === false).length;

      if (unsyncedCount > 0) {
        showConfirm(
          `You have ${unsyncedCount} bill(s) waiting to sync to the cloud. If you log out now while offline, they will remain in your vault until you log back in with internet. Are you sure you want to log out?`,
          async () => {
            await logout();
            navigate('/', { replace: true });
          },
          "Unsynced Bills Warning",
          undefined,
          "Log Out Anyway",
          "Stay Logged In"
        );
      } else {
        showConfirm(
          "Are you sure you want to log out?",
          async () => {
            await logout();
            navigate('/', { replace: true });
          },
          "Log Out"
        );
      }
    } catch (_e) {
      await logout();
      navigate('/', { replace: true });
    }
  };

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
      transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
      className="bg-surface text-on-surface font-body antialiased min-h-screen flex flex-col pb-8 motion-root"
    >
      <header className="flex justify-between items-center w-full px-6 pt-10 pb-4 bg-surface-container-low flat z-40 sticky top-0 border-b border-outline-variant/10">
        <button onClick={handleExit} aria-label="Go Back" className="text-primary hover:opacity-80 transition-opacity scale-95 active:transition-transform flex items-center justify-center w-10 h-10 rounded-full bg-surface-container-low border-0 outline-none">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <h1 className="text-primary font-['Manrope'] font-bold text-xl tracking-tight">Business Profile</h1>
        <div className="w-10 h-10 rounded-full bg-transparent flex items-center justify-center">
          {/* spacer */}
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto w-full pt-6">
        <section className="bg-surface-container-lowest rounded-DEFAULT p-6 mb-6 shadow-[0_8px_24px_rgba(26,35,126,0.04)] relative overflow-hidden group">
          <div className="flex flex-col gap-6 relative z-10">
            <h2 className="font-headline font-bold text-lg text-primary mb-2">Signature Details</h2>
            <p className="text-sm text-on-surface-variant font-body mb-4">
              Enter the names that will automatically appear at the bottom of your generated PDFs.
            </p>
            
            <div className="relative">
              <input 
                className="w-full h-14 px-4 rounded-DEFAULT bg-surface-container-highest border-0 focus:ring-1 focus:ring-primary/40 focus:bg-surface-container-lowest transition-all font-body text-on-surface" 
                id="profile-business-name" 
                placeholder="Business Name (for Top Header)" 
                type="text" 
                value={profile.businessName}
                onChange={(e) => setProfile({ ...profile, businessName: e.target.value })}
              />
            </div>

            <div className="relative">
              <input 
                className="w-full h-14 px-4 rounded-DEFAULT bg-surface-container-highest border-0 focus:ring-1 focus:ring-primary/40 focus:bg-surface-container-lowest transition-all font-body text-on-surface" 
                id="profile-user-name" 
                placeholder="User/Admin Name (for PDF Footer)" 
                type="text" 
                value={profile.userName}
                onChange={(e) => setProfile({ ...profile, userName: e.target.value })}
              />
            </div>

            <div className="relative">
              <input 
                className="w-full h-14 px-4 rounded-DEFAULT bg-surface-container-highest border-0 focus:ring-1 focus:ring-primary/40 focus:bg-surface-container-lowest transition-all font-body text-on-surface" 
                id="profile-phone" 
                placeholder="10-Digit Contact Number" 
                type="tel" 
                maxLength={10}
                value={profile.phone}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, ''); // strip non-digits as they type
                  setProfile({ ...profile, phone: val });
                }}
              />
            </div>
            
            <button 
              onClick={handleSave}
              className={`mt-4 w-full h-14 rounded-full flex items-center justify-center gap-3 transition-all font-headline font-bold text-lg tracking-wide ${isSaved ? 'bg-green-600 text-white shadow-lg' : 'bg-gradient-to-br from-primary to-primary-container text-on-primary shadow-[0_8px_24px_rgba(26,35,126,0.15)] hover:shadow-[0_12px_32px_rgba(26,35,126,0.25)]'}`}>
              <span className="material-symbols-outlined">{isSaved ? 'check_circle' : 'save'}</span>
              {isSaved ? 'Saved Permanently' : 'Save Profile'}
            </button>

            <div className="mt-10 pt-8 border-t border-outline-variant/20">
              <h2 className="font-headline font-bold text-lg text-primary mb-6">Management & Analytics</h2>

              <div className="flex flex-col gap-4 mb-6">
                {/* Reports & Analytics */}
                <button
                  onClick={() => navigate('/reports')}
                  className="flex items-center justify-between bg-surface-container-low p-5 rounded-2xl shadow-sm hover:bg-surface-container transition-colors w-full text-left"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
                      <span className="material-symbols-outlined">bar_chart</span>
                    </div>
                    <div>
                      <h3 className="font-headline font-bold text-base text-on-surface">Analytics & Reports</h3>
                      <p className="text-xs text-on-surface-variant font-medium">Visual monthly volume charts & PDF export</p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-on-surface-variant">chevron_right</span>
                </button>

                {/* Admin Master Control */}
                {currentUser?.role === 'admin' && (
                  <button
                    onClick={() => navigate('/master-control')}
                    className="flex items-center justify-between bg-surface-container-low p-5 rounded-2xl shadow-sm hover:bg-surface-container transition-colors w-full text-left"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-violet-50 text-violet-600 flex items-center justify-center">
                        <span className="material-symbols-outlined">admin_panel_settings</span>
                      </div>
                      <div>
                        <h3 className="font-headline font-bold text-base text-on-surface">Master Control</h3>
                        <p className="text-xs text-on-surface-variant font-medium">Manage staff users & client passwords</p>
                      </div>
                    </div>
                    <span className="material-symbols-outlined text-on-surface-variant">chevron_right</span>
                  </button>
                )}
              </div>

              <h2 className="font-headline font-bold text-lg text-primary mb-6">Advanced Maintenance</h2>
              
              <div className="flex flex-col gap-4">
                {/* Theme Toggle */}
                <div className="flex items-center justify-between bg-surface-container-low p-5 rounded-2xl shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${theme === 'dark' ? 'bg-indigo-900 text-indigo-200' : 'bg-amber-100 text-amber-600'}`}>
                      <span className="material-symbols-outlined text-[24px]">
                        {theme === 'dark' ? 'dark_mode' : 'light_mode'}
                      </span>
                    </div>
                    <div>
                      <h3 className="font-headline font-bold text-base text-on-surface">Dark Appearance</h3>
                      <p className="text-xs text-on-surface-variant font-medium">Switch between light and dark themes</p>
                    </div>
                  </div>
                  
                  <button 
                    onClick={toggleTheme}
                    className={`relative w-12 h-7 rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-primary/40 flex items-center px-1 ${theme === 'dark' ? 'bg-primary' : 'bg-outline-variant/40'}`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white shadow-sm transform transition-transform duration-300 ${theme === 'dark' ? 'translate-x-[20px]' : 'translate-x-0'}`} />
                  </button>
                </div>

                {/* Cloud Test */}
                <button 
                  onClick={handleTestConnection}
                  className="flex items-center justify-between bg-surface-container-low p-5 rounded-2xl shadow-sm hover:bg-surface-container transition-colors w-full text-left"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                      <span className="material-symbols-outlined">cloud_sync</span>
                    </div>
                    <div>
                      <h3 className="font-headline font-bold text-base text-on-surface">Cloud Connection Test</h3>
                      <p className="text-xs text-on-surface-variant font-medium">Verify connection to Firestore</p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-on-surface-variant">chevron_right</span>
                </button>

                {/* Emergency Backup */}
                <button 
                  onClick={handleExportBackup}
                  disabled={isExportingBackup}
                  className="flex items-center justify-between bg-surface-container-low p-5 rounded-2xl shadow-sm hover:bg-red-50/30 transition-colors w-full text-left border border-error/10 disabled:opacity-50"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-red-50 text-error flex items-center justify-center">
                      <span className="material-symbols-outlined">backup</span>
                    </div>
                    <div>
                      <h3 className="font-headline font-bold text-base text-error">Emergency Local Backup</h3>
                      <p className="text-xs text-on-surface-variant font-medium text-red-700/60 font-bold">
                        {isExportingBackup ? 'CREATING BACKUP ARCHIVE...' : 'EXPORTS ALL BILLS TO A ZIP ARCHIVE'}
                      </p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-error/40">download</span>
                </button>

                {/* Restore Backup (ZIP / JSON) */}
                <button 
                  onClick={handleTriggerRestore}
                  className="flex items-center justify-between bg-surface-container-low p-5 rounded-2xl shadow-sm hover:bg-primary/5 transition-colors w-full text-left border border-primary/20"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                      <span className="material-symbols-outlined">settings_backup_restore</span>
                    </div>
                    <div>
                      <h3 className="font-headline font-bold text-base text-primary">Restore from Local Backup</h3>
                      <p className="text-xs text-on-surface-variant font-medium">Import ZIP or JSON backup file</p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-primary">upload_file</span>
                </button>

                {/* Log Out */}
                <button 
                  onClick={handleLogout}
                  className="flex items-center justify-between bg-surface-container-low p-5 rounded-2xl shadow-sm hover:bg-error/10 transition-colors w-full text-left border border-error/10"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-error/10 text-error flex items-center justify-center">
                      <span className="material-symbols-outlined">logout</span>
                    </div>
                    <div>
                      <h3 className="font-headline font-bold text-base text-error">Log Out</h3>
                      <p className="text-xs text-on-surface-variant font-medium">Signed in as {currentUser?.name || currentUser?.role || 'User'}</p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-error">chevron_right</span>
                </button>
              </div>
            </div>
          </div>
          <div className="absolute -inset-1 bg-gradient-to-b from-white/40 to-transparent pointer-events-none mix-blend-overlay z-0"></div>
        </section>
      </main>

      <VersionLabel />

      {/* Hidden File Picker for Backup Restore */}
      <input 
        type="file"
        ref={restoreInputRef}
        onChange={handleRestoreFileSelected}
        accept=".zip,.json,application/zip,application/x-zip-compressed,application/json"
        className="hidden"
      />

      {/* Animated Restore Progress Modal */}
      <RestoreProgressModal
        isOpen={isRestoring}
        message={restoreMessage}
        progressPercent={restoreProgress}
        isCompleted={restoreCompleted}
        restoredCount={restoredCount}
        onRestart={handleRestartApp}
      />
    </motion.div>
  );
}
