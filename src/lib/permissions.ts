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
  | "services.view"
  | "services.manage"
  | "payroll.view"
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
  "services.view": ["admin", "mentor", "bds_employee"], // price list for client conversations
  "services.manage": ["admin"],
  "payroll.view": ["admin"],
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
  {
    to: "/calendar",
    label: "Calendar",
    icon: "calendar",
    roles: ["admin", "mentor", "bds_employee"],
  },
  { to: "/clients", label: "Clients", icon: "clients", roles: ["admin", "mentor", "bds_employee"] },
  {
    to: "/daily-reports",
    label: "Daily reports",
    icon: "report",
    roles: ["admin", "mentor", "bds_employee"],
  },
  { to: "/team", label: "Team", icon: "team", roles: ["admin", "mentor"] },
  { to: "/reports", label: "Reports", icon: "chart", roles: ["admin", "mentor", "bds_employee"] },
  { to: "/finance", label: "Finance", icon: "finance", roles: ["admin"] },
  {
    to: "/finance/services",
    label: "Services & pricing",
    icon: "finance",
    roles: ["mentor", "bds_employee"], // admins reach it from the Finance tabs
  },
  {
    to: "/approvals",
    label: "Approvals",
    icon: "approval",
    roles: ["admin", "mentor", "bds_employee"],
  },
  {
    to: "/audit-logs",
    label: "Attendance", // same route as the former Audit log; the audit history is a tab on this page
    icon: "attendance",
    roles: ["admin", "mentor", "bds_employee"],
  },
  { to: "/settings", label: "Settings", icon: "settings", roles: ["admin"] },
];

export function navFor(role: Role | undefined | null): NavItem[] {
  return NAV_ITEMS.filter((n) => !!role && n.roles.includes(role));
}

/** The eight approved Finance sections. Only Services & Pricing is open to mentors and employees. */
export const FINANCE_SECTIONS: readonly { to: string; label: string; roles: readonly Role[] }[] = [
  { to: "/finance", label: "Overview", roles: ["admin"] },
  {
    to: "/finance/services",
    label: "Services & pricing",
    roles: ["admin", "mentor", "bds_employee"],
  },
  { to: "/finance/accounts", label: "Client accounts", roles: ["admin"] },
  { to: "/finance/invoices", label: "Invoices & payments", roles: ["admin"] },
  { to: "/finance/sales", label: "Employee sales", roles: ["admin"] },
  { to: "/finance/payroll", label: "Salaries & payroll", roles: ["admin"] },
  { to: "/finance/expenses", label: "Company expenses", roles: ["admin"] },
  { to: "/finance/reports", label: "Financial reports", roles: ["admin"] },
];

export function financeSectionsFor(role: Role | undefined | null) {
  return FINANCE_SECTIONS.filter((s) => !!role && s.roles.includes(role));
}

export function routeAllowed(role: Role | undefined | null, path: string): boolean {
  // Finance sections are the source of truth for /finance/*; a sidebar entry must not shadow them.
  const rules: { to: string; roles: readonly Role[] }[] = [
    ...FINANCE_SECTIONS,
    ...NAV_ITEMS.filter((n) => !FINANCE_SECTIONS.some((s) => s.to === n.to)),
  ];
  const rule = rules
    .sort((a, b) => b.to.length - a.to.length)
    .find((n) => (n.to === "/" ? path === "/" : path === n.to || path.startsWith(`${n.to}/`)));
  return rule ? !!role && rule.roles.includes(role) : !!role;
}
