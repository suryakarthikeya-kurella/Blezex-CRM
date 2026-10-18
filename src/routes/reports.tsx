import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/crm/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { useReport } from "@/lib/api";
import { downloadCsv, label, money } from "@/lib/format";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "Reports — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <Page />
    </AppShell>
  ),
});

type Row = Record<string, string | number | null>;
const MONEY = new Set([
  "won_value",
  "lost_value",
  "open_pipeline_value",
  "invoiced",
  "collected",
  "outstanding",
  "overdue",
]);

function ReportTable({
  name,
  args,
  enabled = true,
}: {
  name: string;
  args: Record<string, unknown>;
  enabled?: boolean;
}) {
  const q = useReport<Row>(name, args, enabled);
  const rows = useMemo(() => (q.data ?? []).map((r) => (Array.isArray(r) ? r : r)), [q.data]);
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  if (rows.length === 0) return <EmptyState message="No data for this period." />;
  const cols = Object.keys(rows[0]!).filter((c) => !c.endsWith("_id") && c !== "role");
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="mb-2"
        onClick={() => downloadCsv(`${name}.csv`, cols, rows)}
      >
        <Download className="size-4" /> CSV
      </Button>
      <div className="surface overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {cols.map((c) => (
                <TableHead key={c} className={typeof rows[0]![c] === "number" ? "text-right" : ""}>
                  {label(c)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                {cols.map((c) => (
                  <TableCell key={c} className={typeof r[c] === "number" ? "text-right" : ""}>
                    {MONEY.has(c) ? money(r[c]) : (r[c] ?? "—")}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function Revenue({ from, to }: { from: string; to: string }) {
  const q = useReport<Row>("report_revenue", { p_from: from, p_to: to });
  if (q.isLoading) return <LoadingBlock rows={2} />;
  if (q.isError) return <ErrorBlock error={q.error} />;
  const r = (q.data as unknown as Row) ?? {};
  const items: [string, string][] = [
    ["invoiced", "Invoiced (issued invoices)"],
    ["collected", "Cash collected (payments − refunds)"],
    ["outstanding", "Outstanding balance"],
    ["overdue", "Overdue balance"],
    ["won_value", "Won deal value (agreed, not cash)"],
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {items.map(([k, l]) => (
        <div key={k} className="surface p-4">
          <dt className="text-xs text-muted-foreground">{l}</dt>
          <dd className="font-display text-xl font-semibold">{money(r[k])}</dd>
        </div>
      ))}
    </dl>
  );
}

function Page() {
  const { role } = useAuth();
  const [from, setFrom] = useState(() =>
    new Date(Date.now() - 30 * 864e5).toLocaleDateString("en-CA"),
  );
  const [to, setTo] = useState(() => new Date().toLocaleDateString("en-CA"));
  const a = {
    p_from: new Date(from).toISOString(),
    p_to: new Date(new Date(to).getTime() + 864e5).toISOString(),
  };
  const d = { p_from: from, p_to: to };
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Scoped to the data you're allowed to see"
        actions={
          <div className="flex items-center gap-2 text-xs">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 w-36"
              aria-label="From"
            />{" "}
            to{" "}
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 w-36"
              aria-label="To"
            />
          </div>
        }
      />
      <Tabs defaultValue="employees">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="sources">Lead sources</TabsTrigger>
          <TabsTrigger value="lost">Lost reasons</TabsTrigger>
          <TabsTrigger value="growth">Monthly growth</TabsTrigger>
          <TabsTrigger value="targets">Targets</TabsTrigger>
          {role === "admin" ? <TabsTrigger value="revenue">Revenue</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="employees" className="mt-3">
          <ReportTable name="report_by_employee" args={a} />
        </TabsContent>
        <TabsContent value="teams" className="mt-3">
          <ReportTable name="report_by_team" args={a} enabled={role !== "bds_employee"} />
        </TabsContent>
        <TabsContent value="sources" className="mt-3">
          <ReportTable name="report_lead_sources" args={a} />
        </TabsContent>
        <TabsContent value="lost" className="mt-3">
          <ReportTable name="report_lost_reasons" args={a} />
        </TabsContent>
        <TabsContent value="growth" className="mt-3">
          <ReportTable name="report_monthly_growth" args={{ p_months: 12 }} />
        </TabsContent>
        <TabsContent value="targets" className="mt-3">
          <ReportTable name="target_attainment" args={d} />
        </TabsContent>
        {role === "admin" ? (
          <TabsContent value="revenue" className="mt-3">
            <Revenue from={from} to={to} />
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}
