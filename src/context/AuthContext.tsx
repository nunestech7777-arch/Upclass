import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { fetchMyAccess, type MyAccess } from '../lib/accessApi';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** Papel e vínculo da conta logada (null enquanto carrega ou sem sessão). */
  access: MyAccess | null;
  accessLoading: boolean;
  accessError: string | null;
  reloadAccess: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // Safety fallback: ensure loading never gets stuck
    const fallbackTimer = setTimeout(() => {
      if (mounted && loading) {
        setLoading(false);
      }
    }, 1500);

    async function initAuth() {
      if (!isSupabaseConfigured) {
        if (mounted) setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.warn('Supabase auth getSession warning:', error.message);
        }
        if (mounted) {
          setSession(data?.session ?? null);
          setLoading(false);
        }
      } catch (err) {
        console.warn('Failed to load session:', err);
        if (mounted) {
          setLoading(false);
        }
      }
    }

    initAuth();

    let unsubscribe = () => {};
    try {
      if (isSupabaseConfigured) {
        const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
          if (mounted) {
            setSession(newSession);
            setLoading(false);
          }
        });
        unsubscribe = () => subscription.subscription.unsubscribe();
      }
    } catch (err) {
      console.warn('Failed to listen to auth state changes:', err);
    }

    return () => {
      mounted = false;
      clearTimeout(fallbackTimer);
      unsubscribe();
    };
  }, []);

  // Papel da conta: recarregado a cada troca de usuário (login, logout, convite aceito).
  const userId = session?.user?.id ?? null;
  const [access, setAccess] = useState<MyAccess | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessNonce, setAccessNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setAccess(null);
    setAccessError(null);
    if (!userId || !isSupabaseConfigured) {
      setAccessLoading(false);
      return;
    }
    setAccessLoading(true);
    fetchMyAccess()
      .then((a) => alive && setAccess(a))
      .catch((err: Error) => alive && setAccessError(err.message))
      .finally(() => alive && setAccessLoading(false));
    return () => {
      alive = false;
    };
  }, [userId, accessNonce]);

  const signOut = async () => {
    try {
      if (isSupabaseConfigured) {
        await supabase.auth.signOut();
      }
    } catch (err) {
      console.warn('Sign out error:', err);
    } finally {
      setSession(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        access,
        accessLoading: accessLoading || (!!userId && !access && !accessError),
        accessError,
        reloadAccess: () => setAccessNonce((n) => n + 1),
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

