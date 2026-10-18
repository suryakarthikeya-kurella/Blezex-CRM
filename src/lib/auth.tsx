import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Role = "Admin" | "Team Member";

export type User = { email: string; role: Role; name: string };

const USERS: Array<User & { password: string }> = [
  { email: "surya.blezex@gmail.com", name: "Surya", role: "Admin", password: "Blezex@admin" },
  { email: "durga.blezex@gmail.com", name: "Durga", role: "Admin", password: "Blezex@admin" },
  {
    email: "hemalatha.blezex@gmail.com",
    name: "Hemalatha",
    role: "Team Member",
    password: "Blezex@operations",
  },
  {
    email: "team.blezex@gmail.com",
    name: "Team",
    role: "Team Member",
    password: "Blezex@operations",
  },
];

export const ALL_USERS: User[] = USERS.map(({ password: _password, ...u }) => u);

const STORAGE_KEY = "blezex.crm.session";

type AuthValue = {
  user: User | null;
  ready: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => boolean;
  logout: () => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as User;
        const match = ALL_USERS.find((u) => u.email === parsed.email);
        if (match) setUser(match);
      }
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const login = useCallback((email: string, password: string) => {
    const match = USERS.find(
      (u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password,
    );
    if (!match) return false;
    const { password: _password, ...safe } = match;
    setUser(safe);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    return true;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo(
    () => ({ user, ready, isAdmin: user?.role === "Admin", login, logout }),
    [user, ready, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
