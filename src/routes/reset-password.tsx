import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Brand } from "@/components/login-screen";

export const Route = createFileRoute("/reset-password")({ component: ResetPassword });

/** Landing page for both password-recovery and invitation links (Supabase signs the user in via the link, then they set a password). */
function ResetPassword() {
  const { session, status, updatePassword } = useAuth();
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 4000);
    return () => clearTimeout(t);
  }, []);

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <Brand className="mb-6 justify-center" />
          {status === "loading" || !waited ? (
            <p className="text-sm text-muted-foreground" role="status">
              Verifying your link…
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">This link is invalid or has expired.</p>
              <Link
                to="/forgot-password"
                className="mt-3 inline-block text-sm text-primary hover:underline"
              >
                Request a new link
              </Link>
            </>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form
        className="w-full max-w-sm space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw.length < 10) return setError("Use at least 10 characters.");
          if (pw !== pw2) return setError("Passwords don't match.");
          setBusy(true);
          const err = await updatePassword(pw);
          setBusy(false);
          if (err) setError(err);
          else void nav({ to: "/" });
        }}
      >
        <Brand className="mb-4" />
        <h1 className="font-display text-2xl font-semibold">Set a new password</h1>
        <div>
          <Label htmlFor="pw" className="mb-1.5 block text-xs">
            New password
          </Label>
          <Input
            id="pw"
            type="password"
            autoComplete="new-password"
            required
            value={pw}
            onChange={(e) => {
              setPw(e.target.value);
              setError("");
            }}
          />
        </div>
        <div>
          <Label htmlFor="pw2" className="mb-1.5 block text-xs">
            Confirm password
          </Label>
          <Input
            id="pw2"
            type="password"
            autoComplete="new-password"
            required
            value={pw2}
            onChange={(e) => {
              setPw2(e.target.value);
              setError("");
            }}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Saving…" : "Save password"}
        </Button>
      </form>
    </div>
  );
}
