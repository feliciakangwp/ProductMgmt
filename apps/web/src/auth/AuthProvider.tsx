import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { backend, type SessionInfo } from '../lib/backend';

interface AuthState {
  session: SessionInfo | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });

  useEffect(() => {
    let active = true;
    backend.auth.getSession().then((session) => {
      if (active) setState({ session, loading: false });
    });
    const unsubscribe = backend.auth.onChange((session) => setState({ session, loading: false }));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
