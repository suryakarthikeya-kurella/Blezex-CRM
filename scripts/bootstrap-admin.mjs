#!/usr/bin/env node
/**
 * One-time creation of the FIRST admin (public signup is disabled, so someone must seed it).
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... BOOTSTRAP_ADMIN_EMAIL=you@co.com BOOTSTRAP_ADMIN_NAME="You" \
 *   BOOTSTRAP_ADMIN_PASSWORD='(>=12 chars)' node scripts/bootstrap-admin.mjs
 * Refuses to run if an active admin already exists. Change the password after first sign-in.
 */
import { createClient } from "@supabase/supabase-js";
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  BOOTSTRAP_ADMIN_EMAIL: email,
  BOOTSTRAP_ADMIN_NAME: name,
  BOOTSTRAP_ADMIN_PASSWORD: pw,
} = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !email || !name || !pw || pw.length < 12) {
  console.error("Missing env (see header) or password shorter than 12 chars.");
  process.exit(2);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { count } = await sb
  .from("profiles")
  .select("id", { count: "exact", head: true })
  .eq("role", "admin")
  .eq("is_active", true);
if (count) {
  console.error("An active admin already exists; use the Team page to invite more users.");
  process.exit(1);
}
const { data, error } = await sb.auth.admin.createUser({
  email,
  password: pw,
  email_confirm: true,
  user_metadata: { full_name: name },
});
if (error) {
  console.error("createUser failed:", error.message);
  process.exit(1);
}
const up = await sb
  .from("profiles")
  .update({ role: "admin", is_active: true, full_name: name })
  .eq("id", data.user.id);
if (up.error) {
  await sb.auth.admin.deleteUser(data.user.id);
  console.error("profile update failed, rolled back:", up.error.message);
  process.exit(1);
}
console.log(`First admin created: ${email}`);
