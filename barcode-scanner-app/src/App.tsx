import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ThemeProvider } from './context/ThemeContext';
import { AlertProvider } from './context/AlertContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { App as CapacitorApp } from '@capacitor/app';
import Dashboard from './pages/Dashboard';
import BackButtonHandler from './components/BackButtonHandler';
import { processRestoredImage } from './utils/recovery';

// Route-Level Code Splitting for Ultra-Fast Initial Load
const CreateBill = lazy(() => import('./pages/CreateBill'));
const Daybook = lazy(() => import('./pages/Daybook'));
const Profile = lazy(() => import('./pages/Profile'));
const ClientView = lazy(() => import('./pages/ClientView'));
const MasterControl = lazy(() => import('./pages/MasterControl'));
const Reports = lazy(() => import('./pages/Reports'));
const AuthRouter = lazy(() => import('./components/AuthRouter'));

const PageLoader = () => (
  <div className="fixed inset-0 bg-surface flex items-center justify-center z-[100]">
    <div className="w-8 h-8 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
  </div>
);
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { FCM } from '@capacitor-community/fcm';
import { subscribeToSyncPings } from './utils/db';
import { Capacitor } from '@capacitor/core';
import { APP_VERSION } from './version';

// Premium high-fidelity easing
const transitionEase: any = [0.23, 1, 0.32, 1];

function AnimatedRoutes() {
  const { currentUser } = useAuth();
  const location = useLocation();
  const [direction, setDirection] = useState(0); 
  const prevPathRef = useRef(location.pathname);

  useEffect(() => {
    const getDepth = (path: string) => (path === '/' ? 0 : 1);
    const oldDepth = getDepth(prevPathRef.current);
    const newDepth = getDepth(location.pathname);

    if (newDepth > oldDepth) setDirection(1); 
    else if (newDepth < oldDepth) setDirection(-1); 
    else setDirection(0); 

    prevPathRef.current = location.pathname;
  }, [location.pathname]);
  
  return (
    <Suspense fallback={<PageLoader />}>
      <AnimatePresence mode="popLayout" custom={direction}>
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={currentUser?.role === 'client' ? <ClientView direction={direction} /> : <Dashboard direction={direction} />} />
          <Route path="/create" element={<CreateBill direction={direction} />} />
          <Route path="/daybook" element={<Daybook direction={direction} />} />
          <Route path="/profile" element={<Profile direction={direction} />} />
          <Route path="/client" element={<ClientView direction={direction} />} />
          <Route path="/master-control" element={<MasterControl direction={direction} />} />
          <Route path="/reports" element={<Reports direction={direction} />} />
        </Routes>
      </AnimatePresence>
    </Suspense>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AlertProvider>
        <AuthProvider>
          <AppInner />
        </AuthProvider>
      </AlertProvider>
    </ThemeProvider>
  );
}

function AppInner() {
  const { currentUser, isLoading, isFirstLaunch } = useAuth();
  const navigateRef = useRef<any>(null);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    // Faster, snappier splash duration for a professional feel
    const timer = setTimeout(() => setShowSplash(false), 900);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const restoreListener = CapacitorApp.addListener('appRestoredResult', async (result) => {
      const recovered = await processRestoredImage(result);
      if (recovered && navigateRef.current) {
        navigateRef.current('/create', { replace: true });
      }
    });

    return () => {
      restoreListener.then(l => l.remove());
    };
  }, []);

  // Sync Notifications Logic
  useEffect(() => {
    const initNotifications = async () => {
      if (!Capacitor.isNativePlatform()) return;

      try {
        // 1. Local Notifications Permissions (Legacy)
        const localPerm = await LocalNotifications.requestPermissions();
        console.log('Local notifications permission:', localPerm.display);

        // 2. Push Notifications Setup (For "App Off" support)
        let pushPerm = await PushNotifications.checkPermissions();
        if (pushPerm.receive !== 'granted') {
          pushPerm = await PushNotifications.requestPermissions();
        }

        if (pushPerm.receive === 'granted') {
          await PushNotifications.register();
        }

        // Listen for registration success
        PushNotifications.addListener('registration', async (token) => {
          console.log('Push registration success, token: ' + token.value);
          
          // Subscribe to topic for background alerts
          try {
            await FCM.subscribeTo({ topic: 'all_bills' });
            console.log('Subscribed to topic: all_bills');
          } catch (err) {
            console.error('Failed to subscribe to FCM topic:', err);
          }
        });

        PushNotifications.addListener('registrationError', (error) => {
          console.error('Push registration error: ', error);
        });

        // Listen for notifications while app is in foreground
        PushNotifications.addListener('pushNotificationReceived', (notification) => {
          console.log('Push received in foreground:', notification);
        });

        // Listen for actions (when user clicks notification)
        PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          console.log('Push action performed:', action);
        });

      } catch (err) {
        console.error('Notification setup failed:', err);
      }
    };

    initNotifications();

    const unsubscribe = subscribeToSyncPings((billId, customerName) => {
      LocalNotifications.schedule({
        notifications: [
          {
            title: "New Bill Created 📄",
            body: `${customerName || 'A customer'} - ${billId}`,
            id: Math.floor(Math.random() * 10000),
            schedule: { at: new Date(Date.now() + 1000) },
            sound: 'default',
            actionTypeId: "",
            extra: null
          }
        ]
      });
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const isAuthenticated = !!currentUser;

  // Show nothing while loading auth state
  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-surface flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // Show auth flow if not authenticated or first launch
  if (!isAuthenticated || isFirstLaunch) {
    return (
      <Suspense fallback={<PageLoader />}>
        <AuthRouter onAuthenticated={() => {}} />
      </Suspense>
    );
  }

  return (
    <BrowserRouter>
      <AnimatePresence>
        {showSplash && (
          <motion.div 
            key="splash"
            initial={{ opacity: 1 }}
            exit={{ 
              opacity: 0, 
              scale: 1.02, 
              filter: 'blur(12px)',
              transition: { duration: 0.35, ease: transitionEase }
            }}
            className="fixed inset-0 z-[9999] bg-surface flex flex-col items-center justify-center motion-root"
          >
            <motion.div 
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.45, ease: transitionEase }}
              className="flex flex-col items-center"
            >
              <div className="w-24 h-24 rounded-[32px] bg-gradient-to-br from-primary to-primary-container flex items-center justify-center shadow-2xl mb-6">
                <span className="material-symbols-outlined text-[48px] text-on-primary" style={{fontVariationSettings: "'FILL' 1"}}>
                  barcode_scanner
                </span>
              </div>
              <h1 className="font-['Manrope'] font-extrabold text-3xl text-primary tracking-tight mb-2">BillItUp</h1>
              <p className="font-body text-on-surface-variant/60 text-sm tracking-[0.2em] uppercase font-bold">The Fluid Ledger</p>
            </motion.div>
            
            <div className="absolute bottom-10 left-10">
               <span className="font-mono text-[12px] font-bold text-on-surface-variant/40 tracking-widest uppercase">
                {APP_VERSION}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <BackButtonHandler />
      <AnimatedRoutesWithRef onNavigateRef={(nav: any) => navigateRef.current = nav} />
    </BrowserRouter>
  );
}

function AnimatedRoutesWithRef({ onNavigateRef }: { onNavigateRef: (nav: any) => void }) {
  const navigate = useNavigate();
  useEffect(() => {
    onNavigateRef(navigate);
  }, [navigate]);

  return <AnimatedRoutes />;
}

export default App;
