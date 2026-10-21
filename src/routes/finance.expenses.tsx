import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  EmptyState,
  ErrorBlock,
  KpiCard,
  LoadingBlock,
  PageHeader,
  StatusPill,
} from "@/components/crm/ui-bits";
import { Pager, SelectBox } from "@/components/crm/controls";
import { RecordDialog } from "@/components/crm/record-dialog";
import { RangeBar, type Range } from "@/components/finance/bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { invalidateFinance } from "@/lib/finance-api";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, parseMoney, thisMonth } from "@/lib/finance";
import { date, label, money } from "@/lib/format";
import { supabase, unwrap } from "@/lib/supabase";

export const Route = createFileRoute("/finance/expenses")({
  head: () => ({ meta: [{ title: "Company expenses — BlezeX Connect" }] }),
  component: Page,
});

const PAGE = 25;
const CAT = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.value, c.label]));
type E = {
  id: string;
  description: string;
  category: string;
  amount: number;
  expense_date: string;
  notes: string | null;
  paid: number;
  balance: number;
  payment_status: string;
  last_paid_on: string | null;
};
type Dlg = { kind: "new" | "edit" | "pay" | "history"; row?: E };

function Page() {
  const qc = useQueryClient();
  const [range, setRange] = useState<Range>(thisMonth);
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(0);
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [rid, setRid] = useState(() => crypto.randomUUID());
  const q = useQuery({
    queryKey: ["finance", "expenses", range.from, range.to, category, page],
    queryFn: async () => {
      let b = supabase
        .from("expense_balances")
        .select("*", { count: "exact" })
        .gte("expense_date", range.from)
        .lte("expense_date", range.to);
      if (category) b = b.eq("category", category);
      const res = await b
        .order("expense_date", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      return {
        rows: unwrap({ data: res.data, error: res.error }) as unknown as E[],
        count: res.count ?? 0,
      };
    },
  });
  const sums = useQuery({
    queryKey: ["finance", "expenses-sum", range.from, range.to, category],
    queryFn: async () => {
      let b = supabase
        .from("expense_balances")
        .select("amount,paid,balance")
        .gte("expense_date", range.from)
        .lte("expense_date", range.to)
        .limit(5000);
      if (category) b = b.eq("category", category);
      const rows = unwrap(await b) as unknown as {
        amount: number;
        paid: number;
        balance: number;
      }[];
      return rows.reduce(
        (a, r) => ({
          amount: a.amount + r.amount,
          paid: a.paid + r.paid,
          balance: a.balance + r.balance,
        }),
        { amount: 0, paid: 0, balance: 0 },
      );
    },
  });

  const done = (m: string) => {
    toast.success(m);
    invalidateFinance(qc);
    setRid(crypto.randomUUID());
    setDlg(null);
  };
  const err = (e: Error) => toast.error(e.message);
  const amount = (v: string | undefined) => {
    const n = parseMoney(v ?? "");
    if (n == null) throw new Error("Enter a valid amount (up to 2 decimals).");
    return n;
  };
  const save = useMutation({
    mutationFn: async (v: Record<string, string>) => {
      const body = {
        description: v["description"] ?? "",
        category: v["category"] ?? "",
        amount: amount(v["amount"]),
        expense_date: v["expense_date"] || undefined,
        notes: v["notes"] || null,
      };
      return dlg?.kind === "edit"
        ? unwrap(await supabase.from("expenses").update(body).eq("id", dlg.row!.id))
        : unwrap(await supabase.from("expenses").insert(body));
    },
    onSuccess: () => done("Expense saved"),
    onError: err,
  });
  const pay = useMutation({
    mutationFn: async (v: Record<string, string>) =>
      unwrap(
        await supabase.from("expense_payments").insert({
          expense_id: dlg!.row!.id,
          amount: amount(v["amount"]),
          paid_on: v["paid_on"] || undefined,
          method: v["method"] || "bank_transfer",
          transaction_reference: v["transaction_reference"] || null,
          request_id: rid,
        }),
      ),
    onSuccess: () => done("Payment recorded"),
    onError: err,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from("expenses").delete().eq("id", id)),
    onSuccess: () => done("Expense deleted"),
    onError: err,
  });

  const rows = q.data?.rows ?? [];
  return (
    <>
      <PageHeader
        title="Company expenses"
        subtitle="Admin only · only actual payments count as money spent"
        actions={
          <Button size="sm" onClick={() => setDlg({ kind: "new" })}>
            Add expense
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <RangeBar
          value={range}
          onChange={(r) => {
            setRange(r);
            setPage(0);
          }}
        />
        <SelectBox
          value={category}
          onChange={(v) => {
            setCategory(v);
            setPage(0);
          }}
          allLabel="All categories"
          options={EXPENSE_CATEGORIES}
        />
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Recorded"
          value={sums.data ? money(sums.data.amount) : "—"}
          hint="Expenses dated in this range"
        />
        <KpiCard
          label="Paid against them"
          value={sums.data ? money(sums.data.paid) : "—"}
          tone="success"
        />
        <KpiCard
          label="Still unpaid"
          value={sums.data ? money(sums.data.balance) : "—"}
          tone="warning"
        />
      </div>
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState message="No expenses in this range." />
      ) : (
        <>
          <div className="surface overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Paid on</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{date(r.expense_date)}</TableCell>
                    <TableCell className="font-medium">{r.description}</TableCell>
                    <TableCell>{CAT[r.category] ?? label(r.category)}</TableCell>
                    <TableCell className="text-right">{money(r.amount)}</TableCell>
                    <TableCell className="text-right">{money(r.paid)}</TableCell>
                    <TableCell className="text-right">{money(r.balance)}</TableCell>
                    <TableCell>
                      <StatusPill value={r.payment_status} />
                    </TableCell>
                    <TableCell>{date(r.last_paid_on)}</TableCell>
                    <TableCell className="space-x-1 text-right whitespace-nowrap">
                      {r.balance > 0 ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDlg({ kind: "pay", row: r })}
                        >
                          Record payment
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDlg({ kind: "history", row: r })}
                      >
                        Payments
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDlg({ kind: "edit", row: r })}
                      >
                        Edit
                      </Button>
                      {r.paid === 0 ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() =>
                            window.confirm("Delete this unpaid expense?") && remove.mutate(r.id)
                          }
                        >
                          Delete
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={page} total={q.data?.count ?? 0} pageSize={PAGE} onPage={setPage} />
        </>
      )}
      <RecordDialog
        open={dlg?.kind === "new" || dlg?.kind === "edit"}
        onOpenChange={(o) => !o && setDlg(null)}
        title={dlg?.kind === "edit" ? "Edit expense" : "Add expense"}
        submitting={save.isPending}
        initial={
          dlg?.kind === "edit" && dlg.row
            ? {
                description: dlg.row.description,
                category: dlg.row.category,
                amount: String(dlg.row.amount),
                expense_date: dlg.row.expense_date,
                notes: dlg.row.notes ?? "",
              }
            : { expense_date: new Date().toISOString().slice(0, 10) }
        }
        fields={[
          { name: "description", required: true, full: true },
          { name: "category", type: "select", required: true, options: EXPENSE_CATEGORIES },
          { name: "amount", label: "Amount (₹)", type: "number", step: "0.01", required: true },
          { name: "expense_date", label: "Expense date", type: "date", required: true },
          { name: "notes", type: "textarea" },
        ]}
        onSubmit={(v) => save.mutate(v)}
      />
      <RecordDialog
        open={dlg?.kind === "pay"}
        onOpenChange={(o) => !o && setDlg(null)}
        title={`Pay — ${dlg?.row?.description ?? ""}`}
        description={dlg?.row ? `Balance ${money(dlg.row.balance)}` : ""}
        submitting={pay.isPending}
        initial={{
          amount: dlg?.row ? String(dlg.row.balance) : "",
          method: "bank_transfer",
          paid_on: new Date().toISOString().slice(0, 10),
        }}
        fields={[
          { name: "amount", label: "Amount (₹)", type: "number", step: "0.01", required: true },
          { name: "paid_on", label: "Payment date", type: "date", required: true },
          { name: "method", type: "select", options: PAYMENT_METHODS },
          { name: "transaction_reference", label: "Transaction reference" },
        ]}
        onSubmit={(v) => pay.mutate(v)}
      />
      <PaymentHistory
        row={dlg?.kind === "history" ? (dlg.row ?? null) : null}
        onClose={() => setDlg(null)}
      />
    </>
  );
}

