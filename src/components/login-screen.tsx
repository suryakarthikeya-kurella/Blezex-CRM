import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, ShieldCheck } from "lucide-react";

export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary font-display text-lg font-bold text-primary-foreground">
            B
          </span>
          <span className="font-display text-lg font-semibold">BlezeX</span>
        </div>
        <div>
          <h1 className="font-display text-4xl leading-tight font-semibold">
            Sales operations,
            <br />
            one shared workspace.
          </h1>
          <p className="mt-4 max-w-md text-sm text-sidebar-foreground/70">
            Leads, clients, activities, tasks and payments — tracked end to end for the BlezeX team.
          </p>
        </div>
        <p className="flex items-center gap-2 text-xs text-sidebar-foreground/60">
          <ShieldCheck className="size-4" /> Internal use only. Access restricted to BlezeX staff.
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary font-display text-lg font-bold text-primary-foreground">
              B
            </span>
            <span className="font-display text-lg font-semibold">BlezeX CRM</span>
          </div>
          <h2 className="font-display text-2xl font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use your BlezeX account to continue.
          </p>

          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const ok = login(email, password);
              if (!ok) setError("Unauthorized Access");
            }}
          >
            <div>
              <Label htmlFor="email" className="mb-1.5 block text-xs">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
                placeholder="name@blezex.com"
              />
            </div>
            <div>
              <Label htmlFor="password" className="mb-1.5 block text-xs">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
              />
            </div>

            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full">
              <Lock className="size-4" /> Sign in
            </Button>
          </form>

          <p className="mt-6 text-xs text-muted-foreground">
            No signup or password recovery. Contact an administrator for access.
          </p>
        </div>
      </div>
    </div>
  );
}
