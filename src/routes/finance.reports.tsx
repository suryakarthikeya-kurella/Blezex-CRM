import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import {
  EmptyState,
  ErrorBlock,
  KpiCard,
  LoadingBlock,
  PageHeader,
  StatusPill,
} from "@/components/crm/ui-bits";
import { Pager, SelectBox } from "@/components/crm/controls";
import { RangeBar, type Range } from "@/components/finance/bits";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOverview, useSeries } from "@/lib/finance-api";
import {
  fetchAllPages,
  REPORT_TABS,
  type ReportTab,
  type SeriesRow,
  thisMonth,
} from "@/lib/finance";
import { date, downloadCsv, label, money } from "@/lib/format";
import { supabase, unwrap } from "@/lib/supabase";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);
const searchSchema = z.object({
  tab: z.enum(REPORT_TABS).catch("sales"),
  from: day,
  to: day,
  purpose: z.enum(["advance", "partial", "final"]).optional().catch(undefined),
  overdue: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute("/finance/reports")({
  head: () => ({ meta: [{ title: "Financial reports — BlezeX Connect" }] }),
  validateSearch: (s: Record<string, unknown>) => searchSchema.parse(s),
  component: Page,
});

const PAGE = 25;
type Kind = "text" | "date" | "month" | "money" | "status" | "label";
type Col = { key: string; label: string; kind?: Kind };
type Row = Record<string, string | number | null>;
type Fetcher = (
  from: number,
  to: number,
) => PromiseLike<{
  data: unknown;
  error: { code?: string; message?: string } | null;
  count: number | null;
}>;

function Cell({ v, kind = "text" }: { v: string | number | null; kind?: Kind }) {
  if (v == null || v === "") return <>—</>;
  switch (kind) {
    case "money":
      return <>{money(v as number)}</>;
    case "date":
      return <>{date(String(v))}</>;
    case "month":
      return (
        <>
          {new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(
            new Date(String(v)),
          )}
        </>
      );
    case "status":
      return <StatusPill value={String(v)} />;
    case "label":
      return <>{label(String(v))}</>;
    default:
      return <>{String(v)}</>;
  }
}

/** Server-paginated list + CSV export that walks the same query page by page. */
function ListReport({
  name,
  cols,
  deps,
  fetcher,
  csv,
}: {
  name: string;
  cols: Col[];
  deps: unknown[];
  fetcher: Fetcher;
  csv: string;
}) {
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const depKey = JSON.stringify(deps);
  const q = useQuery({
    queryKey: ["finance", "report", name, depKey, page],
    queryFn: async () => {
      const res = await fetcher(page * PAGE, page * PAGE + PAGE - 1);
      return { rows: unwrap({ data: res.data, error: res.error }) as Row[], count: res.count ?? 0 };
    },
  });
  const exportCsv = async () => {
    setBusy(true);
    try {
      const all = await fetchAllPages(async (f, t) => {
        const res = await fetcher(f, t);
        return unwrap({ data: res.data, error: res.error }) as Row[];
      });
      downloadCsv(
        `${csv}.csv`,
        cols.map((c) => c.label),
        all.map((r) => Object.fromEntries(cols.map((c) => [c.label, r[c.key] ?? ""]))),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !q.data?.count}
          onClick={() => void exportCsv()}
        >
          <Download className="size-4" /> {busy ? "Exporting…" : "Export CSV"}
        </Button>
      </div>
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : (q.data?.rows ?? []).length === 0 ? (
        <EmptyState message="No records for this selection." />
      ) : (
        <>
          <div className="surface overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {cols.map((c) => (
                    <TableHead key={c.key} className={c.kind === "money" ? "text-right" : ""}>
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data!.rows.map((r, i) => (
                  <TableRow
                    key={String(
                      r["id"] ?? r["payment_id"] ?? r["invoice_id"] ?? r["project_id"] ?? i,
                    )}
                  >
                    {cols.map((c) => (
                      <TableCell key={c.key} className={c.kind === "money" ? "text-right" : ""}>
                        <Cell v={r[c.key] ?? null} kind={c.kind ?? "text"} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={page} total={q.data!.count} pageSize={PAGE} onPage={setPage} />
        </>
      )}
    </div>
  );
}

type SeriesCol = { key: keyof SeriesRow; label: string };
function SeriesTable({
  range,
  bucket,
  cols,
  totals = false,
}: {
  range: Range;
  bucket: "month" | "year";
  cols: SeriesCol[];
  totals?: boolean;
}) {
  const q = useSeries(range.from, range.to, bucket);
  if (q.isLoading) return <LoadingBlock rows={3} />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data ?? [];
  if (rows.length === 0) return <EmptyState message="No data for this period." />;
  const fmt = (b: string) =>
    bucket === "year"
      ? b.slice(0, 4)
      : new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(new Date(b));
  return (
    <div className="surface overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{bucket === "year" ? "Year" : "Month"}</TableHead>
            {cols.map((c) => (
              <TableHead key={c.key} className="text-right">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.bucket}>
              <TableCell>{fmt(r.bucket)}</TableCell>
              {cols.map((c) => (
                <TableCell key={c.key} className="text-right">
                  {money(r[c.key] as number)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        {totals ? (
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">Total</TableCell>
              {cols.map((c) => (
                <TableCell key={c.key} className="text-right font-medium">
                  {money(rows.reduce((a, r) => a + (r[c.key] as number), 0))}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
    </div>
  );
}

function Bucket({
  value,
  onChange,
}: {
  value: "month" | "year";
  onChange: (v: "month" | "year") => void;
}) {
  return (
    <SelectBox
      value={value}
      onChange={(v) => onChange(v === "year" ? "year" : "month")}
      className="w-32"
      ariaLabel="Group by"
      options={[
        { value: "month", label: "Monthly" },
        { value: "year", label: "Yearly" },
      ]}
    />
  );
}

function Page() {
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const range: Range = { from: s.from ?? thisMonth().from, to: s.to ?? thisMonth().to };
  const [bucket, setBucket] = useState<"month" | "year">("month");
  const [purpose, setPurpose] = useState<string>(s.purpose ?? "");
  const [overdueOnly, setOverdueOnly] = useState(!!s.overdue);
  const ov = useOverview(range.from, range.to);
  const dep = [range.from, range.to];
  const setRange = (r: Range) =>
    void navigate({ search: (p) => ({ ...p, from: r.from, to: r.to }) });

  return (
    <>
      <PageHeader
        title="Financial reports"
        subtitle="Admin only · same definitions as the overview · CSV export for every list"
        actions={<RangeBar value={range} onChange={setRange} />}
      />
      <Tabs
        value={s.tab}
        onValueChange={(t) => void navigate({ search: (p) => ({ ...p, tab: t as ReportTab }) })}
      >
        <TabsList className="mb-4 h-auto flex-wrap">
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
          <TabsTrigger value="outstanding">Outstanding receivables</TabsTrigger>
          <TabsTrigger value="payroll">Payroll</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="cashflow">Cash flow</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="space-y-4">
          <Bucket value={bucket} onChange={setBucket} />
          <SeriesTable
            range={range}
            bucket={bucket}
            cols={[{ key: "closed_sales", label: "Closed sales" }]}
            totals
          />
          <ListReport
            name="sales"
            csv="sales-deals"
            deps={dep}
            cols={[
              { key: "closed_on", label: "Closed on", kind: "date" },
              { key: "project_number", label: "Deal" },
              { key: "company_name", label: "Client" },
              { key: "service_name", label: "Service" },
              { key: "sales_user_name", label: "Sales employee" },
              { key: "agreed_value", label: "Agreed value", kind: "money" },
            ]}
            fetcher={(f, t) =>
              supabase
                .from("finance_deals")
                .select("*", { count: "exact" })
                .gte("closed_on", range.from)
                .lte("closed_on", range.to)
                .order("closed_on", { ascending: false })
                .order("project_number")
                .range(f, t)
            }
          />
        </TabsContent>

        <TabsContent value="collections" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Bucket value={bucket} onChange={setBucket} />
            <SelectBox
              value={purpose}
              onChange={setPurpose}
              allLabel="All payment types"
              ariaLabel="Payment type"
              options={[
                { value: "advance", label: "Advances" },
                { value: "partial", label: "Partial payments" },
                { value: "final", label: "Final payments" },
              ]}
            />
          </div>
          <SeriesTable
            range={range}
            bucket={bucket}
            cols={[
              { key: "collected", label: "Collected (net of refunds)" },
              { key: "advances", label: "of which advances" },
            ]}
            totals
          />
          <ListReport
            name="collections"
            csv="collections"
            deps={[...dep, purpose]}
            cols={[
              { key: "paid_at", label: "Date", kind: "date" },
              { key: "invoice_number", label: "Invoice" },
              { key: "company_name", label: "Client" },
              { key: "kind", label: "Kind", kind: "label" },
              { key: "purpose", label: "Type", kind: "label" },
              { key: "method", label: "Method", kind: "label" },
              { key: "transaction_reference", label: "Reference" },
              { key: "signed_amount", label: "Amount", kind: "money" },
            ]}
            fetcher={(f, t) => {
              let b = supabase
                .from("finance_collections")
                .select("*", { count: "exact" })
                .eq("status", "completed")
                .gte("paid_at", range.from)
                .lte("paid_at", range.to);
              if (purpose) b = b.eq("kind", "payment").eq("purpose", purpose);
              return b.order("paid_at", { ascending: false }).order("payment_id").range(f, t);
            }}
          />
        </TabsContent>

        <TabsContent value="outstanding" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <KpiCard
              label="Outstanding receivables"
              value={ov.data ? money(ov.data.outstanding_receivables) : "—"}
              hint="Unpaid balances, as of today (ignores the date range)"
              tone="warning"
            />
            <KpiCard
              label="Overdue"
              value={ov.data ? money(ov.data.overdue_payments) : "—"}
              hint="Part of outstanding that is past its due date"
              tone="danger"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
            />{" "}
            Overdue only
          </label>
          <ListReport
            name="outstanding"
            csv="outstanding-receivables"
            deps={[overdueOnly]}
            cols={[
              { key: "invoice_number", label: "Invoice" },
              { key: "company_name", label: "Client" },
              { key: "issue_date", label: "Issued", kind: "date" },
              { key: "due_date", label: "Due", kind: "date" },
              { key: "adjusted_total", label: "Amount", kind: "money" },
              { key: "received", label: "Received", kind: "money" },
              { key: "balance", label: "Balance", kind: "money" },
              { key: "status", label: "Status", kind: "status" },
            ]}
            fetcher={(f, t) => {
              let b = supabase
                .from("finance_invoice_ledger")
                .select("*", { count: "exact" })
                .in("status", ["issued", "partially_paid"]);
              if (overdueOnly) b = b.eq("is_overdue", true);
              return b.order("due_date").order("invoice_number").range(f, t);
            }}
          />
        </TabsContent>

        <TabsContent value="payroll" className="space-y-4">
          <Bucket value={bucket} onChange={setBucket} />
          <SeriesTable
            range={range}
            bucket={bucket}
            cols={[{ key: "salaries_paid", label: "Salaries paid" }]}
            totals
          />
          <ListReport
            name="payroll"
            csv="payroll"
            deps={dep}
            cols={[
              { key: "period_month", label: "Period", kind: "month" },
              { key: "employee_name", label: "Employee" },
              { key: "total_amount", label: "Total", kind: "money" },
              { key: "paid", label: "Paid", kind: "money" },
              { key: "balance", label: "Balance", kind: "money" },
              { key: "payment_status", label: "Status", kind: "status" },
            ]}
            fetcher={(f, t) =>
              supabase
                .from("salary_balances")
                .select("*", { count: "exact" })
                .neq("status", "cancelled")
                .gte("period_month", `${range.from.slice(0, 7)}-01`)
                .lte("period_month", range.to)
                .order("period_month", { ascending: false })
                .order("employee_name")
                .range(f, t)
            }
          />
        </TabsContent>

        <TabsContent value="expenses" className="space-y-4">
          <Bucket value={bucket} onChange={setBucket} />
          <SeriesTable
            range={range}
            bucket={bucket}
            cols={[{ key: "expenses_paid", label: "Expenses paid" }]}
            totals
          />
          <ListReport
            name="expenses"
            csv="expenses"
            deps={dep}
            cols={[
              { key: "expense_date", label: "Date", kind: "date" },
              { key: "description", label: "Description" },
              { key: "category", label: "Category", kind: "label" },
              { key: "amount", label: "Amount", kind: "money" },
              { key: "paid", label: "Paid", kind: "money" },
              { key: "balance", label: "Balance", kind: "money" },
              { key: "payment_status", label: "Status", kind: "status" },
            ]}
            fetcher={(f, t) =>
              supabase
                .from("expense_balances")
                .select("*", { count: "exact" })
                .gte("expense_date", range.from)
                .lte("expense_date", range.to)
                .order("expense_date", { ascending: false })
                .order("id")
                .range(f, t)
            }
          />
        </TabsContent>

        <TabsContent value="cashflow" className="space-y-4">
          <Bucket value={bucket} onChange={setBucket} />
          <SeriesTable
            range={range}
            bucket={bucket}
            totals
            cols={[
              { key: "collected", label: "Cash in (collected)" },
              { key: "expenses_paid", label: "Expenses paid" },
              { key: "salaries_paid", label: "Salaries paid" },
              { key: "net_cash_flow", label: "Net cash flow" },
            ]}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
