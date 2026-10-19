import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase, unwrap } from "@/lib/supabase";
import { useAttendanceSettings, type AttPolicy } from "@/lib/attendance";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const NUMS: { key: keyof AttPolicy; label: string }[] = [
  { key: "grace_minutes", label: "Late grace (min)" },
  { key: "early_departure_grace_minutes", label: "Early-departure grace (min)" },
  { key: "full_day_min_net_minutes", label: "Full day needs net minutes ≥" },
  { key: "half_day_min_net_minutes", label: "Half day needs net minutes ≥ (below = absent)" },
];
const TIMES: { key: keyof AttPolicy; label: string }[] = [
  { key: "work_start", label: "Work start" },
  { key: "work_end", label: "Work end" },
  { key: "lunch_start", label: "Lunch start" },
  { key: "lunch_end", label: "Lunch end" },
];

/** Admin-only editor for the 'attendance.policy' setting. The database validates it again (trigger) and RLS limits writes to admins. */
export function PolicyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { policy, tz } = useAttendanceSettings();
  const qc = useQueryClient();
  const [p, setP] = useState<AttPolicy>(policy);
  const [holidays, setHolidays] = useState("");
  useEffect(() => {
    if (open) {
      setP(policy);
      setHolidays(policy.holidays.join("\n"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  const save = useMutation({
    mutationFn: async () => {
      const value: AttPolicy = {
        ...p,
        holidays: holidays
          .split(/[\s,]+/)
          .map((h) => h.trim())
          .filter(Boolean),
      };
      unwrap(await supabase.from("app_settings").update({ value }).eq("key", "attendance.policy"));
    },
    onSuccess: () => {
      toast.success("Attendance policy saved");
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["config"] });
      void qc.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (e: Error) => toast.error(e.message.replace(/^invalid attendance policy: /, "")),
  });

  const set = <K extends keyof AttPolicy>(k: K, v: AttPolicy[K]) => setP((o) => ({ ...o, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Attendance policy</DialogTitle>
          <DialogDescription>
            Times are in {tz}. Changes apply to every report immediately, including past days.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {TIMES.map((f) => (
            <div key={f.key}>
              <Label htmlFor={`pol-${f.key}`} className="mb-1.5 block text-xs">
                {f.label}
              </Label>
              <Input
                id={`pol-${f.key}`}
                type="time"
                required
                value={String(p[f.key])}
                onChange={(e) => set(f.key, e.target.value as never)}
              />
            </div>
          ))}
          {NUMS.map((f) => (
            <div key={f.key}>
              <Label htmlFor={`pol-${f.key}`} className="mb-1.5 block text-xs">
                {f.label}
              </Label>
              <Input
                id={`pol-${f.key}`}
                type="number"
                min={0}
                max={1440}
                required
                value={Number(p[f.key])}
                onChange={(e) => set(f.key, Number(e.target.value) as never)}
              />
            </div>
          ))}
          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-xs font-medium">Weekly offs</legend>
            <div className="flex flex-wrap gap-4">
              {DAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={p.weekly_offs.includes(i)}
                    onCheckedChange={(c) =>
                      set(
                        "weekly_offs",
                        c ? [...p.weekly_offs, i].sort() : p.weekly_offs.filter((x) => x !== i),
                      )
                    }
                  />
                  {d}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="sm:col-span-2">
            <Label htmlFor="pol-holidays" className="mb-1.5 block text-xs">
              Holidays (one date per line, YYYY-MM-DD)
            </Label>
            <Textarea
              id="pol-holidays"
              rows={3}
              value={holidays}
              onChange={(e) => setHolidays(e.target.value)}
              placeholder="2026-01-26"
            />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span>
              Track actual breaks
              <span className="block text-xs text-muted-foreground">
                Off: the scheduled lunch is deducted. On: only recorded breaks are.
              </span>
            </span>
            <Switch checked={p.track_breaks} onCheckedChange={(c) => set("track_breaks", c)} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span>
              Count overtime
              <span className="block text-xs text-muted-foreground">
                Minutes worked after the work end time.
              </span>
            </span>
            <Switch
              checked={p.overtime_enabled}
              onCheckedChange={(c) => set("overtime_enabled", c)}
            />
          </label>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save policy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
