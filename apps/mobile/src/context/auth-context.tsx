import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { createClientLogger } from '@norish/shared/lib/logger';

import { getAuthClient } from '@/lib/auth-client';
import { type PersistedUser, readPersistedSession } from '@/lib/auth-storage';
import { clearAllQueryCaches } from '@/hooks/use-cache-lifecycle';
import { useNetworkStatus } from '@/context/network-context';

const log = createClientLogger('auth');

type AuthContextValue = {
  backendBaseUrl: string | null;
  authClient: ReturnType<typeof getAuthClient> | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  justLoggedOut: boolean;
  user: { id: string; email: string; name: string; image?: string | null } | null;
  signOut: () => Promise<void>;
  consumeLogoutFlag: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function AuthProviderInner({
  backendBaseUrl,
  children,
}: {
  backendBaseUrl: string;
  children: React.ReactNode;
}) {
  const authClient = useMemo(() => getAuthClient(backendBaseUrl), [backendBaseUrl]);
  const { data: session, isPending } = authClient.useSession();
  const [justLoggedOut, setJustLoggedOut] = useState(false);

  // Network awareness
  const { backendReachable, runtimeState } = useNetworkStatus();

  // Persisted session state (loaded once when backend is unreachable)
  const [persistedUser, setPersistedUser] = useState<PersistedUser | null>(null);
  const [persistedSessionStatus, setPersistedSessionStatus] = useState<'idle' | 'loading' | 'loaded'>('idle');

  const usePersistedAuth = runtimeState === 'ready' && !backendReachable;

  useEffect(() => {
    if (!usePersistedAuth || persistedSessionStatus !== 'idle') {
      return;
    }

    setPersistedSessionStatus('loading');

    void readPersistedSession().then((user) => {
      setPersistedUser(user);
      setPersistedSessionStatus('loaded');
    });
  }, [persistedSessionStatus, usePersistedAuth]);

  const { isAuthenticated, isLoading, user } = useMemo(() => {
    if (runtimeState === 'initializing') {
      return {
        isAuthenticated: false,
        isLoading: true,
        user: null,
      };
    }

    if (usePersistedAuth) {
      return {
        isAuthenticated: !!persistedUser,
        isLoading: persistedSessionStatus === 'loading',
        user: persistedUser,
      };
    }

    return {
      isAuthenticated: !!session?.user,
      isLoading: isPending,
      user: session?.user
        ? {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          image: session.user.image,
        }
        : null,
    };
  }, [isPending, persistedSessionStatus, persistedUser, runtimeState, session, usePersistedAuth]);

  const signOut = useCallback(async () => {
    clearAllQueryCaches();
    await authClient.signOut();
    setPersistedUser(null);
    setPersistedSessionStatus('idle');
    setJustLoggedOut(true);
  }, [authClient]);

  const consumeLogoutFlag = useCallback(() => {
    setJustLoggedOut(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      backendBaseUrl,
      authClient,
      isAuthenticated,
      isLoading,
      justLoggedOut,
      user,
      signOut,
      consumeLogoutFlag,
    }),
    [authClient, backendBaseUrl, consumeLogoutFlag, isAuthenticated, isLoading, justLoggedOut, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({
  backendBaseUrl,
  children,
}: {
  backendBaseUrl: string | null;
  children: React.ReactNode;
}) {
  const noUrlValue = useMemo<AuthContextValue>(
    () => ({
      backendBaseUrl: null,
      authClient: null,
      isAuthenticated: false,
      isLoading: false,
      justLoggedOut: false,
      user: null,
      signOut: async () => { },
      consumeLogoutFlag: () => { },
    }),
    [],
  );

  if (!backendBaseUrl) {
    return <AuthContext.Provider value={noUrlValue}>{children}</AuthContext.Provider>;
  }

  return <AuthProviderInner backendBaseUrl={backendBaseUrl}>{children}</AuthProviderInner>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}
