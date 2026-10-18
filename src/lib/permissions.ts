/**
 * Central, UI-facing permission map. It drives navigation and which controls are SHOWN.
 * It is NOT a security control: enforcement is Postgres RLS + column grants + RPC checks
 * (see docs/permissions-matrix.md). Keep this file in sync with that document.
 */
export type Role = "admin" | "mentor" | "bds_employee";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  mentor: "Mentor",
  bds_employee: "BDS Employee",
};

export type Capability =
  | "dashboard.company"
  | "users.manage"
  | "leads.assign"
  | "leads.archive"
  | "leads.viewAll"
  | "targets.manage"
  | "settings.manage"
  | "finance.manage"
  | "audit.view"
  | "team.view"
  | "approvals.decide"
  | "coaching.write"
  | "clients.manage";

const MATRIX: Record<Capability, readonly Role[]> = {
  "dashboard.company": ["admin"],
  "users.manage": ["admin"],
  "leads.assign": ["admin", "mentor"], // mentors: own team only, and only if app_settings allows it
  "leads.archive": ["admin", "mentor"],
  "leads.viewAll": ["admin"],
  "targets.manage": ["admin"],
  "settings.manage": ["admin"],
  "finance.manage": ["admin"],
  "audit.view": ["admin", "mentor", "bds_employee"], // scope narrows by role in RLS
  "team.view": ["admin", "mentor"],
  "approvals.decide": ["admin", "mentor"],
  "coaching.write": ["admin", "mentor"],
  "clients.manage": ["admin"],
};

export function can(role: Role | undefined | null, cap: Capability): boolean {
  return !!role && MATRIX[cap].includes(role);
}

export type NavItem = { to: string; label: string; icon: string; roles: readonly Role[] };

export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Dashboard", icon: "dashboard", roles: ["admin", "mentor", "bds_employee"] },
  { to: "/leads", label: "Leads", icon: "leads", roles: ["admin", "mentor", "bds_employee"] },
  {
    to: "/activities",
    label: "Activities",
    icon: "activity",
    roles: ["admin", "mentor", "bds_employee"],
  },
  { to: "/tasks", label: "Tasks", icon: "tasks", roles: ["admin", "mentor", "bds_employee"] },
  { to: "/clients", label: "Clients", icon: "clients", roles: ["admin", "mentor", "bds_employee"] },
  {
    to: "/daily-reports",
    label: "Daily reports",
    icon: "report",
    roles: ["admin", "mentor", "bds_employee"],
  },
  { to: "/team", label: "Team", icon: "team", roles: ["admin", "mentor"] },
  { to: "/reports", label: "Reports", icon: "chart", roles: ["admin", "mentor", "bds_employee"] },
  { to: "/finance", label: "Invoices & payments", icon: "finance", roles: ["admin"] },
  {
    to: "/approvals",
    label: "Approvals",
    icon: "approval",
    roles: ["admin", "mentor", "bds_employee"],
  },
  {
    to: "/audit-logs",
    label: "Audit log",
    icon: "audit",
    roles: ["admin", "mentor", "bds_employee"],
  },
  { to: "/settings", label: "Settings", icon: "settings", roles: ["admin"] },
];

export function navFor(role: Role | undefined | null): NavItem[] {
  return NAV_ITEMS.filter((n) => !!role && n.roles.includes(role));
}

export function routeAllowed(role: Role | undefined | null, path: string): boolean {
  const item = [...NAV_ITEMS]
    .sort((a, b) => b.to.length - a.to.length)
    .find((n) => (n.to === "/" ? path === "/" : path.startsWith(n.to)));
  return item ? !!role && item.roles.includes(role) : !!role;
}