type P = {
  id: string;
  amount: number;
  paid_on: string;
  method: string;
  transaction_reference: string | null;
  status: string;
};
function PaymentHistory({ row, onClose }: { row: E | null; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["finance", "expense-payments", row?.id],
    enabled: !!row,
    queryFn: async () =>
      unwrap(
        await supabase
          .from("expense_payments")
          .select("id,amount,paid_on,method,transaction_reference,status")
          .eq("expense_id", row!.id)
          .order("paid_on", { ascending: false }),
      ) as unknown as P[],
  });
  const cancel = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await supabase.from("expense_payments").update({ status: "cancelled" }).eq("id", id)),
    onSuccess: () => {
      toast.success("Payment cancelled — history kept");
      invalidateFinance(qc);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row?.description} — payments</DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <LoadingBlock />
        ) : q.isError ? (
          <ErrorBlock error={q.error} />
        ) : (q.data ?? []).length === 0 ? (
          <EmptyState message="No payments yet." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Method / reference</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data!.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{date(p.paid_on)}</TableCell>
                  <TableCell>
                    {label(p.method)}
                    {p.transaction_reference ? ` · ${p.transaction_reference}` : ""}
                  </TableCell>
                  <TableCell className="text-right">{money(p.amount)}</TableCell>
                  <TableCell>
                    <StatusPill value={p.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {p.status === "completed" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={cancel.isPending}
                        onClick={() =>
                          window.confirm(
                            "Cancel this payment? It stays in the history but no longer counts.",
                          ) && cancel.mutate(p.id)
                        }
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
