import { Link } from "@tanstack/react-router";
import { EmptyState, SectionCard } from "@/components/crm/ui-bits";
import type { DashboardHome } from "@/lib/api";
import { num } from "@/lib/format";

type Item = { label: string; count: number; to: string; tone: "danger" | "warning" | "info" };
const TONE: Record<Item["tone"], string> = {
  danger: "bg-destructive/12 text-destructive",
  warning: "bg-warning/15 text-warning",
  info: "bg-primary/10 text-primary",
};

/** Everything that needs action, in one list. Zero-count lines are hidden; each line opens the place to act. */
export function AttentionPanel({ data }: { data: DashboardHome }) {
  const s = data.summary;
  const a = data.attendance;
  const all: Item[] = [
    { label: "Overdue follow-ups", count: s.overdue_follow_ups, to: "/leads", tone: "danger" },
    { label: "Overdue tasks", count: s.overdue_tasks, to: "/tasks", tone: "danger" },
    {
      label: "Stale leads (no recent contact)",
      count: s.stale_leads,
      to: "/leads",
      tone: "warning",
    },
    { label: "Pending approvals", count: s.pending_approvals, to: "/approvals", tone: "warning" },
    {
      label: "Leave requests to decide",
      count: a?.pending_leave ?? 0,
      to: "/audit-logs",
      tone: "info",
    },
    {
      label: "Attendance corrections to review",
      count: a?.pending_corrections ?? 0,
      to: "/audit-logs",
      tone: "info",
    },
    {
      label: "Missing check-outs",
      count: a?.missing_checkout ?? 0,
      to: "/audit-logs",
      tone: "warning",
    },
  ];
  const items = all.filter((i) => i.count > 0);

  return (
    <SectionCard title="Needs attention">
      {items.length === 0 ? (
        <EmptyState message="Nothing needs attention. 🎉" />
      ) : (
        <ul className="space-y-2 text-sm">
          {items.map((i) => (
            <li key={i.label}>
              <Link
                to={i.to}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-muted"
              >
                <span>{i.label}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[i.tone]}`}
                >
                  {num(i.count)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
