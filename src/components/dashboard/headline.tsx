import { KpiCard } from "@/components/crm/ui-bits";
import type { DashboardHome } from "@/lib/api";
import { money, num } from "@/lib/format";

export type DashView = "employee" | "mentor" | "admin";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);

/** Four headline numbers per audience. All values come from the single dashboard_home() response. */
export function HeadlineCards({ view, data }: { view: DashView; data: DashboardHome }) {
  const s = data.summary;
  const a = data.attendance;
  const targetsCard = (label: string) => (
    <KpiCard
      label={label}
      value={data.targets.count ? pct(data.targets.avg_pct) : "—"}
      hint={data.targets.count ? `${data.targets.count} target(s) in period` : "No targets set"}
      tone="primary"
    />
  );
  const overdueFollowUps = (label: string) => (
    <KpiCard
      label={label}
      value={num(s.overdue_follow_ups)}
      hint={`${num(s.follow_ups_today)} due today · ${num(s.stale_leads)} stale`}
      tone={s.overdue_follow_ups ? "danger" : "default"}
    />
  );

  if (view === "employee")
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Open pipeline"
          value={money(s.pipeline_value)}
          hint={`${num(s.active_leads)} active leads · estimates, not revenue`}
        />
        <KpiCard
          label="Follow-ups due"
          value={num(s.follow_ups_today + s.overdue_follow_ups)}
          hint={`${num(s.overdue_follow_ups)} overdue`}
          tone={s.overdue_follow_ups ? "danger" : "default"}
        />
        <KpiCard
          label="Tasks due"
          value={num(s.tasks_due_today + s.overdue_tasks)}
          hint={`${num(s.overdue_tasks)} overdue`}
          tone={s.overdue_tasks ? "danger" : "default"}
        />
        {targetsCard("Target progress")}
      </div>
    );

  if (view === "mentor")
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Team pipeline"
          value={money(s.pipeline_value)}
          hint={`${num(s.active_leads)} active leads · estimates, not revenue`}
        />
        {overdueFollowUps("Overdue follow-ups")}
        {targetsCard("Team target progress")}
        <KpiCard
          label="Checked in now"
          value={a ? `${a.checked_in} / ${a.people}` : "—"}
          {...(a ? { hint: `${a.late} late · ${a.on_leave} on leave · ${a.absent} absent` } : {})}
          tone="success"
        />
      </div>
    );

  const closed = s.won + s.lost;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="Open pipeline value"
        value={money(s.pipeline_value)}
        hint={`${num(s.active_leads)} active leads · estimates, not revenue`}
      />
      <KpiCard
        label="Won deal value"
        value={money(s.won_value)}
        hint={`${num(s.won)} won in period · agreed value, not cash`}
        tone="success"
      />
      <KpiCard
        label="Conversion"
        value={closed ? `${Math.round((100 * s.won) / closed)}%` : "—"}
        hint={closed ? `${num(s.won)} won / ${num(s.lost)} lost` : "no closed deals yet"}
        tone="success"
      />
      <KpiCard
        label="Overdue items"
        value={num(s.overdue_follow_ups + s.overdue_tasks)}
        hint={`${num(s.overdue_follow_ups)} follow-ups · ${num(s.overdue_tasks)} tasks`}
        tone={s.overdue_follow_ups + s.overdue_tasks ? "danger" : "default"}
      />
    </div>
  );
}
