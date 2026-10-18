import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Bell,
  Briefcase,
  CheckSquare,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTable, num, today } from "@/lib/crm-hooks";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LoginScreen } from "@/components/login-screen";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, adminOnly: false },
  { to: "/leads", label: "Leads", icon: Users, adminOnly: false },
  { to: "/clients", label: "Clients", icon: Briefcase, adminOnly: false },
  { to: "/activities", label: "Activities", icon: Activity, adminOnly: false },
  { to: "/tasks", label: "Tasks", icon: CheckSquare, adminOnly: false },
  { to: "/reports", label: "Reports", icon: BarChart3, adminOnly: true },
  { to: "/settings", label: "Settings", icon: SettingsIcon, adminOnly: true },
] as const;

function NavLinks({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  return (
    <nav className="space-y-1">
      {NAV.filter((n) => !n.adminOnly || isAdmin).map((item) => (
        <Link
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          activeOptions={{ exact: item.to === "/" }}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          activeProps={{
            className: "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary",
          }}
        >
          <item.icon className="size-4" />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function useNotifications() {
  const { user, isAdmin } = useAuth();
  const leads = useTable("Leads");
  const tasks = useTable("Tasks");
  const clients = useTable("Clients");
  const day = today();

  const mine = (owner: string) => isAdmin || owner === user?.email;

  const items: Array<{ text: string; tone: string }> = [];
  (leads.data ?? [])
    .filter((l) => mine(l["Assigned To"]))
    .forEach((l) => {
      const next = l["Next Follow-up Date"];
      if (!next) return;
      if (next === day) items.push({ text: `Follow-up due today — ${l["Company Name"]}`, tone: "warning" });
      else if (next < day && !["Converted Client", "Lost"].includes(l["Status"]))
        items.push({ text: `Overdue follow-up — ${l["Company Name"]}`, tone: "danger" });
      if (l["Status"] === "Meeting Scheduled" && next >= day)
        items.push({ text: `Upcoming meeting — ${l["Company Name"]}`, tone: "info" });
    });

  (tasks.data ?? [])
    .filter((t) => mine(t["Assigned To"]) && t["Status"] !== "Completed")
    .forEach((t) => {
      const due = t["Due Date"];
      if (due && due < day) items.push({ text: `Overdue task — ${t["Task Title"]}`, tone: "danger" });
      else items.push({ text: `Pending task — ${t["Task Title"]}`, tone: "info" });
    });

  (clients.data ?? [])
    .filter((c) => c["Payment Status"] !== "Paid" && num(c["Balance Amount"]) > 0)
    .forEach((c) =>
      items.push({ text: `Pending payment — ${c["Company Name"]}`, tone: "warning" }),
    );

  return items.slice(0, 25);
}

function Header({ onOpenMobile }: { onOpenMobile: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const notifications = useNotifications();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card/85 px-4 backdrop-blur md:px-6">
      {onOpenMobile}
      <div className="ml-auto flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
              <Bell className="size-5" />
              {notifications.length > 0 ? (
                <span className="absolute top-1.5 right-1.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-destructive-foreground">
                  {notifications.length}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <p className="border-b border-border px-4 py-3 text-sm font-semibold">Notifications</p>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">All clear.</p>
              ) : (
                notifications.map((n, i) => (
                  <div key={i} className="flex gap-2 border-b border-border/60 px-4 py-2.5 text-sm">
                    <span
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        n.tone === "danger"
                          ? "bg-destructive"
                          : n.tone === "warning"
                            ? "bg-warning"
                            : "bg-primary",
                      )}
                    />
                    <span>{n.text}</span>
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <div className="hidden text-right sm:block">
          <p className="text-sm leading-tight font-medium">{user?.email}</p>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
              user?.role === "Admin"
                ? "border-primary/25 bg-primary/10 text-primary"
                : "border-border bg-muted text-muted-foreground",
            )}
          >
            {user?.role}
          </span>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            logout();
            navigate({ to: "/" });
          }}
        >
          <LogOut className="size-4" /> Logout
        </Button>
      </div>
    </header>
  );
}

export function AppShell({ children, adminOnly }: { children: ReactNode; adminOnly?: boolean }) {
  const { user, ready, isAdmin } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!ready) return <div className="min-h-screen bg-background" />;
  if (!user) return <LoginScreen />;

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar p-4 lg:flex">
        <div className="mb-6 flex items-center gap-2 px-1">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary font-display text-lg font-bold text-primary-foreground">
            B
          </span>
          <div>
            <p className="font-display text-sm font-semibold text-sidebar-foreground">BlezeX CRM</p>
            <p className="text-[11px] text-sidebar-foreground/60">Sales Operations</p>
          </div>
        </div>
        <NavLinks isAdmin={isAdmin} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onOpenMobile={
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 bg-sidebar p-4">
                <SheetTitle className="mb-6 font-display text-sidebar-foreground">
                  BlezeX CRM
                </SheetTitle>
                <NavLinks isAdmin={isAdmin} onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
          }
        />
        <main className="flex-1 p-4 md:p-6">
          {adminOnly && !isAdmin ? (
            <div className="surface mx-auto mt-20 max-w-md p-8 text-center">
              <h1 className="font-display text-xl font-semibold">Unauthorized Access</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                This section is available to administrators only.
              </p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
