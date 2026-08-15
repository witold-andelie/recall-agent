"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { SessionUser } from "@/lib/types";

type AuthContextValue = {
  user: SessionUser | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<SessionUser | null>;
  register: (opts: {
    email: string;
    password: string;
    displayName?: string;
  }) => Promise<SessionUser>;
  login: (opts: { email: string; password: string }) => Promise<SessionUser>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function readSession(res: Response): Promise<SessionUser> {
  const data = (await res.json()) as SessionUser & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return {
    userId: data.userId,
    isNew: Boolean(data.isNew),
    email: data.email ?? null,
    displayName: data.displayName ?? null,
    isAnonymous: Boolean(data.isAnonymous),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/auth", { method: "POST" });
    const session = await readSession(res);
    setUser(session);
    setError(null);
    return session;
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth", { method: "POST" })
      .then((res) => readSession(res))
      .then((session) => {
        if (cancelled) return;
        setUser(session);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "auth failed");
        setUser(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const register = useCallback(
    async (opts: { email: string; password: string; displayName?: string }) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });
      const session = await readSession(res);
      setUser(session);
      setError(null);
      return session;
    },
    [],
  );

  const login = useCallback(async (opts: { email: string; password: string }) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    const session = await readSession(res);
    setUser(session);
    setError(null);
    return session;
  }, []);

  const logout = useCallback(async () => {
    const res = await fetch("/api/auth/logout", { method: "POST" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    setUser(null);
    await refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ user, loading, error, refresh, register, login, logout }),
    [user, loading, error, refresh, register, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
