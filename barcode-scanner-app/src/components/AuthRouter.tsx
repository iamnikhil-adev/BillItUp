import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiUser, FiShield, FiUsers, FiArrowLeft, FiPhone, FiLock, FiMapPin, FiBriefcase } from 'react-icons/fi';
import { useAuth, type UserRole, type AuthUser, type ClientSession } from '../context/AuthContext';
import { getClientSession, initUserVault, saveProfile } from '../utils/db';
import { firebaseAuth, firestore, isFirebaseConfigured } from '../utils/firebase';
import { collection, doc, setDoc, getDoc, getDocs, query } from 'firebase/firestore';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import localforage from 'localforage';

const ease: any = [0.23, 1, 0.32, 1];

// ─────────────────────────────────────────────
// WELCOME SCREEN — Role Selector
// ─────────────────────────────────────────────

function WelcomeScreen({ onSelectRole }: { onSelectRole: (role: UserRole) => void }) {
  const roles = [
    {
      id: 'admin' as UserRole,
      icon: <FiShield className="w-8 h-8" />,
      label: 'Admin',
      desc: 'Set up and manage your business',
      gradient: 'from-indigo-600 to-violet-700',
    },
    {
      id: 'user' as UserRole,
      icon: <FiUser className="w-8 h-8" />,
      label: 'User',
      desc: 'Staff member — create bills',
      gradient: 'from-blue-600 to-cyan-600',
    },
    {
      id: 'client' as UserRole,
      icon: <FiUsers className="w-8 h-8" />,
      label: 'Client',
      desc: 'View your personal bills',
      gradient: 'from-emerald-600 to-teal-600',
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.98, filter: 'blur(12px)' }}
      transition={{ duration: 0.5, ease }}
      className="fixed inset-0 z-[9999] bg-surface flex flex-col items-center justify-center p-6"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.6, ease }}
        className="flex flex-col items-center mb-10"
      >
        <div className="w-20 h-20 rounded-[28px] bg-gradient-to-br from-primary to-primary-container flex items-center justify-center shadow-2xl mb-5">
          <span className="material-symbols-outlined text-[40px] text-on-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
            barcode_scanner
          </span>
        </div>
        <h1 className="font-['Manrope'] font-extrabold text-3xl text-on-surface tracking-tight mb-1">
          Welcome to BillItUp
        </h1>
        <p className="font-body text-on-surface-variant/60 text-sm">
          Select how you'd like to continue
        </p>
      </motion.div>

      <div className="flex flex-col gap-4 w-full max-w-sm">
        {roles.map((role, i) => (
          <motion.button
            key={role.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + i * 0.1, duration: 0.5, ease }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onSelectRole(role.id)}
            className="w-full flex items-center gap-4 p-5 rounded-[20px] bg-surface-container-low border border-outline-variant/20 hover:border-primary/30 transition-all duration-300 text-left group"
          >
            <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${role.gradient} flex items-center justify-center text-white shadow-lg group-hover:scale-105 transition-transform duration-300`}>
              {role.icon}
            </div>
            <div className="flex-1">
              <h3 className="font-['Manrope'] font-bold text-lg text-on-surface">{role.label}</h3>
              <p className="font-body text-on-surface-variant/60 text-sm">{role.desc}</p>
            </div>
            <FiArrowLeft className="w-5 h-5 text-on-surface-variant/30 rotate-180 group-hover:translate-x-1 transition-transform duration-300" />
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}

import { App as CapacitorApp } from '@capacitor/app';

// ─────────────────────────────────────────────
// ADMIN SETUP FLOW
// ─────────────────────────────────────────────

function AdminSetup({ onBack, onComplete }: { onBack: () => void; onComplete: () => void }) {
  const { login, setFirstLaunchDone } = useAuth();
  const [step, setStep] = useState<'phone' | 'otp' | 'details'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<any>(null);

  // Swipe back gesture handler
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    const handleBackButton = async () => {
      const listener = await CapacitorApp.addListener('backButton', () => {
        if (step === 'otp') {
          setStep('phone');
        } else if (step === 'details') {
          setStep('otp');
        } else {
          onBack();
        }
      });
      return listener;
    };

    let listenerPromise = handleBackButton();
    return () => {
      listenerPromise.then(l => l.remove());
    };
  }, [step, onBack]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const startX = touchStartX.current;
    const startY = touchStartY.current;
    if (startX !== null && startY !== null) {
      const deltaX = e.changedTouches[0].clientX - startX;
      const deltaY = Math.abs(e.changedTouches[0].clientY - startY);
      // Swipe right gesture detected (> 60px horizontal dominant)
      if (deltaX > 60 && deltaX > deltaY * 1.3) {
        if (step === 'otp') setStep('phone');
        else if (step === 'details') setStep('otp');
        else onBack();
      }
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  const setupRecaptcha = (containerId: string) => {
    try {
      if ((window as any).recaptchaVerifier) {
        (window as any).recaptchaVerifier.clear();
        delete (window as any).recaptchaVerifier;
      }
    } catch (_e) {
      // ignore
    }
    (window as any).recaptchaVerifier = new RecaptchaVerifier(firebaseAuth, containerId, {
      size: 'invisible',
    });
  };

  const handleSendOTP = async () => {
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    if (!cleanPhone || cleanPhone.length < 10) {
      setError('Enter a valid 10-digit phone number');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setupRecaptcha('recaptcha-container');
      const formattedPhone = `+91${cleanPhone}`;
      const result = await signInWithPhoneNumber(firebaseAuth, formattedPhone, (window as any).recaptchaVerifier);
      setConfirmationResult(result);
      setStep('otp');
    } catch (e: any) {
      console.error('[AUTH] OTP send failed:', e);
      if (e?.code === 'auth/operation-not-allowed' || e?.message?.includes('operation-not-allowed')) {
        setError('Phone Authentication is not enabled or saved in Firebase Console. Please enable Phone provider in Authentication > Sign-in method and click SAVE, or use Offline Setup below.');
      } else if (e?.code === 'auth/configuration-not-found' || e?.message?.includes('configuration-not-found')) {
        setError('Firebase Phone Auth is disabled in Firebase Console. Please enable Phone provider in Authentication > Sign-in method, or use Offline Setup below.');
      } else if (e?.code === 'auth/invalid-phone-number') {
        setError('Invalid phone number format. Please enter a valid 10-digit number.');
      } else if (e?.code === 'auth/too-many-requests') {
        setError('Too many requests. Please wait a moment or use a test phone number.');
      } else {
        setError(e.message || 'Failed to send OTP. Try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBypassSetup = async () => {
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    if (!cleanPhone || cleanPhone.length < 10) {
      setError('Enter a valid 10-digit phone number first');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const adminUid = `admin_${cleanPhone}`;
      let existingAdmin: AuthUser | null = null;

      if (isFirebaseConfigured && firestore) {
        try {
          const adminDoc = await getDoc(doc(firestore, 'users', adminUid));
          if (adminDoc.exists()) {
            existingAdmin = adminDoc.data() as AuthUser;
          }
        } catch (_e) {}
      }

      if (!existingAdmin) {
        const authStore = localforage.createInstance({ name: 'BillItUpDB', storeName: 'auth' });
        const localUser = await authStore.getItem<AuthUser>('current_user');
        if (localUser && (localUser.phoneNumber || '').replace(/\D/g, '').slice(-10) === cleanPhone && localUser.role === 'admin') {
          existingAdmin = localUser;
        }
      }

      if (existingAdmin) {
        initUserVault(existingAdmin.uid);
        await login(existingAdmin);
        await setFirstLaunchDone();
        onComplete();
        return;
      }

      setStep('details');
    } catch (e: any) {
      setError(e.message || 'Setup error');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp || otp.length < 6) {
      setError('Enter the 6-digit OTP');
      return;
    }
    setLoading(true);
    setError('');

    try {
      await confirmationResult.confirm(otp);
      const cleanPhone = phone.replace(/\D/g, '').slice(-10);
      const adminUid = `admin_${cleanPhone}`;

      // Check if this admin already exists in Firestore or local storage
      let existingAdmin: AuthUser | null = null;
      if (isFirebaseConfigured && firestore) {
        try {
          const adminDoc = await getDoc(doc(firestore, 'users', adminUid));
          if (adminDoc.exists()) {
            existingAdmin = adminDoc.data() as AuthUser;
          }
        } catch (_e) {}
      }

      if (!existingAdmin) {
        const authStore = localforage.createInstance({ name: 'BillItUpDB', storeName: 'auth' });
        const localUser = await authStore.getItem<AuthUser>('current_user');
        if (localUser && (localUser.phoneNumber || '').replace(/\D/g, '').slice(-10) === cleanPhone && localUser.role === 'admin') {
          existingAdmin = localUser;
        }
      }

      if (existingAdmin) {
        // Returning Admin: Login immediately & load all their data!
        initUserVault(existingAdmin.uid);
        await login(existingAdmin);
        await setFirstLaunchDone();
        onComplete();
        return;
      }

      // First-time Admin: proceed to business details setup
      setStep('details');
    } catch (e: any) {
      setError('Invalid OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteSetup = async () => {
    if (!businessName.trim() || !adminName.trim()) {
      setError('Business name and your name are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const adminUser: AuthUser = {
        uid: `admin_${phone.replace(/\D/g, '')}`,
        phoneNumber: phone.replace(/\D/g, ''),
        name: adminName.trim(),
        role: 'admin',
        businessName: businessName.trim(),
        businessAddress: address.trim(),
      };

      // Save admin to Firestore
      if (isFirebaseConfigured && firestore) {
        await setDoc(doc(firestore, 'users', adminUser.uid), {
          ...adminUser,
          createdAt: Date.now(),
        });
        // Also save business info
        await setDoc(doc(firestore, 'business', 'info'), {
          name: businessName.trim(),
          address: address.trim(),
          adminPhone: phone.replace(/\D/g, ''),
          createdAt: Date.now(),
        });
      }

      await saveProfile({
        businessName: businessName.trim(),
        userName: adminName.trim(),
        phone: phone.replace(/\D/g, '').slice(-10),
      }, adminUser.uid);

      initUserVault(adminUser.uid);
      await login(adminUser);
      await setFirstLaunchDone();
      onComplete();
    } catch (e: any) {
      setError(e.message || 'Setup failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      transition={{ duration: 0.4, ease }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="fixed inset-0 z-[9999] bg-surface flex flex-col pt-16 px-6 pb-6 overflow-y-auto"
    >
      <button 
        onClick={() => {
          if (step === 'otp') setStep('phone');
          else if (step === 'details') setStep('otp');
          else onBack();
        }} 
        className="flex items-center gap-2 text-on-surface-variant mb-6 mt-1 active:scale-95 transition-transform w-fit"
      >
        <FiArrowLeft className="w-5 h-5" />
        <span className="font-body font-medium">Back</span>
      </button>

      <div className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 flex items-center justify-center text-white shadow-xl mb-6">
          <FiShield className="w-8 h-8" />
        </div>

        <h2 className="font-['Manrope'] font-extrabold text-2xl text-on-surface mb-1 tracking-tight">
          {step === 'phone' ? 'Admin Setup' : step === 'otp' ? 'Verify OTP' : 'Business Details'}
        </h2>
        <p className="font-body text-on-surface-variant/60 text-sm mb-8">
          {step === 'phone' ? 'Enter your phone number to get started' : step === 'otp' ? 'Enter the code sent to your phone' : 'Tell us about your business'}
        </p>

        <AnimatePresence mode="wait">
          {step === 'phone' && (
            <motion.div key="phone" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full flex flex-col gap-4">
              <div className="relative">
                <FiPhone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-variant/40" />
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="Phone number (e.g. 9876543210)"
                  className="w-full h-14 pl-12 pr-4 rounded-2xl bg-surface-container-low border border-outline-variant/20 font-body text-on-surface focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
              <button
                onClick={handleSendOTP}
                disabled={loading}
                className="w-full h-14 bg-primary text-on-primary font-['Manrope'] font-bold rounded-full shadow-lg active:scale-95 transition-all disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send OTP'}
              </button>

              {error && (
                <button
                  onClick={handleBypassSetup}
                  type="button"
                  className="w-full py-2.5 text-xs font-bold text-primary hover:underline transition-colors"
                >
                  ⚡ Skip OTP & Continue Setup in Offline Mode
                </button>
              )}
            </motion.div>
          )}

          {step === 'otp' && (
            <motion.div key="otp" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full flex flex-col gap-4">
              <div className="relative">
                <FiLock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-variant/40" />
                <input
                  type="number"
                  value={otp}
                  onChange={e => setOtp(e.target.value)}
                  placeholder="6-digit OTP"
                  maxLength={6}
                  className="w-full h-14 pl-12 pr-4 rounded-2xl bg-surface-container-low border border-outline-variant/20 font-body text-on-surface focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
              <button
                onClick={handleVerifyOTP}
                disabled={loading}
                className="w-full h-14 bg-primary text-on-primary font-['Manrope'] font-bold rounded-full shadow-lg active:scale-95 transition-all disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify OTP'}
              </button>
            </motion.div>
          )}

          {step === 'details' && (
            <motion.div key="details" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full flex flex-col gap-4">
              <div className="relative">
                <FiUser className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-variant/40" />
                <input
                  type="text"
                  value={adminName}
                  onChange={e => setAdminName(e.target.value)}
                  placeholder="Your Name"
                  className="w-full h-14 pl-12 pr-4 rounded-2xl bg-surface-container-low border border-outline-variant/20 font-body text-on-surface focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
              <div className="relative">
                <FiBriefcase className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-variant/40" />
                <input
                  type="text"
                  value={businessName}
                  onChange={e => setBusinessName(e.target.value)}
                  placeholder="Business Name"
                  className="w-full h-14 pl-12 pr-4 rounded-2xl bg-surface-container-low border border-outline-variant/20 font-body text-on-surface focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
              <div className="relative">
                <FiMapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-variant/40" />
                <input
                  type="text"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder="Business Address (optional)"
                  className="w-full h-14 pl-12 pr-4 rounded-2xl bg-surface-container-low border border-outline-variant/20 font-body text-on-surface focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
              <button
                onClick={handleCompleteSetup}
                disabled={loading}
                className="w-full h-14 bg-primary text-on-primary font-['Manrope'] font-bold rounded-full shadow-lg active:scale-95 transition-all disabled:opacity-50"
              >
                {loading ? 'Setting up...' : 'Complete Setup'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 text-error font-body text-sm text-center">
            {error}
          </motion.p>
        )}
      </div>

      <div id="recaptcha-container" />
    </motion.div>
  );
}

// ─────────────────────────────────────────────
// USER (STAFF) LOGIN FLOW
// ─────────────────────────────────────────────

function UserLogin({ onBack, onComplete }: { onBack: () => void; onComplete: () => void }) {
  const { login, setFirstLaunchDone } = useAuth();
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<any>(null);

  // Swipe back gesture handler
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    const handleBackButton = async () => {
      const listener = await CapacitorApp.addListener('backButton', () => {
        if (step === 'otp') {
          setStep('phone');
        } else {
          onBack();
        }
      });
      return listener;
    };

    let listenerPromise = handleBackButton();
    return () => {
      listenerPromise.then(l => l.remove());
    };
  }, [step, onBack]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const startX = touchStartX.current;
    const startY = touchStartY.current;
    if (startX !== null && startY !== null) {
      const deltaX = e.changedTouches[0].clientX - startX;
      const deltaY = Math.abs(e.changedTouches[0].clientY - startY);
      // Swipe right gesture detected (> 60px horizontal dominant)
      if (deltaX > 60 && deltaX > deltaY * 1.3) {
        if (step === 'otp') setStep('phone');
        else onBack();
      }
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  const setupRecaptcha = (containerId: string) => {
    try {
      if ((window as any).recaptchaVerifier) {
        (window as any).recaptchaVerifier.clear();
        delete (window as any).recaptchaVerifier;
      }
    } catch (_e) {
      // ignore
    }
    (window as any).recaptchaVerifier = new RecaptchaVerifier(firebaseAuth, containerId, {
      size: 'invisible',
    });
  };

  const handleSendOTP = async () => {
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    if (!cleanPhone || cleanPhone.length < 10) {
      setError('Enter a valid 10-digit phone number');
      return;
    }
    setLoading(true);
    setError('');

    try {
      // First check if user is registered by admin
      if (isFirebaseConfigured && firestore) {
        const q = query(collection(firestore, 'users'));
        const snap = await getDocs(q);
        const userDoc = snap.docs.find(d => {
          const data = d.data();
          const p = (data.phoneNumber || '').replace(/\D/g, '').slice(-10);
          return p === cleanPhone && data.role === 'user';
        });

        if (!userDoc) {
          setError('No staff user registered with this number. Kindly contact the admin of your business.');
          setLoading(false);
          return;
        }
      }

      setupRecaptcha('recaptcha-container-user');
      const formattedPhone = `+91${cleanPhone}`;
      const result = await signInWithPhoneNumber(firebaseAuth, formattedPhone, (window as any).recaptchaVerifier);
      setConfirmationResult(result);
      setStep('otp');
    } catch (e: any) {
      console.error('[AUTH] User OTP send failed:', e);
      if (e?.code === 'auth/operation-not-allowed' || e?.message?.includes('operation-not-allowed')) {
        setError('Phone Authentication is not enabled or saved in Firebase Console. Please enable Phone provider in Authentication > Sign-in method and click SAVE.');
      } else if (e?.code === 'auth/configuration-not-found' || e?.message?.includes('configuration-not-found')) {
        setError('Firebase Phone Auth is disabled in Firebase Console. Please enable Phone provider in Authentication > Sign-in method.');
      } else {
        setError(e.message || 'Failed to send OTP. Try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp || otp.length < 6) {
      setError('Enter the 6-digit OTP');
      return;
    }
    setLoading(true);
    setError('');

    try {
      await confirmationResult.confirm(otp);
      const cleanPhone = phone.replace(/\D/g, '').slice(-10);

      // Find user details
      let userData: AuthUser = {
        uid: `user_${cleanPhone}`,
        phoneNumber: cleanPhone,
        name: 'Staff User',
        role: 'user',
      };

      if (isFirebaseConfigured && firestore) {
        const q = query(collection(firestore, 'users'));
        const snap = await getDocs(q);
        const docMatch = snap.docs.find(d => {
          const data = d.data();
          return (data.phoneNumber || '').replace(/\D/g, '').slice(-10) === cleanPhone;
        });
        if (docMatch) {
          userData = { ...userData, ...docMatch.data() } as AuthUser;
        }
      }

      initUserVault(userData.uid);
      await login(userData);
      await setFirstLaunchDone();
      onComplete();
    } catch (e: any) {
      setError('Invalid OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      transition={{ duration: 0.4, ease }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="fixed inset-0 z-[9999] bg-surface flex flex-col pt-16 px-6 pb-6 overflow-y-auto"
    >
      <button 
        onClick={() => {
          if (step === 'otp') setStep('phone');
          else onBack();
        }} 
        className="flex items-center gap-2 text-on-surface-variant mb-6 mt-1 active:scale-95 transition-transform w-fit"
      >
        <FiArrowLeft className="w-5 h-5" />
        <span className="font-body font-medium">Back</span>
      </button>

      <div className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-600 flex items-center justify-center text-white shadow-xl mb-6">
          <FiUser className="w-8 h-8" />
        </div>

        <h2 className="font-['Manrope'] font-extrabold text-2xl text-on-surface mb-1 tracking-tight">
          {step === 'phone' ? 'Staff Login' : 'Verify OTP'}
        </h2>
        <p className="font-body text-on-surface-variant/60 text-sm mb-8">
          {step === 'phone' ? 'Your admin must have registered your number' : 'Enter the code sent to your phone'}
        </p>

        <AnimatePresence mode="wait">
          {step === 'phone' && (
            <motion.div key="phone" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full flex flex-col gap-4">
              <div className="relative">
                <FiPhone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-variant/40" />
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="Phone number"
                  className="w-full h-14 pl-12 pr-4 rounded-2xl bg-surface-container-low border border-outline-variant/20 font-body text-on-surface focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
              <button
                onClick={handleSendOTP}
                disabled={loading}
                className="w-full h-14 bg-primary text-on-primary font-['Manrope'] font-bold rounded-full shadow-lg active:scale-95 transition-all disabled:opacity-50"
              >
                {loading ? 'Checking...' : 'Send OTP'}
              </button>
            </motion.div>
          )}

          {step === 'otp' && (
            <motion.div key="otp" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full flex flex-col gap-4">
              <div className="relative">
                <FiLock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-variant/40" />
                <input
                  type="number"
                  value={otp}
                  onChange={e => setOtp(e.target.value)}
                  placeholder="6-digit OTP"
                  maxLength={6}
                  className="w-full h-14 pl-12 pr-4 rounded-2xl bg-surface-container-low border border-outline-variant/20 font-body text-on-surface focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
              <button
                onClick={handleVerifyOTP}
                disabled={loading}
                className="w-full h-14 bg-primary text-on-primary font-['Manrope'] font-bold rounded-full shadow-lg active:scale-95 transition-all disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify & Login'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 text-error font-body text-sm text-center">
            {error}
          </motion.p>
        )}
      </div>

      <div id="recaptcha-container-user" />
    </motion.div>
  );
}

// ─────────────────────────────────────────────
// CLIENT LOGIN FLOW
// ─────────────────────────────────────────────

function ClientLogin({ onBack, onComplete }: { onBack: () => void; onComplete: () => void }) {
  const { login, setFirstLaunchDone, setClientSession } = useAuth();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Swipe back gesture handler
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    const handleBackButton = async () => {
      const listener = await CapacitorApp.addListener('backButton', () => {
        onBack();
      });
      return listener;
    };

    let listenerPromise = handleBackButton();
    return () => {
      listenerPromise.then(l => l.remove());
    };
  }, [onBack]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const startX = touchStartX.current;
    const startY = touchStartY.current;
    if (startX !== null && startY !== null) {
      const deltaX = e.changedTouches[0].clientX - startX;
      const deltaY = Math.abs(e.changedTouches[0].clientY - startY);
      if (deltaX > 60 && deltaX > deltaY * 1.3) {
        onBack();
      }
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  const handleLogin = async () => {
    if (!phone || !name || !password) {
      setError('All fields are required');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const cleanPhone = phone.replace(/[\s\-()]/g, '');
      const session = await getClientSession(cleanPhone, password.trim());

      if (!session) {
        setError('Invalid credentials. Kindly contact your business admin for a valid password.');
        setLoading(false);
        return;
      }

      // Check expiry
      if (session.expiresAt < Date.now()) {
        setError('This session has expired. Please contact your business admin for a new password.');
        setLoading(false);
        return;
      }

      // Check if active
      if (session.isActive === false) {
        setError('This session has been deactivated by the admin.');
        setLoading(false);
        return;
      }

      const clientUser: AuthUser = {
        uid: `client_${cleanPhone}`,
        phoneNumber: cleanPhone,
        name: name.trim(),
        role: 'client',
      };

      const clientSessionData: ClientSession = {
        phoneNumber: cleanPhone,
        name: name.trim(),
        expiresAt: session.expiresAt,
        tempPassword: password.trim(),
        isActive: true,
      };

      // Save session to local auth store
      const authStore = localforage.createInstance({ name: 'BillItUpDB', storeName: 'auth' });
      await authStore.setItem('client_session', clientSessionData);

      initUserVault(clientUser.uid);
      setClientSession(clientSessionData);
      await login(clientUser);
      await setFirstLaunchDone();
      onComplete();
    } catch (e: any) {
      setError(e.message || 'Login failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      transition={{ duration: 0.4, ease }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="fixed inset-0 z-[9999] bg-surface flex flex-col pt-16 px-6 pb-6 overflow-y-auto"
    >
      <button onClick={onBack} className="flex items-center gap-2 text-on-surface-variant mb-6 mt-1 active:scale-95 transition-transform w-fit">
        <FiArrowLeft className="w-5 h-5" />
        <span className="font-body font-medium">Back</span>
      </button>

      <div className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center text-white shadow-xl mb-6">
          <FiUsers className="w-8 h-8" />
        </div>

        <h2 className="font-['Manrope'] font-extrabold text-2xl text-on-surface mb-1 tracking-tight">
          Client Login
        </h2>
        <p className="font-body text-on-surface-variant/60 text-sm mb-8">
          Enter the credentials provided by your business admin
        </p>

        <div className="w-full flex flex-col gap-4">
          <div className="relative">
            <FiPhone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-variant/40" />
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="Phone number"
              className="w-full h-14 pl-12 pr-4 rounded-2xl bg-surface-container-low border border-outline-variant/20 font-body text-on-surface focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>
          <div className="relative">
            <FiUser className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-variant/40" />
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              className="w-full h-14 pl-12 pr-4 rounded-2xl bg-surface-container-low border border-outline-variant/20 font-body text-on-surface focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>
          <div className="relative">
            <FiLock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-variant/40" />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Temporary password"
              className="w-full h-14 pl-12 pr-4 rounded-2xl bg-surface-container-low border border-outline-variant/20 font-body text-on-surface focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full h-14 bg-primary text-on-primary font-['Manrope'] font-bold rounded-full shadow-lg active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </div>

        {error && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 text-error font-body text-sm text-center">
            {error}
          </motion.p>
        )}
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────
// MAIN AUTH ROUTER — Orchestrates all flows
// ─────────────────────────────────────────────

export default function AuthRouter({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [screen, setScreen] = useState<'welcome' | 'admin' | 'user' | 'client'>('welcome');

  return (
    <AnimatePresence mode="wait">
      {screen === 'welcome' && (
        <WelcomeScreen
          key="welcome"
          onSelectRole={(role) => {
            if (role === 'admin') setScreen('admin');
            else if (role === 'user') setScreen('user');
            else if (role === 'client') setScreen('client');
          }}
        />
      )}
      {screen === 'admin' && (
        <AdminSetup
          key="admin"
          onBack={() => setScreen('welcome')}
          onComplete={onAuthenticated}
        />
      )}
      {screen === 'user' && (
        <UserLogin
          key="user"
          onBack={() => setScreen('welcome')}
          onComplete={onAuthenticated}
        />
      )}
      {screen === 'client' && (
        <ClientLogin
          key="client"
          onBack={() => setScreen('welcome')}
          onComplete={onAuthenticated}
        />
      )}
    </AnimatePresence>
  );
}
