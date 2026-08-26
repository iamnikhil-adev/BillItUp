import React, { createContext, useContext, useState, useEffect } from 'react';
import localforage from 'localforage';

export type UserRole = 'admin' | 'user' | 'client' | null;

export interface AuthUser {
  uid: string;
  phoneNumber: string;
  name: string;
  role: UserRole;
  businessName?: string;
  businessAddress?: string;
}

export interface ClientSession {
  phoneNumber: string;
  name: string;
  expiresAt: number; // Unix timestamp
  tempPassword: string;
  isActive: boolean;
}

import { initUserVault } from '../utils/db';

interface AuthContextType {
  currentUser: AuthUser | null;
  isLoading: boolean;
  isFirstLaunch: boolean;
  login: (user: AuthUser) => Promise<void>;
  updateUser: (updated: Partial<AuthUser>) => Promise<void>;
  logout: () => Promise<void>;
  setFirstLaunchDone: () => Promise<void>;
  clientSession: ClientSession | null;
  setClientSession: (session: ClientSession | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const authStore = localforage.createInstance({
  name: 'BillItUpDB',
  storeName: 'auth'
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFirstLaunch, setIsFirstLaunch] = useState(true);
  const [clientSession, setClientSession] = useState<ClientSession | null>(null);

  // Restore session on app open
  useEffect(() => {
    const restore = async () => {
      try {
        const savedUser = await authStore.getItem<AuthUser>('current_user');
        const firstLaunchDone = await authStore.getItem<boolean>('first_launch_done');
        
        if (firstLaunchDone) {
          setIsFirstLaunch(false);
        }

        if (savedUser) {
          initUserVault(savedUser.uid);
          // If it's a client, check session expiry
          if (savedUser.role === 'client') {
            const session = await authStore.getItem<ClientSession>('client_session');
            if (session && session.expiresAt > Date.now()) {
              setCurrentUser(savedUser);
              setClientSession(session);
            } else {
              // Session expired — auto logout
              await authStore.removeItem('current_user');
              await authStore.removeItem('client_session');
            }
          } else {
            setCurrentUser(savedUser);
          }
        }
      } catch (e) {
        console.error('[AUTH] Failed to restore session:', e);
      } finally {
        setIsLoading(false);
      }
    };
    restore();
  }, []);

  const login = async (user: AuthUser) => {
    initUserVault(user.uid);
    setCurrentUser(user);
    await authStore.setItem('current_user', user);
    console.log(`[AUTH] Logged in as ${user.role}: ${user.name}`);
  };

  const updateUser = async (updated: Partial<AuthUser>) => {
    if (!currentUser) return;
    const merged: AuthUser = { ...currentUser, ...updated };
    setCurrentUser(merged);
    await authStore.setItem('current_user', merged);
  };

  const logout = async () => {
    setCurrentUser(null);
    setClientSession(null);
    await authStore.removeItem('current_user');
    await authStore.removeItem('client_session');
    console.log('[AUTH] Logged out.');
  };

  const setFirstLaunchDone = async () => {
    setIsFirstLaunch(false);
    await authStore.setItem('first_launch_done', true);
  };

  return (
    <AuthContext.Provider value={{
      currentUser,
      isLoading,
      isFirstLaunch,
      login,
      updateUser,
      logout,
      setFirstLaunchDone,
      clientSession,
      setClientSession
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
