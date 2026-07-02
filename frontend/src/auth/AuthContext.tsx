import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getMe, setUnauthorizedHandler } from "../api/client";
import LoginPage from "../components/LoginPage";
import type { AuthUser } from "../types";

interface AuthValue {
  user: AuthUser;
  setUser: (user: AuthUser | null) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Like useAuth, but returns null outside the provider (bare component tests,
 *  or contexts where auth is optional). */
export function useOptionalAuth(): AuthValue | null {
  return useContext(AuthContext);
}

/** Gates the whole app: probes the session once, shows the login page when
 *  logged out, and flips back to it whenever any API call returns 401. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    getMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  if (!checked) return <div className="min-h-screen bg-gray-50" />;
  if (!user) return <LoginPage onLoggedIn={setUser} />;
  return <AuthContext.Provider value={{ user, setUser }}>{children}</AuthContext.Provider>;
}
