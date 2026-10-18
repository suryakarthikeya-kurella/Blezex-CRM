import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
import { EmptyState, KpiCard, PageHeader, SectionCard } from "@/components/crm/ui-bits";
import { ALL_USERS } from "@/lib/auth";
import { currency, num, useTable } from "@/lib/crm-hooks";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — BlezeX CRM" },
      { name: "description", content: "Team performance, revenue and lead source analytics." },
      { property: "og:title", content: "Reports — BlezeX CRM" },
      {
        property: "og:description",
        content: "Team performance, revenue and lead source analytics.",
      },
    ],
  }),
  component: ReportsPage,
});

const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

function ReportsPage() {
  const leads = useTable("Leads");
  const clients = useTable("Clients");
  const activities = useTable("Activities");
  const tasks = useTable("Tasks");

  const L = leads.data ?? [];
  const C = clients.data ?? [];
  const A = activities.data ?? [];
  const T = tasks.data ?? [];

  const team = useMemo(
    () =>
      ALL_USERS.map((u) => {
        const own = L.filter((l) => l["Assigned To"] === u.email);
        const conv = own.filter((l) => l["Status"] === "Converted Client");
        const myTasks = T.filter((t) => t["Assigned To"] === u.email);
        return {
          name: u.name,
          email: u.email,
          role: u.role,
          leads: own.length,
          activities: A.filter((a) => a["Owner"] === u.email).length,
          tasksCompleted: myTasks.filter((t) => t["Status"] === "Completed").length,
          tasksTotal: myTasks.length,
          conversions: conv.length,
          conversionRate: own.length ? Math.round((conv.length / own.length) * 100) : 0,
          revenue: C.filter((c) => c["Account Manager"] === u.email).reduce(
            (s, c) => s + num(c["Amount Paid"]),
            0,
          ),
        };
      }),
    [L, A, T, C],
  );

  const sourcePerf = useMemo(() => {
    const map = new Map<string, { name: string; leads: number; converted: number; value: number }>();
    L.forEach((l) => {
      const k = l["Lead Source"] || "Unknown";
      const e = map.get(k) ?? { name: k, leads: 0, converted: 0, value: 0 };
      e.leads += 1;
      if (l["Status"] === "Converted Client") e.converted += 1;
      e.value += num(l["Expected Deal Value"]);
      map.set(k, e);
    });
    return [...map.values()].sort((a, b) => b.leads - a.leads);
  }, [L]);

  const growth = useMemo(() => {
    const map = new Map<string, { month: string; leads: number; conversions: number; revenue: number }>();
    const touch = (k: string) => {
      if (!k) return null;
      const e = map.get(k) ?? { month: k, leads: 0, conversions: 0, revenue: 0 };
      map.set(k, e);
      return e;
    };
    L.forEach((l) => {
      const e = touch(String(l["Created Date"] ?? "").slice(0, 7));
      if (e) e.leads += 1;
      if (l["Status"] === "Converted Client") {
        const e2 = touch(String(l["Last Updated Date"] ?? l["Created Date"] ?? "").slice(0, 7));
        if (e2) e2.conversions += 1;
      }
    });
    C.forEach((c) => {
      const e = touch(String(c["Start Date"] ?? c["Created Date"] ?? "").slice(0, 7));
      if (e) e.revenue += num(c["Amount Paid"]);
    });
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [L, C]);

  const lost = useMemo(() => {
    const map = new Map<string, number>();
    L.filter((l) => l["Status"] === "Lost").forEach((l) => {
      const k = l["Lead Source"] || "Unknown";
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    return [...map].map(([name, value]) => ({ name, value }));
  }, [L]);

  const totalRevenue = C.reduce((s, c) => s + num(c["Amount Paid"]), 0);
  const contracted = C.reduce((s, c) => s + num(c["Project Value"]), 0);
  const converted = L.filter((l) => l["Status"] === "Converted Client").length;

  return (
    <AppShell adminOnly>
      <PageHeader title="Reports" subtitle="Analytics and team performance (admins only)" />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Leads created" value={L.length} tone="primary" />
        <KpiCard
          label="Overall conversion"
          value={`${L.length ? Math.round((converted / L.length) * 100) : 0}%`}
          tone="success"
        />
        <KpiCard label="Contracted value" value={currency(contracted)} />
        <KpiCard label="Revenue collected" value={currency(totalRevenue)} tone="success" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Leads and conversions by team member">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={team}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="leads" name="Leads" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
              <Bar
                dataKey="conversions"
                name="Conversions"
                fill="var(--color-chart-2)"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Activities and completed tasks by team member">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={team}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar
                dataKey="activities"
                name="Activities"
                fill="var(--color-chart-3)"
                radius={[6, 6, 0, 0]}
              />
              <Bar
                dataKey="tasksCompleted"
                name="Tasks completed"
                fill="var(--color-chart-5)"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Monthly growth">
          {growth.length === 0 ? (
            <EmptyState message="Not enough data yet." />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={growth}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="leads"
                  name="Leads"
                  stroke="var(--color-chart-1)"
                  strokeWidth={2.5}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="conversions"
                  name="Conversions"
                  stroke="var(--color-chart-2)"
                  strokeWidth={2.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard title="Lost leads analysis">
          {lost.length === 0 ? (
            <EmptyState message="No lost leads recorded." />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={lost} dataKey="value" nameKey="name" outerRadius={85} label>
                  {lost.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Team performance summary">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Activities</TableHead>
                  <TableHead className="text-right">Tasks</TableHead>
                  <TableHead className="text-right">Conv.</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {team.map((t) => (
                  <TableRow key={t.email}>
                    <TableCell>
                      <p className="font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.role}</p>
                    </TableCell>
                    <TableCell className="text-right">{t.leads}</TableCell>
                    <TableCell className="text-right">{t.activities}</TableCell>
                    <TableCell className="text-right">
                      {t.tasksCompleted}/{t.tasksTotal}
                    </TableCell>
                    <TableCell className="text-right">{t.conversions}</TableCell>
                    <TableCell className="text-right">{t.conversionRate}%</TableCell>
                    <TableCell className="text-right">{currency(t.revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard title="Lead source performance">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Converted</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Pipeline</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sourcePerf.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <EmptyState message="No leads yet." />
                    </TableCell>
                  </TableRow>
                ) : (
                  sourcePerf.map((s) => (
                    <TableRow key={s.name}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-right">{s.leads}</TableCell>
                      <TableCell className="text-right">{s.converted}</TableCell>
                      <TableCell className="text-right">
                        {s.leads ? Math.round((s.converted / s.leads) * 100) : 0}%
                      </TableCell>
                      <TableCell className="text-right">{currency(s.value)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
