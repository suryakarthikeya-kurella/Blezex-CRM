import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/crm/ui-bits";
import { thisMonth } from "@/lib/finance";
import { RangeBar, type Range } from "@/components/finance/bits";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { frpc } from "@/lib/finance-api";
import { money, num } from "@/lib/format";

export const Route = createFileRoute("/finance/sales")({
  head: () => ({ meta: [{ title: "Employee sales — BlezeX Connect" }] }),
  component: Page,
});

type Row = {
  user_id: string | null;
  full_name: string;
  deals_closed: number;
  closed_value: number;
  collected: number;
  outstanding: number;
};

function Page() {
  const [range, setRange] = useState<Range>(thisMonth);
  const q = useQuery({
    queryKey: ["finance", "employee-sales", range.from, range.to],
    queryFn: () => frpc<Row[]>("finance_employee_sales", { p_from: range.from, p_to: range.to }),
  });
  const rows = q.data ?? [];
  const sum = (k: "deals_closed" | "closed_value" | "collected" | "outstanding") =>
    rows.reduce((a, r) => a + r[k], 0);
  return (
    <>
      <PageHeader
        title="Employee sales"
        subtitle="Admin only · deals counted once · sales owner = lead owner, else the client's relationship owner"
        actions={<RangeBar value={range} onChange={setRange} />}
      />
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState message="No sales activity in this period." />
      ) : (
        <>
          <div className="surface overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Deals closed</TableHead>
                  <TableHead className="text-right">Closed deal value</TableHead>
                  <TableHead className="text-right">Collected (period)</TableHead>
                  <TableHead className="text-right">Outstanding (today)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.user_id ?? "none"}>
                    <TableCell
                      className={r.user_id ? "font-medium" : "text-muted-foreground italic"}
                    >
                      {r.full_name}
                    </TableCell>
                    <TableCell className="text-right">{num(r.deals_closed)}</TableCell>
                    <TableCell className="text-right">{money(r.closed_value)}</TableCell>
                    <TableCell className="text-right">{money(r.collected)}</TableCell>
                    <TableCell className="text-right">{money(r.outstanding)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-medium">Company total</TableCell>
                  <TableCell className="text-right font-medium">
                    {num(sum("deals_closed"))}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {money(sum("closed_value"))}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {money(sum("collected"))}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {money(sum("outstanding"))}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Collections follow the invoice&apos;s deal (or the client&apos;s only deal). Payments on
            invoices that cannot be tied to one deal appear under &ldquo;Unattributed&rdquo; instead
            of being guessed.
          </p>
        </>
      )}
    </>
  );
}
