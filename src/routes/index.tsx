import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/app-shell";
import {
  EmptyState,
  ErrorBlock,
  KpiCard,
  LoadingBlock,
  PageHeader,
  SectionCard,
} from "@/components/crm/ui-bits";
import { SelectBox } from "@/components/crm/controls";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { useActionItems, useDashboard, useReport } from "@/lib/api";
import { dateTime, money, num } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/permissions";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <Dashboard />
    </AppShell>
  ),
});

type EmpRow = {
  user_id: string;
  full_name: string;
  role: string;
  active_leads: number;
  new_leads: number;
  meetings: number;
  proposals: number;
  conversions: number;
  lost: number;
  outreach: number;
  tasks_completed: number;
  conversion_rate: number | null;
};
type TeamRow = {
  team_id: string;
  team_name: string;
  members: number;
  new_leads: number;
  meetings: number;
  proposals: number;
  conversions: number;
  outreach: number;
  won_value: number;
  conversion_rate: number | null;
};
type Target = {
  user_id: string;
  full_name: string;
  target_type: string;
  target_value: number;
  actual: number;
  pct: number | null;
};
type Growth = { month: string; new_leads: number; won: number; lost: number; won_value: number };
type Revenue = {
  invoiced: number;
  collected: number;
  outstanding: number;
  overdue: number;
  won_value: number;
};

const PERIODS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
];

