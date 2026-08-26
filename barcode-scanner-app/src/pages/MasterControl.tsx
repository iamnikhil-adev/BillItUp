import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiUserPlus, FiTrash2, FiClock, FiKey, FiXCircle, FiPlusCircle } from 'react-icons/fi';
import { useAlert } from '../context/AlertContext';
import { firestore, isFirebaseConfigured } from '../utils/firebase';
import { collection, doc, setDoc, deleteDoc, query, onSnapshot } from 'firebase/firestore';

const ease: any = [0.23, 1, 0.32, 1];

interface ManagedUser {
  uid: string;
  phoneNumber: string;
  name: string;
  role: string;
  createdAt: number;
}

interface ClientSessionRecord {
  id: string;
  phoneNumber: string;
  clientName: string;
  tempPassword: string;
  expiresAt: number;
  isActive: boolean;
  createdAt: number;
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let pw = '';
  for (let i = 0; i < 8; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

export default function MasterControl({ direction }: { direction: number }) {
  const navigate = useNavigate();
  const { showAlert, showConfirm } = useAlert();
  const [tab, setTab] = useState<'users' | 'sessions'>('users');

  // User Management
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');

  // Session Management
  const [sessions, setSessions] = useState<ClientSessionRecord[]>([]);
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [sessionPhone, setSessionPhone] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [sessionDuration, setSessionDuration] = useState(60); // minutes
  const [loading, setLoading] = useState(false);

  const [, setNow] = useState(Date.now());

  // 10-second ticker to update countdowns live
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  // Live-load users
  useEffect(() => {
    if (!isFirebaseConfigured || !firestore) return;
    const unsubscribe = onSnapshot(query(collection(firestore, 'users')), (snap) => {
      const list: ManagedUser[] = [];
      snap.forEach((d) => {
        const data = d.data();
        if (data.role === 'user') list.push({ uid: d.id, ...data } as ManagedUser);
      });
      setUsers(list.sort((a, b) => b.createdAt - a.createdAt));
    });
    return () => unsubscribe();
  }, []);

  // Live-load sessions
  useEffect(() => {
    if (!isFirebaseConfigured || !firestore) return;
    const unsubscribe = onSnapshot(query(collection(firestore, 'sessions')), (snap) => {
      const list: ClientSessionRecord[] = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...d.data() } as ClientSessionRecord);
      });
      setSessions(list.sort((a, b) => b.createdAt - a.createdAt));
    });
    return () => unsubscribe();
  }, []);

  // Add User
  const handleAddUser = async () => {
    const cleanPhone = newUserPhone.replace(/\D/g, '').slice(-10);
    if (!newUserName.trim() || cleanPhone.length < 10) {
      showAlert({ title: 'Invalid Details', message: 'Please provide a valid name and 10-digit phone number.', type: 'warning' });
      return;
    }
    setLoading(true);
    try {
      const uid = `user_${cleanPhone}`;
      await setDoc(doc(firestore!, 'users', uid), {
        uid,
        phoneNumber: cleanPhone,
        name: newUserName.trim(),
        role: 'user',
        createdAt: Date.now(),
      });
      setNewUserName('');
      setNewUserPhone('');
      setShowAddUser(false);
      showAlert({ title: 'User Added', message: `${newUserName.trim()} has been added.`, type: 'success' });
    } catch (e: any) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Remove User
  const handleRemoveUser = (user: ManagedUser) => {
    showConfirm(
      `Remove ${user.name} (${user.phoneNumber})? They will no longer be able to log in.`,
      async () => {
        try {
          await deleteDoc(doc(firestore!, 'users', user.uid));
          showAlert({ title: 'Removed', message: `${user.name} has been removed.`, type: 'success' });
        } catch (e: any) {
          showAlert({ title: 'Error', message: e.message, type: 'error' });
        }
      },
      'Remove User'
    );
  };

  const handleCreateSession = async () => {
    const cleanPhone = sessionPhone.replace(/\D/g, '').slice(-10);
    if (!sessionName.trim() || cleanPhone.length < 10) {
      showAlert({ title: 'Invalid Details', message: 'Please provide client name and a valid 10-digit phone number.', type: 'warning' });
      return;
    }
    setLoading(true);
    try {
      const tempPassword = generatePassword();
      const expiresAt = Date.now() + sessionDuration * 60 * 1000;
      const sessionId = `session_${cleanPhone}_${Date.now()}`;

      await setDoc(doc(firestore!, 'sessions', sessionId), {
        phoneNumber: cleanPhone,
        clientName: sessionName.trim(),
        tempPassword,
        expiresAt,
        isActive: true,
        createdAt: Date.now(),
      });

      setSessionPhone('');
      setSessionName('');
      setShowCreateSession(false);
      showAlert({
        title: 'Session Created',
        message: `Password: ${tempPassword}\nExpires in ${sessionDuration} minutes.\n\nShare this password with the client.`,
        type: 'success'
      });
    } catch (e: any) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Extend Session
  const handleExtendSession = async (session: ClientSessionRecord, extraMinutes: number) => {
    try {
      const newExpiry = Math.max(session.expiresAt, Date.now()) + extraMinutes * 60 * 1000;
      await setDoc(doc(firestore!, 'sessions', session.id), {
        ...session,
        expiresAt: newExpiry,
      }, { merge: true });
      showAlert({ title: 'Extended', message: `Session extended by ${extraMinutes} minutes.`, type: 'success' });
    } catch (e: any) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    }
  };

  // Deactivate Session
  const handleDeactivateSession = async (session: ClientSessionRecord) => {
    try {
      await setDoc(doc(firestore!, 'sessions', session.id), {
        ...session,
        isActive: false,
        expiresAt: Date.now(), // Expire immediately
      }, { merge: true });
      showAlert({ title: 'Deactivated', message: 'Session has been terminated.', type: 'success' });
    } catch (e: any) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    }
  };

  const getSessionStatus = (session: ClientSessionRecord) => {
    if (!session.isActive) return { label: 'Deactivated', color: 'bg-on-surface-variant/20 text-on-surface-variant' };
    if (session.expiresAt < Date.now()) return { label: 'Expired', color: 'bg-error/10 text-error' };
    return { label: 'Active', color: 'bg-success/10 text-success' };
  };

  const formatTimeLeft = (expiresAt: number) => {
    const diff = expiresAt - Date.now();
    if (diff <= 0) return 'Expired';
    const m = Math.floor(diff / 60000);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m left`;
    return `${m}m left`;
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
      transition={{ duration: 0.35, ease }}
      className="bg-surface text-on-surface font-body antialiased min-h-screen flex flex-col pb-8 motion-root"
    >
      {/* Header with Safe Area Top Padding */}
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-xl px-5 pt-14 pb-4 flex items-center gap-4 border-b border-outline-variant/10 shadow-sm">
        <button onClick={() => navigate('/')} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container transition-colors active:scale-95">
          <FiArrowLeft className="w-5 h-5 text-on-surface" />
        </button>
        <h1 className="font-['Manrope'] font-extrabold text-xl text-on-surface tracking-tight">Master Control</h1>
      </header>

      {/* Tabs */}
      <div className="flex gap-2 px-5 pt-4 pb-2">
        {(['users', 'sessions'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 rounded-2xl font-['Manrope'] font-bold text-sm transition-all ${
              tab === t
                ? 'bg-primary text-on-primary shadow-lg'
                : 'bg-surface-container-low text-on-surface-variant'
            }`}
          >
            {t === 'users' ? 'Staff Users' : 'Client Sessions'}
          </button>
        ))}
      </div>

      <main className="flex-1 px-5 pt-4">
        <AnimatePresence mode="wait">
          {/* ──── USERS TAB ──── */}
          {tab === 'users' && (
            <motion.div key="users" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <button
                onClick={() => setShowAddUser(true)}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-primary/10 text-primary font-['Manrope'] font-bold text-sm mb-4 active:scale-95 transition-transform"
              >
                <FiUserPlus className="w-5 h-5" />
                Add Staff User
              </button>

              {users.length === 0 ? (
                <p className="text-center text-on-surface-variant/50 py-8 font-medium">No staff users added yet.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {users.map((user) => (
                    <div key={user.uid} className="glass-card rounded-[20px] p-4 flex items-center justify-between border border-outline-variant/15">
                      <div>
                        <h3 className="font-['Manrope'] font-bold text-on-surface">{user.name}</h3>
                        <p className="font-body text-on-surface-variant/60 text-xs">{user.phoneNumber}</p>
                      </div>
                      <button
                        onClick={() => handleRemoveUser(user)}
                        className="w-10 h-10 rounded-full flex items-center justify-center text-error hover:bg-error/10 transition-colors"
                      >
                        <FiTrash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* ──── SESSIONS TAB ──── */}
          {tab === 'sessions' && (
            <motion.div key="sessions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <button
                onClick={() => setShowCreateSession(true)}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-primary/10 text-primary font-['Manrope'] font-bold text-sm mb-4 active:scale-95 transition-transform"
              >
                <FiKey className="w-5 h-5" />
                Generate Client Password
              </button>

              {sessions.length === 0 ? (
                <p className="text-center text-on-surface-variant/50 py-8 font-medium">No client sessions yet.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {sessions.map((session) => {
                    const status = getSessionStatus(session);
                    return (
                      <div key={session.id} className="glass-card rounded-[20px] p-4 border border-outline-variant/15">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h3 className="font-['Manrope'] font-bold text-on-surface">{session.clientName}</h3>
                            <p className="font-body text-on-surface-variant/60 text-xs">{session.phoneNumber}</p>
                          </div>
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${status.color}`}>
                            {status.label}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 mt-2 text-xs text-on-surface-variant/50">
                          <FiKey className="w-3 h-3" />
                          <span className="font-mono font-bold tracking-wider">{session.tempPassword}</span>
                          <span className="mx-1">•</span>
                          <FiClock className="w-3 h-3" />
                          <span>{formatTimeLeft(session.expiresAt)}</span>
                        </div>

                        {session.isActive && session.expiresAt > Date.now() && (
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => handleExtendSession(session, 30)}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-surface-container-high text-on-surface text-xs font-bold active:scale-95 transition-transform"
                            >
                              <FiPlusCircle className="w-3.5 h-3.5" />
                              +30 min
                            </button>
                            <button
                              onClick={() => handleExtendSession(session, 60)}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-surface-container-high text-on-surface text-xs font-bold active:scale-95 transition-transform"
                            >
                              <FiPlusCircle className="w-3.5 h-3.5" />
                              +1 hour
                            </button>
                            <button
                              onClick={() => handleDeactivateSession(session)}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-error/10 text-error text-xs font-bold active:scale-95 transition-transform"
                            >
                              <FiXCircle className="w-3.5 h-3.5" />
                              Revoke
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ──── ADD USER MODAL ──── */}
      <AnimatePresence>
        {showAddUser && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-black/40 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.94, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 1, opacity: 0, filter: 'blur(10px)', transition: { duration: 0.2 } }}
              transition={{ type: 'spring', damping: 25, stiffness: 400 }}
              className="bg-surface-container-lowest w-full max-w-sm rounded-[32px] overflow-hidden shadow-2xl border border-outline-variant/10 p-8"
            >
              <h3 className="text-xl font-['Manrope'] font-bold text-on-surface mb-6 text-center">Add Staff User</h3>
              <input
                type="text"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="Staff Name"
                className="w-full h-14 px-4 rounded-2xl bg-surface-container-low border border-outline-variant/20 font-body text-on-surface focus:outline-none focus:border-primary/50 transition-colors mb-3"
              />
              <input
                type="tel"
                value={newUserPhone}
                onChange={(e) => setNewUserPhone(e.target.value)}
                placeholder="Phone Number"
                className="w-full h-14 px-4 rounded-2xl bg-surface-container-low border border-outline-variant/20 font-body text-on-surface focus:outline-none focus:border-primary/50 transition-colors mb-6"
              />
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleAddUser}
                  disabled={loading || !newUserName.trim() || !newUserPhone.trim()}
                  className="w-full h-14 bg-primary text-on-primary font-['Manrope'] font-bold rounded-full shadow-lg active:scale-95 transition-all disabled:opacity-50"
                >
                  {loading ? 'Adding...' : 'Add User'}
                </button>
                <button
                  onClick={() => setShowAddUser(false)}
                  className="w-full h-14 bg-surface-container-high text-on-surface font-['Manrope'] font-bold rounded-full active:scale-95 transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ──── CREATE SESSION MODAL ──── */}
      <AnimatePresence>
        {showCreateSession && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-black/40 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.94, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 1, opacity: 0, filter: 'blur(10px)', transition: { duration: 0.2 } }}
              transition={{ type: 'spring', damping: 25, stiffness: 400 }}
              className="bg-surface-container-lowest w-full max-w-sm rounded-[32px] overflow-hidden shadow-2xl border border-outline-variant/10 p-8"
            >
              <h3 className="text-xl font-['Manrope'] font-bold text-on-surface mb-6 text-center">Generate Client Password</h3>
              <input
                type="text"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder="Client Name"
                className="w-full h-14 px-4 rounded-2xl bg-surface-container-low border border-outline-variant/20 font-body text-on-surface focus:outline-none focus:border-primary/50 transition-colors mb-3"
              />
              <input
                type="tel"
                value={sessionPhone}
                onChange={(e) => setSessionPhone(e.target.value)}
                placeholder="Client Phone Number"
                className="w-full h-14 px-4 rounded-2xl bg-surface-container-low border border-outline-variant/20 font-body text-on-surface focus:outline-none focus:border-primary/50 transition-colors mb-3"
              />
              <div className="mb-6">
                <label className="text-[11px] font-bold text-on-surface-variant/60 mb-2 block ml-1">Session Duration</label>
                <div className="flex gap-2">
                  {[30, 60, 120, 480].map((m) => (
                    <button
                      key={m}
                      onClick={() => setSessionDuration(m)}
                      className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all ${
                        sessionDuration === m
                          ? 'bg-primary text-on-primary shadow-md'
                          : 'bg-surface-container-high text-on-surface-variant'
                      }`}
                    >
                      {m < 60 ? `${m}m` : `${m / 60}h`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleCreateSession}
                  disabled={loading || !sessionName.trim() || !sessionPhone.trim()}
                  className="w-full h-14 bg-primary text-on-primary font-['Manrope'] font-bold rounded-full shadow-lg active:scale-95 transition-all disabled:opacity-50"
                >
                  {loading ? 'Generating...' : 'Generate Password'}
                </button>
                <button
                  onClick={() => setShowCreateSession(false)}
                  className="w-full h-14 bg-surface-container-high text-on-surface font-['Manrope'] font-bold rounded-full active:scale-95 transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
