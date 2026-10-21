import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ErrorBlock,
  KpiCard,
  LoadingBlock,
  PageHeader,
  SectionCard,
} from "@/components/crm/ui-bits";
import { RangeBar, type Range } from "@/components/finance/bits";
import { useOverview } from "@/lib/finance-api";
import { thisMonth, type ReportTab } from "@/lib/finance";
import { date, money } from "@/lib/format";

export const Route = createFileRoute("/finance/")({
  head: () => ({ meta: [{ title: "Finance overview — BlezeX Connect" }] }),
  component: Page,
});

function Page() {
  const [range, setRange] = useState<Range>(thisMonth);
  const q = useOverview(range.from, range.to);
  const o = q.data;
  const base = { from: range.from, to: range.to };
  // Each card opens the records behind it (reports page, same dates).
  const card = (
    label: string,
    value: number | undefined,
    hint: string,
    search: { tab: ReportTab; purpose?: "advance"; overdue?: boolean },
    tone?: "success" | "danger" | "warning" | "primary",
  ) => (
    <Link
      to="/finance/reports"
      search={{ ...base, ...search }}
      className="block rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-label={`${label}: open records`}
    >
      <KpiCard
        label={label}
        value={value == null ? "—" : money(value)}
        hint={hint}
        tone={tone ?? "default"}
      />
    </Link>
  );
  return (
    <>
      <PageHeader
        title="Finance overview"
        subtitle="Admin only · every figure is calculated from recorded invoices, payments, expenses and payroll"
        actions={<RangeBar value={range} onChange={setRange} />}
      />
      {q.isLoading ? (
        <LoadingBlock rows={6} />
      ) : q.isError || !o ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {card(
              "Total closed sales",
              o.total_closed_sales,
              "Deals closed in the period, each counted once",
              { tab: "sales" },
            )}
            {card(
              "Total collected",
              o.total_collected,
              "Payments received less refunds",
              { tab: "collections" },
              "success",
            )}
            {card("Advances received", o.advances_received, "Part of collected — not additional", {
              tab: "collections",
              purpose: "advance",
            })}
            {card(
              "Outstanding receivables",
              o.outstanding_receivables,
              `Unpaid invoice balances as of ${date(o.as_of)}`,
              { tab: "outstanding" },
              "warning",
            )}
            {card(
              "Overdue payments",
              o.overdue_payments,
              `Past due date as of ${date(o.as_of)}`,
              { tab: "outstanding", overdue: true },
              "danger",
            )}
            {card("Total expenses paid", o.total_expenses_paid, "Actual expense payments made", {
              tab: "expenses",
            })}
            {card("Salaries paid", o.salaries_paid, "Actual salary payments made", {
              tab: "payroll",
            })}
            {card(
              "Salaries payable",
              o.salaries_payable,
              `Approved, not yet paid, as of ${date(o.as_of)}`,
              { tab: "payroll" },
              "warning",
            )}
            {card(
              "Net cash flow",
              o.net_cash_flow,
              "Collected − expenses paid − salaries paid",
              { tab: "cashflow" },
              o.net_cash_flow < 0 ? "danger" : "success",
            )}
            <KpiCard
              label="Net profit"
              value="Not available"
              hint="Needs revenue-recognition and cost rules to be defined first"
            />
          </div>
          <SectionCard title="How these numbers relate">
            <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Closed deal value</dt>
                <dd className="font-medium">{money(o.total_closed_sales)}</dd>
                <dd className="text-xs text-muted-foreground">What clients agreed to buy</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Invoiced</dt>
                <dd className="font-medium">{money(o.invoiced)}</dd>
                <dd className="text-xs text-muted-foreground">
                  Billed in the period, after adjustments
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Collected cash</dt>
                <dd className="font-medium">{money(o.total_collected)}</dd>
                <dd className="text-xs text-muted-foreground">Money actually received</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Outstanding</dt>
                <dd className="font-medium">{money(o.outstanding_receivables)}</dd>
                <dd className="text-xs text-muted-foreground">Billed but not yet paid, today</dd>
              </div>
            </dl>
          </SectionCard>
        </div>
      )}
    </>
  );
}
