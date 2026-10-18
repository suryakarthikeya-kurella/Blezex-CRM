import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && key);

/**
 * Browser/SSR-safe Supabase client using the PUBLISHABLE key only. Every request runs as the signed-in user,
 * so Postgres RLS is the authorisation boundary. The service-role key never reaches this module.
 * Session tokens use the SDK's default browser storage; no passwords are ever stored.
 */
const isBrowser = typeof window !== "undefined";
export const supabase = createClient(
  url ?? "http://localhost:54321",
  key ?? "missing-publishable-key",
  {
    auth: {
      persistSession: isBrowser,
      autoRefreshToken: isBrowser,
      detectSessionInUrl: isBrowser,
      flowType: "pkce",
    },
  },
);

const FRIENDLY: Record<string, string> = {
  "42501": "You don't have permission to do that.",
  "23505": "That record already exists (duplicate).",
  "23503": "A related record is missing or still in use.",
  "23514": "That change isn't allowed by the CRM rules.",
  "40001": "Someone else changed this record. Reload and try again.",
  P0002: "Record not found.",
  "28000": "Please sign in again.",
};

/** Convert a PostgREST/Postgres error into a user-facing Error without hiding the real message when it is a rule message. */
export function toError(e: { code?: string; message?: string } | null | undefined): Error {
  if (!e) return new Error("Unknown error");
  const ruleMessage =
    e.code === "23514" || e.code === "P0002" || e.code === "40001" || e.code === "42501";
  if (ruleMessage && e.message && !/row-level security|permission denied/i.test(e.message))
    return new Error(e.message);
  return new Error(FRIENDLY[e.code ?? ""] ?? e.message ?? "Request failed");
}

/** Throw on error — never silently turn a failed query into an empty/zero result. */
export function unwrap<T>(res: {
  data: T | null;
  error: { code?: string; message?: string } | null;
}): T {
  if (res.error) throw toError(res.error);
  return res.data as T;
}
