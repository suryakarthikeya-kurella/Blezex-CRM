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

type Status =
  "loading" | "signed_out" | "mfa_required" | "no_profile" | "ready" | "error" | "unconfigured";

/** Sign out after this long without any interaction. */
const IDLE_MINUTES = 30;

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
  /** Second step of sign-in for users with an authenticator app. */
  completeMfa: (code: string) => Promise<string | null>;
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
    // Password-only (aal1) session for a user who has an authenticator: the database treats it as nobody,
    // so ask for the code before touching any data.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      setProfile(null);
      setStatus("mfa_required");
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

  // Idle timeout: any interaction restarts the clock; at expiry the session is closed.
  useEffect(() => {
    if (status !== "ready") return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void supabase.auth.signOut();
      }, IDLE_MINUTES * 60_000);
    };
    const events = ["mousedown", "keydown", "touchstart", "scroll"] as const;
    let last = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - last > 5_000) {
        last = now;
        arm();
      }
    };
    arm();
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, onActivity);
    };
  }, [status]);

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
    const { error: err } = await supabase.auth.updateUser({
      password,
      data: { temp_password: false },
    });
    return err ? err.message : null;
  }, []);
  const completeMfa = useCallback(
    async (code: string) => {
      const { data: f } = await supabase.auth.mfa.listFactors();
      const factor = f?.totp.find((x) => x.status === "verified");
      if (!factor) return "No authenticator is set up for this account.";
      const { error: err } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: code.trim(),
      });
      if (err) return "That code didn't work. Try the newest one.";
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      await loadProfile(data.session);
      return null;
    },
    [loadProfile],
  );
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
      completeMfa,
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
      completeMfa,
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
