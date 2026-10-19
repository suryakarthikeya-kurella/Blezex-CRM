import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Brand } from "@/components/login-screen";
import { useAuth } from "@/lib/auth";

/** Second sign-in step. Until the code is verified the database treats this session as nobody (aal1). */
export function MfaChallenge() {
  const { completeMfa, signOut } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form
        className="w-full max-w-sm space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          const err = await completeMfa(code);
          setBusy(false);
          if (err) setError(err);
        }}
      >
        <Brand className="mb-4" />
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold">
          <ShieldCheck className="size-6 text-primary" /> Two-step verification
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter the 6-digit code from your authenticator app.
        </p>
        <div>
          <Label htmlFor="mfa-code" className="mb-1.5 block text-xs">
            Code
          </Label>
          <Input
            id="mfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ""));
              setError("");
            }}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
          {busy ? "Verifying…" : "Verify"}
        </Button>
        <button
          type="button"
          onClick={() => void signOut()}
          className="text-sm text-muted-foreground hover:underline"
        >
          Cancel and sign out
        </button>
        <p className="text-xs text-muted-foreground">
          Lost your phone? Ask an administrator to reset your two-step verification.
        </p>
      </form>
    </div>
  );
}
