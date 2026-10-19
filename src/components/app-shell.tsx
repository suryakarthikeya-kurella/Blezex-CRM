import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  Bell,
  Briefcase,
  CheckSquare,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  Users,
  UsersRound,
  Inbox,
  Clock,
  CalendarDays,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useMarkRead, useNotifications } from "@/lib/api";
import { navFor, routeAllowed, ROLE_LABEL } from "@/lib/permissions";
import { dateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LoginScreen, Brand } from "@/components/login-screen";
import { MfaChallenge } from "@/components/mfa-challenge";
import { AccountDialog } from "@/components/account-dialog";
import { GlobalSearch } from "@/components/global-search";
import { cn } from "@/lib/utils";

const ICONS: Record<string, typeof Users> = {
  dashboard: LayoutDashboard,
  leads: Users,
  activity: Activity,
  tasks: CheckSquare,
  clients: Briefcase,
  report: ClipboardList,
  team: UsersRound,
  chart: BarChart3,
  finance: Receipt,
  approval: Inbox,
  audit: FileText,
  attendance: Clock,
  calendar: CalendarDays,
  settings: SettingsIcon,
};

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { role } = useAuth();
  return (
    <nav className="space-y-1" aria-label="Main">
      {navFor(role).map((item) => {
        const Icon = ICONS[item.icon] ?? Users;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            activeOptions={{ exact: item.to === "/" }}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            activeProps={{
              className:
                "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary",
            }}
          >
            <Icon className="size-4" /> {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function NotificationBell() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { data = [], isError } = useNotifications();
  const markRead = useMarkRead();
  const unread = data.filter((n) => !n.read_at);

  // One narrow realtime channel (own notifications only) instead of polling the whole CRM.
  useEffect(() => {
    if (!profile) return;
    const ch = supabase
      .channel(`notifications:${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${profile.id}`,
        },
        () => qc.invalidateQueries({ queryKey: ["notifications"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [profile, qc]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Notifications (${unread.length} unread)`}
        >
          <Bell className="size-5" />
          {unread.length > 0 ? (
            <span className="absolute top-1.5 right-1.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-destructive-foreground">
              {unread.length}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {unread.length ? (
            <button
              className="text-xs text-primary hover:underline"
              onClick={() => markRead.mutate(undefined)}
            >
              Mark all read
            </button>
          ) : null}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {isError ? (
            <p className="px-4 py-6 text-center text-sm text-destructive">
              Couldn&apos;t load notifications.
            </p>
          ) : data.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">All clear.</p>
          ) : (
            data.slice(0, 12).map((n) => (
              <button
                key={n.id}
                onClick={() => !n.read_at && markRead.mutate([n.id])}
                className="flex w-full gap-2 border-b border-border/60 px-4 py-2.5 text-left text-sm hover:bg-muted/50"
              >
                <span
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    n.read_at ? "bg-transparent" : "bg-primary",
                  )}
                />
                <span>
                  <span className="font-medium">{n.title}</span>
                  {n.message ? (
                    <span className="block text-xs text-muted-foreground">{n.message}</span>
                  ) : null}
                  <span className="block text-[11px] text-muted-foreground">
                    {dateTime(n.created_at)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
        <Link
          to="/notifications"
          className="block border-t border-border px-4 py-2 text-center text-xs text-primary hover:underline"
        >
          View all
        </Link>
      </PopoverContent>
    </Popover>
  );
}

export function AccessDenied({ message }: { message?: string }) {
  return (
    <div className="surface mx-auto mt-20 max-w-md p-8 text-center" role="alert">
      <ShieldAlert className="mx-auto mb-3 size-8 text-destructive" />
      <h1 className="font-display text-xl font-semibold">Access denied</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {message ?? "You don't have permission to view this page."}
      </p>
      <Link to="/" className="mt-4 inline-block text-sm text-primary hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}

function FullScreenMessage({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <ShieldCheck className="mx-auto mb-3 size-8 text-muted-foreground" />
        <h1 className="font-display text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        <div className="mt-4">{action}</div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { status, session, profile, role, error, signOut, refreshProfile } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });

  if (status === "unconfigured")
    return (
      <FullScreenMessage
        title="Supabase isn't configured"
        body="Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example) and restart."
      />
    );
  if (status === "loading") return <div className="min-h-screen bg-background" aria-busy="true" />;
  if (status === "signed_out") return <LoginScreen />;
  if (status === "mfa_required") return <MfaChallenge />;
  if (status === "no_profile")
    return (
      <FullScreenMessage
        title="Account not active"
        body="Your account is deactivated or hasn't been set up yet. Contact an administrator."
        action={
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        }
      />
    );
  if (status === "error")
    return (
      <FullScreenMessage
        title="Couldn't load your profile"
        body={error ?? "Network or server error."}
        action={<Button onClick={() => void refreshProfile()}>Retry</Button>}
      />
    );

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar p-4 lg:flex">
        <div className="mb-6 px-1 text-sidebar-foreground">
          <Brand />
        </div>
        <NavLinks />
        <p className="mt-auto px-3 text-[11px] text-sidebar-foreground/50">
          {role ? ROLE_LABEL[role] : ""} workspace
        </p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card/85 px-4 backdrop-blur md:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-sidebar p-4">
              <SheetTitle className="mb-6 font-display text-sidebar-foreground">
                Bleze<span className="text-primary">X</span> Connect
              </SheetTitle>
              <NavLinks onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="ml-auto flex items-center gap-2">
            <GlobalSearch />
            <NotificationBell />
            <div className="hidden text-right sm:block">
              <p className="text-sm leading-tight font-medium">
                {profile?.full_name || profile?.email}
              </p>
              <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {role ? ROLE_LABEL[role] : ""}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={() => setAccountOpen(true)}>
              Account
            </Button>
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              <LogOut className="size-4" /> Logout
            </Button>
          </div>
        </header>
        {session?.user.user_metadata?.["temp_password"] === true ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warning/30 bg-warning/15 px-4 py-2 text-sm md:px-6">
            <span>You&apos;re using a temporary password. Please choose your own.</span>
            <Button size="sm" variant="outline" onClick={() => setAccountOpen(true)}>
              Change password
            </Button>
          </div>
        ) : null}
        <main className="flex-1 p-4 md:p-6">
          {routeAllowed(role, path) ? children : <AccessDenied />}
        </main>
      </div>
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
    </div>
  );
}

export function isConfigured() {
  return isSupabaseConfigured;
}
