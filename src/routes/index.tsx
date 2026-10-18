import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/app-shell";
import { EmptyState, KpiCard, PageHeader, SectionCard, StatusPill } from "@/components/crm/ui-bits";
import { ALL_USERS, useAuth } from "@/lib/auth";
import { currency, num, today, useTable } from "@/lib/crm-hooks";
import { LEAD_STATUSES } from "@/lib/crm-schema";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — BlezeX CRM" },
      {
        name: "description",
        content: "Pipeline, revenue and team activity at a glance for the BlezeX sales team.",
      },
      { property: "og:title", content: "Dashboard — BlezeX CRM" },
      {
        property: "og:description",
        content: "Pipeline, revenue and team activity at a glance for the BlezeX sales team.",
      },
    ],
  }),
  component: DashboardPage,
});

const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

function monthKey(d: string) {
  return String(d ?? "").slice(0, 7);
}

function DashboardPage() {
  const { user, isAdmin } = useAuth();
  const leads = useTable("Leads");
  const clients = useTable("Clients");
  const activities = useTable("Activities");
  const tasks = useTable("Tasks");
  const day = today();

  const L = leads.data ?? [];
  const C = clients.data ?? [];
  const A = activities.data ?? [];
  const T = tasks.data ?? [];

  const count = (s: string) => L.filter((l) => l["Status"] === s).length;
  const converted = count("Converted Client");
  const conversionRate = L.length ? Math.round((converted / L.length) * 100) : 0;
  const pipeline = L.filter((l) => !["Converted Client", "Lost"].includes(l["Status"])).reduce(
    (s, l) => s + num(l["Expected Deal Value"]),
    0,
  );
  const revenue = C.reduce((s, c) => s + num(c["Amount Paid"]), 0);
  const pendingPayments = C.reduce((s, c) => s + num(c["Balance Amount"]), 0);

  const byStatus = useMemo(
    () => LEAD_STATUSES.map((s) => ({ name: s, value: count(s) })).filter((d) => d.value > 0),
    [L],
  );

  const bySource = useMemo(() => {
    const map = new Map<string, number>();
    L.forEach((l) => {
      const k = l["Lead Source"] || "Unknown";
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    return [...map].map(([name, value]) => ({ name, value }));
  }, [L]);

  const monthly = useMemo(() => {
    const map = new Map<string, { month: string; conversions: number; revenue: number }>();
    L.filter((l) => l["Status"] === "Converted Client").forEach((l) => {
      const k = monthKey(l["Last Updated Date"] || l["Created Date"]);
      if (!k) return;
      const e = map.get(k) ?? { month: k, conversions: 0, revenue: 0 };
      e.conversions += 1;
      map.set(k, e);
    });
    C.forEach((c) => {
      const k = monthKey(c["Start Date"] || c["Created Date"]);
      if (!k) return;
      const e = map.get(k) ?? { month: k, conversions: 0, revenue: 0 };
      e.revenue += num(c["Amount Paid"]);
      map.set(k, e);
    });
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [L, C]);

  const teamPerf = useMemo(
    () =>
      ALL_USERS.map((u) => ({
        name: u.name,
        leads: L.filter((l) => l["Assigned To"] === u.email).length,
        activities: A.filter((a) => a["Owner"] === u.email).length,
        conversions: L.filter(
          (l) => l["Assigned To"] === u.email && l["Status"] === "Converted Client",
        ).length,
      })),
    [L, A],
  );

  const mine = (owner: string) => isAdmin || owner === user?.email;
  const recentActivities = [...A]
    .sort((a, b) => String(b["Date"]).localeCompare(String(a["Date"])))
    .slice(0, 6);
  const upcoming = L.filter(
    (l) => mine(l["Assigned To"]) && l["Next Follow-up Date"] && l["Next Follow-up Date"] >= day,
  )
    .sort((a, b) => a["Next Follow-up Date"].localeCompare(b["Next Follow-up Date"]))
    .slice(0, 6);
  const pendingTasks = T.filter((t) => mine(t["Assigned To"]) && t["Status"] !== "Completed").slice(
    0,
    6,
  );
  const duePayments = C.filter((c) => num(c["Balance Amount"]) > 0).slice(0, 6);

  return (
    <AppShell>
      <PageHeader
        title={`Welcome back, ${user?.name}`}
        subtitle="Live pipeline from the shared BlezeX sheet"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total leads" value={L.length} tone="primary" />
        <KpiCard label="New leads" value={count("New Lead")} />
        <KpiCard label="Contacted" value={count("Contacted")} />
        <KpiCard label="Meetings scheduled" value={count("Meeting Scheduled")} />
        <KpiCard label="Proposals sent" value={count("Proposal Sent")} />
        <KpiCard label="Negotiations" value={count("Negotiation")} tone="warning" />
        <KpiCard label="Converted clients" value={converted} tone="success" />
        <KpiCard label="Lost leads" value={count("Lost")} tone="danger" />
        <KpiCard label="Conversion rate" value={`${conversionRate}%`} tone="primary" />
        <KpiCard label="Pipeline value" value={currency(pipeline)} />
        <KpiCard label="Revenue closed" value={currency(revenue)} tone="success" />
        <KpiCard label="Pending payments" value={currency(pendingPayments)} tone="warning" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Leads by status">
          {byStatus.length === 0 ? (
            <EmptyState message="No leads yet." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byStatus}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} height={60} dy={10} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard title="Leads by source">
          {bySource.length === 0 ? (
            <EmptyState message="No leads yet." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={bySource} dataKey="value" nameKey="name" outerRadius={90} label>
                  {bySource.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard title="Monthly conversions">
          {monthly.length === 0 ? (
            <EmptyState message="No conversions yet." />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="conversions" fill="var(--color-chart-2)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard title="Revenue trend">
          {monthly.length === 0 ? (
            <EmptyState message="No revenue recorded yet." />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => currency(Number(v))} />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="var(--color-chart-1)"
                  strokeWidth={2.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard title="Team performance" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={teamPerf}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="leads" name="Leads" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
              <Bar
                dataKey="activities"
                name="Activities"
                fill="var(--color-chart-3)"
                radius={[6, 6, 0, 0]}
              />
              <Bar
                dataKey="conversions"
                name="Conversions"
                fill="var(--color-chart-2)"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <SectionCard
          title="Recent activities"
          action={
            <Link to="/activities" className="text-xs text-primary hover:underline">
              View all
            </Link>
          }
        >
          {recentActivities.length === 0 ? (
            <EmptyState message="Nothing logged yet." />
          ) : (
            <ul className="space-y-3">
              {recentActivities.map((a) => (
                <li key={a.__row} className="text-sm">
                  <div className="flex items-center gap-2">
                    <StatusPill value={a["Activity Type"]} />
                    <span className="text-xs text-muted-foreground">{a["Date"]}</span>
                  </div>
                  <p className="mt-1 font-medium">{a["Company"]}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a["Discussion Summary"]}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Upcoming follow-ups"
          action={
            <Link to="/leads" className="text-xs text-primary hover:underline">
              View leads
            </Link>
          }
        >
          {upcoming.length === 0 ? (
            <EmptyState message="No follow-ups scheduled." />
          ) : (
            <ul className="space-y-3">
              {upcoming.map((l) => (
                <li key={l.__row} className="text-sm">
                  <p className="font-medium">{l["Company Name"]}</p>
                  <p className="text-xs text-muted-foreground">
                    {l["Next Follow-up Date"]} · {l["Status"]}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Pending tasks"
          action={
            <Link to="/tasks" className="text-xs text-primary hover:underline">
              View tasks
            </Link>
          }
        >
          {pendingTasks.length === 0 ? (
            <EmptyState message="Nothing pending." />
          ) : (
            <ul className="space-y-3">
              {pendingTasks.map((t) => (
                <li key={t.__row} className="text-sm">
                  <p className="font-medium">{t["Task Title"]}</p>
                  <p className="text-xs text-muted-foreground">
                    Due {t["Due Date"] || "—"} · {t["Status"]}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Pending payments"
          action={
            <Link to="/clients" className="text-xs text-primary hover:underline">
              View clients
            </Link>
          }
        >
          {duePayments.length === 0 ? (
            <EmptyState message="All payments settled." />
          ) : (
            <ul className="space-y-3">
              {duePayments.map((c) => (
                <li key={c.__row} className="text-sm">
                  <p className="font-medium">{c["Company Name"]}</p>
                  <p className="text-xs text-muted-foreground">
                    {currency(num(c["Balance Amount"]))} outstanding · {c["Payment Status"]}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
