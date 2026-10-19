import { useMemo } from "react";
import { StatusPill } from "@/components/crm/ui-bits";
import {
  clock,
  hm,
  useAttendanceReport,
  useAttendanceSettings,
  useAttendanceToday,
  type AttRow,
} from "@/lib/attendance";

/** Today's attendance per person for the Team screens. Scope is whatever attendance_report() lets the viewer see. */
export function useTodayAttendance() {
  const today = useAttendanceToday().data ?? "";
  const q = useAttendanceReport({ from: today, to: today }, !!today);
  const byUser = useMemo(() => new Map((q.data ?? []).map((r) => [r.user_id, r])), [q.data]);
  return { byUser, loading: q.isLoading };
}

/** Status, every check-in/check-out of the day, and net hours. "—" for people without attendance (admins). */
export function TodayCell({ row }: { row: AttRow | undefined }) {
  const { tz } = useAttendanceSettings();
  if (!row) return <span className="text-muted-foreground">—</span>;
  const sessions = row.sessions ?? [];
  return (
    <div className="space-y-0.5 text-xs">
      <StatusPill value={row.status} />
      {sessions.map((s, i) => (
        <span key={i} className="block whitespace-nowrap text-muted-foreground">
          {clock(s.in, tz)} – {s.out ? clock(s.out, tz) : "now"}
        </span>
      ))}
      {row.net_minutes != null ? (
        <span className="block text-muted-foreground">Net {hm(row.net_minutes)}</span>
      ) : null}
    </div>
  );
}
