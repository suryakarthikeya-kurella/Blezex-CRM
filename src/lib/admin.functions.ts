import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabase } from "./supabase";

/**
 * Privileged user administration. The browser sends its Supabase access token; the server verifies it
 * with Supabase Auth and re-checks the profile row (active admin) before using the service-role key.
 */
const withAuth = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { data } = await supabase.auth.getSession();
    return next({ headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
  })
  .server(async ({ next }) => {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const { requireAdmin } = await import("./server/supabase-admin.server");
    const admin = await requireAdmin(getRequestHeader("authorization"));
    return next({ context: { admin } });
  });

const roleSchema = z.enum(["admin", "mentor", "bds_employee"]);

function siteUrl(origin: string | undefined) {
  return process.env["SITE_URL"] ?? origin ?? "";
}

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([withAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        email: z.string().trim().email().max(254),
        fullName: z.string().trim().min(1).max(120),
        role: roleSchema,
        teamId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const { service, caller } = context.admin;
    const redirectTo = `${siteUrl(getRequestHeader("origin"))}/reset-password`;
    const { data: invited, error } = await service.auth.admin.inviteUserByEmail(data.email, {
      data: { full_name: data.fullName },
      redirectTo,
    });
    if (error || !invited.user) throw new Error(error?.message ?? "Invitation failed");
    const id = invited.user.id;
    try {
      // Runs as the calling admin => authorised by the RPC and audited under their identity.
      const r1 = await caller.rpc("admin_update_profile", {
        p_user: id,
        p_role: data.role,
        p_is_active: true,
        p_full_name: data.fullName,
      });
      if (r1.error) throw new Error(r1.error.message);
      if (data.teamId) {
        const r2 = await caller.from("team_memberships").insert({
          team_id: data.teamId,
          user_id: id,
          membership_role: data.role === "mentor" ? "mentor" : "member",
        });
        if (r2.error) throw new Error(r2.error.message);
      }
    } catch (e) {
      await service.auth.admin.deleteUser(id); // never leave a half-provisioned account behind
      throw e;
    }
    return { id };
  });

export const setUserActive = createServerFn({ method: "POST" })
  .middleware([withAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), active: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { service, caller } = context.admin;
    const r = await caller.rpc("admin_update_profile", {
      p_user: data.userId,
      p_is_active: data.active,
    });
    if (r.error) throw new Error(r.error.message);
    // Defence in depth: RLS already blocks a deactivated user; the ban also stops token refresh/sign-in.
    const b = await service.auth.admin.updateUserById(data.userId, {
      ban_duration: data.active ? "none" : "876000h",
    });
    if (b.error) throw new Error(`Profile updated but auth ban failed: ${b.error.message}`);
    return { ok: true };
  });

export const changeUserRole = createServerFn({ method: "POST" })
  .middleware([withAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), role: roleSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const r = await context.admin.caller.rpc("admin_update_profile", {
      p_user: data.userId,
      p_role: data.role,
    });
    if (r.error) throw new Error(r.error.message);
    return { ok: true };
  });

export const sendPasswordReset = createServerFn({ method: "POST" })
  .middleware([withAuth])
  .inputValidator((d: unknown) => z.object({ email: z.string().trim().email() }).parse(d))
  .handler(async ({ data, context }) => {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const { error } = await context.admin.service.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${siteUrl(getRequestHeader("origin"))}/reset-password`,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
