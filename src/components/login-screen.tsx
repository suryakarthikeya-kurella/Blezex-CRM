import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BarChart3,
  ClipboardCheck,
  Eye,
  EyeOff,
  Lock,
  LogIn,
  Mail,
  ShieldCheck,
  Users,
} from "lucide-react";

export function Brand({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img src="/logo-mark.png" alt="" width={36} height={36} className="size-9 object-contain" />
      <span className="font-display text-lg font-semibold">
        Bleze<span className="text-primary">X</span> Connect
      </span>
    </div>
  );
}

const TAGLINE = "One team. More possibilities.";

const FEATURES = [
  { icon: Users, title: "Manage Leads", text: "Track and convert opportunities efficiently" },
  { icon: ClipboardCheck, title: "Collaborate as a Team", text: "Stay aligned and productive" },
  { icon: BarChart3, title: "Track Performance", text: "Get real-time insights and reports" },
  {
    icon: ShieldCheck,
    title: "Secure & Role-Based Access",
    text: "Built for Admins, Mentors and Employees",
  },
];

function BrandLockup({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-center gap-3">
        <img
          src="/logo-mark.png"
          alt=""
          width={48}
          height={48}
          className="size-12 object-contain"
        />
        <span className="font-display text-2xl font-semibold">
          Bleze<span className="text-primary">X</span> Connect
        </span>
      </div>
      <p className="mt-1 pl-[60px] text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
        {TAGLINE}
      </p>
    </div>
  );
}

export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.15fr_1fr]">
      {/* Brand panel (large screens) */}
      <div className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_85%_85%,rgb(255_77_28/0.28),transparent),radial-gradient(40%_35%_at_10%_0%,rgb(255_138_26/0.12),transparent)]"
        />
        <div className="relative flex min-h-full flex-1 flex-col">
          <div>
            <div className="flex items-center gap-3">
              <img
                src="/logo-mark.png"
                alt=""
                width={48}
                height={48}
                className="size-12 object-contain"
              />
              <span className="font-display text-2xl font-semibold">
                Bleze<span className="text-primary">X</span> Connect
              </span>
            </div>
            <p className="mt-1 pl-[60px] text-[10px] tracking-[0.3em] text-sidebar-foreground/50 uppercase">
              {TAGLINE}
            </p>
          </div>
          <div className="mt-16 h-0.5 w-14 bg-primary" />
          <h1 className="mt-8 font-display text-5xl leading-[1.1] font-semibold">
            Sales operations,
            <br />
            <span className="text-primary">one shared workspace.</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg text-sidebar-foreground/70">
            Leads, follow-ups, clients, tasks and team performance — for Admins, Mentors and BDS
            employees.
          </p>
          <ul className="mt-10 max-w-md space-y-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li
                key={title}
                className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-3.5"
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Icon className="size-6" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-sidebar-accent-foreground">
                    {title}
                  </span>
                  <span className="block text-xs text-sidebar-foreground/60">{text}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-12">
            <div className="mb-4 h-0.5 w-10 bg-primary" />
            <p className="text-[11px] font-semibold tracking-[0.3em] text-sidebar-foreground/60 uppercase">
              Built for <span className="text-primary">a higher tomorrow</span>
            </p>
          </div>
        </div>
      </div>

      {/* Sign-in panel */}
      <div className="relative flex items-center justify-center overflow-hidden bg-background p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(255_138_26/0.55),rgb(255_77_28/0.25)_60%,transparent_72%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-24 size-80 rounded-full bg-[radial-gradient(circle_at_70%_30%,rgb(255_77_28/0.4),rgb(255_138_26/0.15)_60%,transparent_72%)]"
        />
        <div className="relative w-full max-w-[460px] rounded-3xl border border-border bg-card p-8 shadow-float sm:p-10">
          <BrandLockup className="flex flex-col items-center [&>p]:pl-0" />
          <h2 className="mt-8 text-center font-display text-3xl font-semibold">Welcome back</h2>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Sign in to your BlezeX Connect account to continue to your workspace.
          </p>
          <form
            className="mt-8 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              const err = await signIn(email, password);
              setBusy(false);
              if (err) setError(err);
            }}
          >
            <div>
              <Label htmlFor="email" className="mb-1.5 block text-xs">
                Email
              </Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  className="h-11 bg-muted pl-10"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError("");
                  }}
                  placeholder="name@blezex.com"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="password" className="mb-1.5 block text-xs">
                Password
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  className="h-11 bg-muted px-10"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p className="mt-2 text-right text-sm">
                <Link
                  to="/forgot-password"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Forgot your password?
                </Link>
              </p>
            </div>
            {error ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
              >
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              size="lg"
              className="h-12 w-full bg-gradient-to-r from-[#ff8a1a] to-primary text-base shadow-md hover:brightness-105"
              disabled={busy}
            >
              <LogIn className="size-5" /> {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <p className="mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4" /> Internal use only. Access is invitation-only.
          </p>
        </div>
      </div>
    </div>
  );
}
