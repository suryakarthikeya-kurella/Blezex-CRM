import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** SERVER ONLY. Holds the service-role key; never import from client code (the *.server.ts suffix is enforced by the build). */
function env(name: string, ...fallbacks: string[]): string {
  for (const n of [name, ...fallbacks]) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`Server configuration error: ${name} is not set.`);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } } as const;

export function serviceClient(): SupabaseClient {
  return createClient(
    env("SUPABASE_URL", "VITE_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    opts,
  );
}

/** A client that acts AS the caller (their JWT), so RPC authorisation and audit actor are the caller's. */
export function callerClient(token: string): SupabaseClient {
  return createClient(
    env("SUPABASE_URL", "VITE_SUPABASE_URL"),
    env("SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"),
    { ...opts, global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** Verify the bearer token with Supabase Auth (not just decode it), then confirm an ACTIVE ADMIN profile. */
export async function requireAdmin(authorization: string | undefined) {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw new HttpError(401, "Not authenticated");
  const svc = serviceClient();
  const { data: u, error } = await svc.auth.getUser(token);
  if (error || !u.user) throw new HttpError(401, "Invalid or expired session");
  const { data: p } = await svc
    .from("profiles")
    .select("role,is_active")
    .eq("id", u.user.id)
    .maybeSingle();
  if (!p || !p.is_active || p.role !== "admin")
    throw new HttpError(403, "Administrator access required");
  return { userId: u.user.id, token, service: svc, caller: callerClient(token) };
}
