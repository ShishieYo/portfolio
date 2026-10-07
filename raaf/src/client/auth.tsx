import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { SessionUser } from "../shared/api";
import type { Permission } from "../shared/permissions";
import { api, ApiError } from "./api";

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (p: Permission) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.me().then(setUser).catch((e) => { if (!(e instanceof ApiError && e.status === 401)) throw e; }).finally(() => setLoading(false));
  }, []);

  const value: AuthState = {
    user,
    loading,
    signIn: async (u, p) => setUser(await api.login(u, p)),
    signOut: async () => { await api.logout(); setUser(null); },
    can: (p) => !!user?.permissions.includes(p),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
