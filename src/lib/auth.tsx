import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./supabase";
import type { Role } from "./permissions";

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
};

type Status = "loading" | "signed_out" | "no_profile" | "ready" | "error" | "unconfigured";

type AuthValue = {
  status: Status;
  session: Session | null;
  profile: Profile | null;
  role: Role | undefined;
  isAdmin: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<string | null>;
  updatePassword: (password: string) => Promise<string | null>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(isSupabaseConfigured ? "loading" : "unconfigured");
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The role ALWAYS comes from the profiles table (RLS: an inactive/unknown user gets no row).
  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setStatus("signed_out");
      return;
    }
    const { data, error: err } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, is_active")
      .eq("id", s.user.id)
      .maybeSingle();
    if (err) {
      setError(err.message);
      setStatus("error");
    } else if (!data) {
      setProfile(null);
      setStatus("no_profile"); // inactive, deactivated or not yet provisioned
    } else {
      setError(null);
      setProfile(data as Profile);
      setStatus("ready");
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      void loadProfile(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // defer to avoid calling supabase inside the auth callback (SDK deadlock guidance)
      setTimeout(() => void loadProfile(s), 0);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return err ? "Invalid email or password." : null; // deliberately generic: no account enumeration
  }, []);
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);
  const requestPasswordReset = useCallback(async (email: string) => {
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return err && err.status !== 400 ? "Could not send the reset email. Try again shortly." : null;
  }, []);
  const updatePassword = useCallback(async (password: string) => {
    const { error: err } = await supabase.auth.updateUser({ password });
    return err ? err.message : null;
  }, []);
  const refreshProfile = useCallback(async () => loadProfile(session), [loadProfile, session]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      session,
      profile,
      role: profile?.role,
      isAdmin: profile?.role === "admin",
      error,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
      refreshProfile,
    }),
    [
      status,
      session,
      profile,
      error,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
      refreshProfile,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
