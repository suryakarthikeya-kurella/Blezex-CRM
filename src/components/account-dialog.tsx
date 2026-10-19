import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { passwordIssue } from "@/lib/password";
import { supabase } from "@/lib/supabase";

type Enrol = { factorId: string; qr: string; secret: string };

/** Self-service account security: change password and manage the authenticator app (2FA). */
export function AccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { updatePassword, profile } = useAuth();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null); // verified factor, if any
  const [enrol, setEnrol] = useState<Enrol | null>(null);
  const [code, setCode] = useState("");
  const [mfaErr, setMfaErr] = useState("");

  const loadFactors = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactorId(data?.totp.find((f) => f.status === "verified")?.id ?? null);
  }, []);
  useEffect(() => {
    if (open) {
      setPw("");
      setPw2("");
      setPwErr("");
      setEnrol(null);
      setCode("");
      setMfaErr("");
      void loadFactors();
    }
  }, [open, loadFactors]);

  const changePassword = async () => {
    const issue = passwordIssue(pw);
    if (issue) return setPwErr(issue);
    if (pw !== pw2) return setPwErr("Passwords don't match.");
    setBusy(true);
    const err = await updatePassword(pw);
    setBusy(false);
    if (err) return setPwErr(err);
    toast.success("Password changed");
    setPw("");
    setPw2("");
  };

  const startEnrol = async () => {
    setMfaErr("");
    // drop any half-finished enrolment so the list stays clean
    const { data: f } = await supabase.auth.mfa.listFactors();
    for (const x of f?.all ?? [])
      if (x.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: x.id });
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `BlezeX ${profile?.email ?? ""}`.trim(),
    });
    if (error || !data) return setMfaErr(error?.message ?? "Could not start enrolment.");
    setEnrol({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };
  const confirmEnrol = async () => {
    if (!enrol) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrol.factorId,
      code: code.trim(),
    });
    setBusy(false);
    if (error) return setMfaErr("That code didn't work. Try the newest one.");
    toast.success("Two-step verification is on");
    setEnrol(null);
    setCode("");
    void loadFactors();
  };
  const disable = async () => {
    if (!factorId) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) return setMfaErr(error.message);
    toast.success("Two-step verification is off");
    void loadFactors();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>My account</DialogTitle>
          <DialogDescription>{profile?.email}</DialogDescription>
        </DialogHeader>

        <section className="space-y-3">
          <h3 className="font-display text-sm font-semibold">Change password</h3>
          <div>
            <Label htmlFor="acc-pw" className="mb-1.5 block text-xs">
              New password
            </Label>
            <Input
              id="acc-pw"
              type="password"
              autoComplete="new-password"
              value={pw}
              onChange={(e) => {
                setPw(e.target.value);
                setPwErr("");
              }}
            />
          </div>
          <div>
            <Label htmlFor="acc-pw2" className="mb-1.5 block text-xs">
              Confirm password
            </Label>
            <Input
              id="acc-pw2"
              type="password"
              autoComplete="new-password"
              value={pw2}
              onChange={(e) => {
                setPw2(e.target.value);
                setPwErr("");
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            At least 10 characters, mixing three of: lowercase, uppercase, digits, symbols.
          </p>
          {pwErr ? (
            <p role="alert" className="text-sm text-destructive">
              {pwErr}
            </p>
          ) : null}
          <Button disabled={busy || !pw} onClick={() => void changePassword()}>
            Save password
          </Button>
        </section>

        <section className="space-y-3 border-t pt-4">
          <h3 className="font-display text-sm font-semibold">Two-step verification</h3>
          {factorId ? (
            <>
              <p className="text-sm text-muted-foreground">
                On. You enter a code from your authenticator app each time you sign in.
              </p>
              <Button variant="outline" onClick={() => void disable()}>
                Turn off
              </Button>
            </>
          ) : enrol ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Scan this QR code with Google Authenticator, Microsoft Authenticator or similar,
                then enter the 6-digit code.
              </p>
              <img
                src={enrol.qr}
                alt="QR code for your authenticator app"
                className="size-40 rounded border bg-white p-2"
              />
              <p className="text-xs break-all text-muted-foreground">
                Can&apos;t scan? Enter this key: <span className="font-mono">{enrol.secret}</span>
              </p>
              <Input
                aria-label="6-digit code"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, ""));
                  setMfaErr("");
                }}
              />
              <div className="flex gap-2">
                <Button disabled={busy || code.length !== 6} onClick={() => void confirmEnrol()}>
                  Turn on
                </Button>
                <Button variant="ghost" onClick={() => setEnrol(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Add a second step so a stolen password alone can&apos;t open your account.
              </p>
              <Button variant="outline" onClick={() => void startEnrol()}>
                Set up
              </Button>
            </>
          )}
          {mfaErr ? (
            <p role="alert" className="text-sm text-destructive">
              {mfaErr}
            </p>
          ) : null}
        </section>
      </DialogContent>
    </Dialog>
  );
}
