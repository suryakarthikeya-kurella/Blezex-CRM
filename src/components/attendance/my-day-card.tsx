import { Coffee, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBlock, StatusPill } from "@/components/crm/ui-bits";
import {
  STATUS_LABEL,
  clock,
  hm,
  sessionsText,
  useAttendanceAction,
  useAttendanceReport,
  useAttendanceSettings,
} from "@/lib/attendance";

/** The signed-in mentor/employee's own day: the only place check-in / check-out / breaks are triggered.
 *  Timestamps are taken by the server; closing the browser or signing out never changes attendance. */
export function MyDayCard({ userId, today }: { userId: string; today: string }) {
  const { policy, tz } = useAttendanceSettings();
  const q = useAttendanceReport({ from: today, to: today, user: userId });
  const checkIn = useAttendanceAction("attendance_check_in", "Checked in");
  const checkOut = useAttendanceAction("attendance_check_out", "Checked out");
  const breakStart = useAttendanceAction("attendance_break_start", "Break started");
  const breakEnd = useAttendanceAction("attendance_break_end", "Break ended");
  const row = q.data?.[0];
  const nonWorking =
    !!row && (row.status === "weekly_off" || row.status === "holiday" || row.status === "on_leave");
  const busy = [checkIn, checkOut, breakStart, breakEnd].some((m) => m.isPending);

  return (
    <section className="surface mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <h2 className="font-display text-sm font-semibold">Your day</h2>
        {q.isError ? (
          <ErrorBlock error={q.error} />
        ) : !row ? (
          <p className="mt-1 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <StatusPill value={row.status} />
            <span>In: {clock(row.check_in_at, tz)}</span>
            <span>Out: {clock(row.check_out_at, tz)}</span>
            {row.check_in_at ? <span>Net so far: {hm(row.net_minutes)}</span> : null}
            {(row.sessions ?? []).length > 1 ? (
              <span>Sessions: {sessionsText(row.sessions, tz)}</span>
            ) : null}
            {row.on_break ? <span className="font-medium text-warning">On a break</span> : null}
            {!row.check_in_at ? (
              <span>
                Scheduled {policy.work_start}–{policy.work_end}
              </span>
            ) : null}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {row && !row.check_in_at ? (
          <Button
            variant={nonWorking ? "outline" : "default"}
            disabled={busy}
            onClick={() => checkIn.mutate()}
          >
            <LogIn className="size-4" /> Check in
            {nonWorking ? ` (${STATUS_LABEL[row.status].toLowerCase()})` : ""}
          </Button>
        ) : null}
        {row?.check_in_at && row.check_out_at ? (
          <Button variant="outline" disabled={busy} onClick={() => checkIn.mutate()}>
            <LogIn className="size-4" /> Check in again
          </Button>
        ) : null}
        {row?.check_in_at && !row.check_out_at && row.status !== "incomplete" ? (
          <>
            {policy.track_breaks ? (
              row.on_break ? (
                <Button variant="outline" disabled={busy} onClick={() => breakEnd.mutate()}>
                  <Coffee className="size-4" /> End break
                </Button>
              ) : (
                <Button variant="outline" disabled={busy} onClick={() => breakStart.mutate()}>
                  <Coffee className="size-4" /> Start break
                </Button>
              )
            ) : null}
            <Button disabled={busy || row.on_break} onClick={() => checkOut.mutate()}>
              <LogOut className="size-4" /> Check out
            </Button>
          </>
        ) : null}
      </div>
    </section>
  );
}
