import { Link } from "@tanstack/react-router";
import { KpiCard, SectionCard } from "@/components/crm/ui-bits";
import { MyDayCard } from "@/components/attendance/my-day-card";
import { useAttendanceToday } from "@/lib/attendance";
import type { DashboardHome } from "@/lib/api";

/** Attendance at a glance. Mentors/employees get their own check-in controls; the team/company view adds counts.
 *  Admins have no attendance of their own, so in their personal view there is nothing to show. */
export function TodayStrip({
  me,
  role,
  team,
  data,
}: {
  me: string;
  role: string | undefined;
  /** true = team/company counts view */
  team: boolean;
  data: DashboardHome;
}) {
  const today = useAttendanceToday().data;
  const a = team ? data.attendance : null;
  return (
    <div className="space-y-3">
      {role !== "admin" && today ? <MyDayCard userId={me} today={today} /> : null}
      {a ? (
        <SectionCard
          title={role === "admin" ? "Company attendance today" : "Team attendance today"}
          action={
            <Link to="/audit-logs" className="text-xs text-primary hover:underline">
              Open attendance
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiCard label="Present" value={`${a.present} / ${a.people}`} tone="success" />
            <KpiCard label="Late" value={a.late} tone="warning" />
            <KpiCard label="Absent" value={a.absent} tone="danger" />
            <KpiCard label="On leave" value={a.on_leave} tone="primary" />
            <KpiCard label="Checked in now" value={a.checked_in} tone="primary" />
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
