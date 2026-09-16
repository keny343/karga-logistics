import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type User } from '../api/client';

interface Sessao {
  readonly user: User | null;
  readonly loading: boolean;
  readonly login: (email: string, password: string) => Promise<void>;
  readonly logout: () => Promise<void>;
}

const SessionContext = createContext<Sessao | null>(null);

/**
 * The session is asked for once, on boot. /api/auth/me answers 200 with a null
 * user when nobody is signed in, so an anonymous visit does not fill the console
 * with 401s that look like faults.
 */
export const SessionProvider = ({ children }: { readonly children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let activo = true;
    api
      .me()
      .then(({ user: actual }) => {
        if (activo) setUser(actual);
      })
      .catch(() => {
        if (activo) setUser(null);
      })
      .finally(() => {
        if (activo) setLoading(false);
      });
    return () => {
      activo = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user: autenticado } = await api.login(email, password);
    setUser(autenticado);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const valor = useMemo<Sessao>(() => ({ user, loading, login, logout }), [user, loading, login, logout]);

  return <SessionContext.Provider value={valor}>{children}</SessionContext.Provider>;
};

export const useSession = (): Sessao => {
  const contexto = useContext(SessionContext);
  if (contexto === null) throw new Error('useSession exige <SessionProvider> acima na árvore.');
  return contexto;
};
