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
import { useDirectory } from "@/lib/api";
import { RecordDialog } from "@/components/crm/record-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { invalidateFinance } from "@/lib/finance-api";
import { PAYMENT_METHODS, parseMoney } from "@/lib/finance";
import { date, label, money } from "@/lib/format";
import { supabase, unwrap } from "@/lib/supabase";

export const Route = createFileRoute("/finance/payroll")({
  head: () => ({ meta: [{ title: "Salaries & payroll — BlezeX Connect" }] }),
  component: Page,
});

type S = {
  id: string;
  employee_id: string;
  employee_name: string;
  period_month: string;
  base_amount: number;
  incentive_amount: number;
  commission_amount: number;
  total_amount: number;
  status: string;
  paid: number;
  balance: number;
  payment_status: string;
  notes: string | null;
};
type Dlg = { kind: "new" | "edit" | "pay" | "history"; row?: S };

const monthNow = () => new Date().toISOString().slice(0, 7);
const amt = (v: string | undefined, allowZero = false) => {
  const n = parseMoney(v ?? "0", allowZero);
  if (n == null) throw new Error("Enter valid amounts (up to 2 decimals).");
  return n;
};

function Page() {
  const qc = useQueryClient();
  const dir = useDirectory();
  const [month, setMonth] = useState(monthNow);
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [rid, setRid] = useState(() => crypto.randomUUID());
  const q = useQuery({
    queryKey: ["finance", "payroll", month],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("salary_balances")
          .select("*")
          .eq("period_month", `${month}-01`)
          .order("employee_name"),
      ) as unknown as S[],
  });
  const rows = q.data ?? [];
  const live = rows.filter((r) => r.status === "approved");
  const sum = (f: (r: S) => number) => live.reduce((a, r) => a + f(r), 0);

  const done = (m: string) => {
    toast.success(m);
    invalidateFinance(qc);
    setRid(crypto.randomUUID());
    setDlg(null);
  };
  const err = (e: Error) => toast.error(e.message);

  const save = useMutation({
    mutationFn: async (v: Record<string, string>) => {
      const body = {
        base_amount: amt(v["base_amount"], true),
        incentive_amount: amt(v["incentive_amount"] || "0", true),
        commission_amount: amt(v["commission_amount"] || "0", true),
        notes: v["notes"] || null,
      };
      if (dlg?.kind === "edit")
        return unwrap(await supabase.from("salary_obligations").update(body).eq("id", dlg.row!.id));
      if (!v["employee_id"] || !v["period"]) throw new Error("Choose an employee and a period.");
      return unwrap(
        await supabase.from("salary_obligations").insert({
          ...body,
          employee_id: v["employee_id"],
          period_month: `${v["period"].slice(0, 7)}-01`,
        }),
      );
    },
    onSuccess: () => done("Salary record saved"),
    onError: err,
  });
  const setStatus = useMutation({
    mutationFn: async (a: { id: string; status: "approved" | "cancelled" }) =>
      unwrap(await supabase.from("salary_obligations").update({ status: a.status }).eq("id", a.id)),
    onSuccess: (_d, a) => done(a.status === "approved" ? "Approved" : "Cancelled"),
    onError: err,
  });
  const pay = useMutation({
    mutationFn: async (v: Record<string, string>) =>
      unwrap(
        await supabase.from("salary_payments").insert({
          obligation_id: dlg!.row!.id,
          amount: amt(v["amount"]),
          paid_on: v["paid_on"] || undefined,
          method: v["method"] || "bank_transfer",
          transaction_reference: v["transaction_reference"] || null,
          request_id: rid,
        }),
      ),
    onSuccess: () => done("Payment recorded"),
    onError: err,
  });

  const money3 = [
    {
      name: "base_amount",
      label: "Base salary (₹)",
      type: "number" as const,
      step: "0.01",
      required: true,
    },
    {
      name: "incentive_amount",
      label: "Approved incentives (₹)",
      type: "number" as const,
      step: "0.01",
    },
    {
      name: "commission_amount",
      label: "Approved commissions (₹)",
      type: "number" as const,
      step: "0.01",
    },
    { name: "notes", type: "textarea" as const },
  ];
  return (
    <>
      <PageHeader
        title="Salaries & payroll"
        subtitle="Admin only · amounts are fixed once approved; payments can be partial; mistakes are cancelled, never deleted"
        actions={
          <>
            <Input
              type="month"
              aria-label="Payroll month"
              className="w-44"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
            <Button size="sm" onClick={() => setDlg({ kind: "new" })}>
              Add salary record
            </Button>
          </>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Approved for this period"
          value={money(sum((r) => r.total_amount))}
          hint="Approved obligations only"
        />
        <KpiCard
          label="Paid against this period"
          value={money(sum((r) => r.paid))}
          tone="success"
        />
        <KpiCard
          label="Outstanding for this period"
          value={money(sum((r) => r.balance))}
          tone="warning"
        />
      </div>
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState message="No salary records for this month." />
      ) : (
        <div className="surface overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">Incentive</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className={r.status === "cancelled" ? "opacity-60" : ""}>
                  <TableCell className="font-medium">{r.employee_name || "Unnamed"}</TableCell>
                  <TableCell className="text-right">{money(r.base_amount)}</TableCell>
                  <TableCell className="text-right">{money(r.incentive_amount)}</TableCell>
                  <TableCell className="text-right">{money(r.commission_amount)}</TableCell>
                  <TableCell className="text-right font-medium">{money(r.total_amount)}</TableCell>
                  <TableCell className="text-right">{money(r.paid)}</TableCell>
                  <TableCell className="text-right">{money(r.balance)}</TableCell>
                  <TableCell>
                    <StatusPill value={r.payment_status} />
                  </TableCell>
                  <TableCell className="space-x-1 text-right whitespace-nowrap">
                    {r.status === "draft" ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDlg({ kind: "edit", row: r })}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={setStatus.isPending}
                          onClick={() => setStatus.mutate({ id: r.id, status: "approved" })}
                        >
                          Approve
                        </Button>
                      </>
                    ) : null}
                    {r.status === "approved" && r.balance > 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDlg({ kind: "pay", row: r })}
                      >
                        Record payment
                      </Button>
                    ) : null}
                    {r.status !== "cancelled" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDlg({ kind: "history", row: r })}
                      >
                        Payments
                      </Button>
                    ) : null}
                    {r.status !== "cancelled" && r.paid === 0 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={setStatus.isPending}
                        onClick={() =>
                          window.confirm("Cancel this salary record?") &&
                          setStatus.mutate({ id: r.id, status: "cancelled" })
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
        </div>
      )}
      <RecordDialog
        open={dlg?.kind === "new" || dlg?.kind === "edit"}
        onOpenChange={(o) => !o && setDlg(null)}
        title={dlg?.kind === "edit" ? `Edit — ${dlg.row?.employee_name}` : "Add salary record"}
        description="Saved as a draft. Approving locks the amounts."
        submitting={save.isPending}
        initial={
          dlg?.kind === "edit" && dlg.row
            ? {
                base_amount: String(dlg.row.base_amount),
                incentive_amount: String(dlg.row.incentive_amount),
                commission_amount: String(dlg.row.commission_amount),
                notes: dlg.row.notes ?? "",
              }
            : { period: `${month}-01`, incentive_amount: "0", commission_amount: "0" }
        }
        fields={
          dlg?.kind === "edit"
            ? money3
            : [
                {
                  name: "employee_id",
                  label: "Employee",
                  type: "select",
                  required: true,
                  options: (dir.data?.list ?? []).map((u) => ({
                    value: u.id,
                    label: `${u.full_name || "Unnamed"} (${label(u.role)})`,
                  })),
                },
                {
                  name: "period",
                  label: "Period (any date in the month)",
                  type: "date",
                  required: true,
                },
                ...money3,
              ]
        }
        onSubmit={(v) => save.mutate(v)}
      />
      <RecordDialog
        open={dlg?.kind === "pay"}
        onOpenChange={(o) => !o && setDlg(null)}
        title={`Pay ${dlg?.row?.employee_name ?? ""}`}
        description={
          dlg?.row ? `Balance due ${money(dlg.row.balance)}. Partial payments are allowed.` : ""
        }
        submitting={pay.isPending}
        initial={{
          amount: dlg?.row ? String(dlg.row.balance) : "",
          method: "bank_transfer",
          paid_on: new Date().toISOString().slice(0, 10),
        }}
        fields={[
          { name: "amount", label: "Amount (₹)", type: "number", step: "0.01", required: true },
          { name: "paid_on", label: "Date", type: "date", required: true },
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
function PaymentHistory({ row, onClose }: { row: S | null; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["finance", "salary-payments", row?.id],
    enabled: !!row,
    queryFn: async () =>
      unwrap(
        await supabase
          .from("salary_payments")
          .select("id,amount,paid_on,method,transaction_reference,status")
          .eq("obligation_id", row!.id)
          .order("paid_on", { ascending: false }),
      ) as unknown as P[],
  });
  const cancel = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await supabase.from("salary_payments").update({ status: "cancelled" }).eq("id", id)),
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
          <DialogTitle>{row?.employee_name} — salary payments</DialogTitle>
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