function Dashboard() {
  const { role, profile } = useAuth();
  const [days, setDays] = useState("30");
  const [mine, setMine] = useState(role === "bds_employee");
  const range = useMemo(
    () => ({
      from: new Date(Date.now() - Number(days) * 864e5).toISOString(),
      to: new Date(Date.now() + 60_000).toISOString(),
    }),
    [days],
  );
  const scope = mine || role === "bds_employee" ? "mine" : "visible";
  const d = useDashboard(range.from, range.to, scope);
  const actions = useActionItems();
  const company = role === "admin" && !mine;
  const teamView = role === "mentor" && !mine;
  const emp = useReport<EmpRow>(
    "report_by_employee",
    { p_from: range.from, p_to: range.to },
    teamView || company,
  );
  const teams = useReport<TeamRow>(
    "report_by_team",
    { p_from: range.from, p_to: range.to },
    company,
  );
  const growth = useReport<Growth>("report_monthly_growth", { p_months: 6 }, company);
  const revenue = useReport<Revenue>(
    "report_revenue",
    { p_from: range.from.slice(0, 10), p_to: range.to.slice(0, 10) },
    company,
  );
  const targets = useReport<Target>("target_attainment", {
    p_from: range.from.slice(0, 10),
    p_to: range.to.slice(0, 10),
  });

  const title =
    role === "admin"
      ? mine
        ? "My dashboard"
        : "Company dashboard"
      : role === "mentor"
        ? mine
          ? "My dashboard"
          : "Team dashboard"
        : "My dashboard";
  const myTargets = (targets.data ?? []).filter(
    (t) => scope === "visible" || t.user_id === profile?.id,
  );
  const rev = revenue.data?.[0] as unknown as Revenue | undefined;

  return (
    <>
      <PageHeader
        title={title}
        subtitle={`${role ? ROLE_LABEL[role] : ""} workspace`}
        actions={
          <>
            {role !== "bds_employee" ? (
              <Button
                variant={mine ? "default" : "outline"}
                size="sm"
                onClick={() => setMine((m) => !m)}
              >
                {mine ? "Show " + (role === "admin" ? "company" : "team") : "Show my own"}
              </Button>
            ) : null}
            <SelectBox
              value={days}
              onChange={setDays}
              options={PERIODS}
              className="w-40"
              ariaLabel="Period"
            />
          </>
        }
      />

      {d.isLoading ? (
        <LoadingBlock rows={3} />
      ) : d.isError ? (
        <ErrorBlock error={d.error} onRetry={() => d.refetch()} />
      ) : d.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Active leads"
              value={num(d.data.active_leads)}
              hint={`${num(d.data.new_leads)} new in period`}
            />
            <KpiCard
              label="Qualified"
              value={num(d.data.qualified)}
              hint="entered Qualified in period"
              tone="primary"
            />
            <KpiCard label="Meetings booked" value={num(d.data.meetings_booked)} />
            <KpiCard label="Proposals sent" value={num(d.data.proposals_sent)} />
            <KpiCard
              label="Won / Lost"
              value={`${num(d.data.won)} / ${num(d.data.lost)}`}
              hint={
                d.data.won + d.data.lost > 0
                  ? `${Math.round((100 * d.data.won) / (d.data.won + d.data.lost))}% conversion`
                  : "no closed deals yet"
              }
              tone="success"
            />
            <KpiCard
              label="Open pipeline value"
              value={money(d.data.pipeline_value)}
              hint="estimates — not revenue"
            />
            <KpiCard
              label="Won deal value"
              value={money(d.data.won_value)}
              hint="agreed project value — not cash"
              tone="success"
            />
            <KpiCard
              label="Pending approvals"
              value={num(d.data.pending_approvals)}
              tone={d.data.pending_approvals ? "warning" : "default"}
            />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard label="Follow-ups today" value={num(d.data.follow_ups_today)} />
            <KpiCard
              label="Overdue follow-ups"
              value={num(d.data.overdue_follow_ups)}
              tone={d.data.overdue_follow_ups ? "danger" : "default"}
            />
            <KpiCard
              label="Stale leads"
              value={num(d.data.stale_leads)}
              hint="no contact for a while"
              tone={d.data.stale_leads ? "warning" : "default"}
            />
            <KpiCard label="Tasks due today" value={num(d.data.tasks_due_today)} />
            <KpiCard
              label="Overdue tasks"
              value={num(d.data.overdue_tasks)}
              tone={d.data.overdue_tasks ? "danger" : "default"}
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <SectionCard title="Leads by stage" className="lg:col-span-2">
              <div className="h-64" role="img" aria-label="Bar chart of leads per pipeline stage">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.data.by_stage}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11 }}
                      interval={0}
                      angle={-25}
                      height={60}
                      textAnchor="end"
                    />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar
                      dataKey="count"
                      name="Leads"
                      fill="var(--color-chart-1)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
            <SectionCard
              title="My action centre"
              action={
                <Link to="/tasks" className="text-xs text-primary hover:underline">
                  Tasks
                </Link>
              }
            >
              {actions.isError ? (
                <ErrorBlock error={actions.error} />
              ) : (actions.data ?? []).length === 0 ? (
                <EmptyState message="Nothing due today. 🎉" />
              ) : (
                <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
                  {(actions.data ?? []).slice(0, 20).map((a) => (
                    <li key={a.kind + a.id} className="flex items-start justify-between gap-2">
                      {a.kind === "follow_up" ? (
                        <Link
                          to="/leads/$leadId"
                          params={{ leadId: a.id }}
                          className="hover:underline"
                        >
                          Follow up — {a.title}
                        </Link>
                      ) : (
                        <span>Task — {a.title}</span>
                      )}
                      <span
                        className={
                          a.is_overdue
                            ? "shrink-0 text-xs font-medium text-destructive"
                            : "shrink-0 text-xs text-muted-foreground"
                        }
                      >
                        {a.is_overdue ? "Overdue" : dateTime(a.due_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          {myTargets.length > 0 ? (
            <SectionCard title="Target progress" className="mt-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {myTargets.map((t, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-xs">
                      <span>
                        {scope === "visible" ? `${t.full_name} · ` : ""}
                        {t.target_type.replace(/_/g, " ")}
                      </span>
                      <span>
                        {num(t.actual)} / {num(t.target_value)}
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${Math.min(100, t.pct ?? 0)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : null}

          {company ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <SectionCard title="Revenue (cash vs. billed vs. won)">
                {revenue.isError ? (
                  <ErrorBlock error={revenue.error} />
                ) : rev ? (
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Invoiced</dt>
                      <dd className="font-semibold">{money(rev.invoiced)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Payments received (net)</dt>
                      <dd className="font-semibold text-success">{money(rev.collected)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Outstanding</dt>
                      <dd className="font-semibold">{money(rev.outstanding)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Overdue</dt>
                      <dd className="font-semibold text-destructive">{money(rev.overdue)}</dd>
                    </div>
                  </dl>
                ) : (
                  <LoadingBlock rows={2} />
                )}
              </SectionCard>
              <SectionCard title="Monthly growth (last 6 months)">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={growth.data ?? []}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Line dataKey="new_leads" name="New leads" stroke="var(--color-chart-1)" />
                      <Line dataKey="won" name="Won" stroke="var(--color-chart-2)" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>
              <SectionCard title="Team performance" className="lg:col-span-2">
                {teams.isError ? (
                  <ErrorBlock error={teams.error} />
                ) : (teams.data ?? []).length === 0 ? (
                  <EmptyState message="No teams yet — create one under Team." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Team</TableHead>
                        <TableHead className="text-right">Members</TableHead>
                        <TableHead className="text-right">New leads</TableHead>
                        <TableHead className="text-right">Outreach</TableHead>
                        <TableHead className="text-right">Meetings</TableHead>
                        <TableHead className="text-right">Won</TableHead>
                        <TableHead className="text-right">Won value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(teams.data ?? []).map((t) => (
                        <TableRow key={t.team_id}>
                          <TableCell className="font-medium">{t.team_name}</TableCell>
                          <TableCell className="text-right">{t.members}</TableCell>
                          <TableCell className="text-right">{num(t.new_leads)}</TableCell>
                          <TableCell className="text-right">{num(t.outreach)}</TableCell>
                          <TableCell className="text-right">{num(t.meetings)}</TableCell>
                          <TableCell className="text-right">{num(t.conversions)}</TableCell>
                          <TableCell className="text-right">{money(t.won_value)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </SectionCard>
            </div>
          ) : null}

          {teamView || company ? (
            <SectionCard
              title={teamView ? "My team — employee activity" : "Employee performance"}
              className="mt-4"
            >
              {emp.isError ? (
                <ErrorBlock error={emp.error} />
              ) : (emp.data ?? []).length === 0 ? (
                <EmptyState message="No team members to show." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-right">Active leads</TableHead>
                        <TableHead className="text-right">Outreach</TableHead>
                        <TableHead className="text-right">Meetings</TableHead>
                        <TableHead className="text-right">Proposals</TableHead>
                        <TableHead className="text-right">Won</TableHead>
                        <TableHead className="text-right">Lost</TableHead>
                        <TableHead className="text-right">Conv. %</TableHead>
                        <TableHead className="text-right">Tasks done</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(emp.data ?? []).map((e) => (
                        <TableRow key={e.user_id}>
                          <TableCell className="font-medium">{e.full_name}</TableCell>
                          <TableCell className="text-right">{e.active_leads}</TableCell>
                          <TableCell className="text-right">{num(e.outreach)}</TableCell>
                          <TableCell className="text-right">{num(e.meetings)}</TableCell>
                          <TableCell className="text-right">{num(e.proposals)}</TableCell>
                          <TableCell className="text-right">{num(e.conversions)}</TableCell>
                          <TableCell className="text-right">{num(e.lost)}</TableCell>
                          <TableCell className="text-right">{e.conversion_rate ?? "—"}</TableCell>
                          <TableCell className="text-right">{num(e.tasks_completed)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </SectionCard>
          ) : null}
        </>
      ) : null}
    </>
  );
}
