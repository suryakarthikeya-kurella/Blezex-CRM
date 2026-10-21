import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  StatusPill,
} from "@/components/crm/ui-bits";
import { Pager, SelectBox } from "@/components/crm/controls";
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
import { useClients } from "@/lib/api";
import { frpc, invalidateFinance } from "@/lib/finance-api";
import { PAYMENT_METHODS, PAYMENT_PURPOSES, parseMoney } from "@/lib/finance";
import { date, label, money, safeSearch } from "@/lib/format";
import { printDocument } from "@/lib/print";
import { supabase, unwrap } from "@/lib/supabase";

export const Route = createFileRoute("/finance/invoices")({
  head: () => ({ meta: [{ title: "Invoices & payments — BlezeX Connect" }] }),
  component: Page,
});

const PAGE = 25;
type L = {
  invoice_id: string;
  invoice_number: string;
  client_id: string;
  company_name: string;
  total: number;
  adjustment: number;
  adjusted_total: number;
  currency: string;
  status: string;
  issue_date: string;
  due_date: string;
  received: number;
  balance: number;
  is_overdue: boolean;
};
type Deal = {
  project_id: string;
  project_number: string;
  project_name: string;
  client_id: string;
  company_name: string;
};
type Dlg = { kind: "payment" | "refund" | "adjust" | "history"; inv: L };

function Page() {
  const qc = useQueryClient();
  const clients = useClients();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [newInv, setNewInv] = useState(false);
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [rid, setRid] = useState(() => crypto.randomUUID());
  const term = safeSearch(search);

  const q = useQuery({
    queryKey: ["invoices", term, status, page],
    queryFn: async () => {
      let b = supabase.from("finance_invoice_ledger").select("*", { count: "exact" });
      if (term) b = b.or(`invoice_number.ilike.%${term}%,company_name.ilike.%${term}%`);
      if (status === "overdue") b = b.eq("is_overdue", true);
      else if (status) b = b.eq("status", status);
      const res = await b
        .order("due_date", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      return {
        rows: unwrap({ data: res.data, error: res.error }) as unknown as L[],
        count: res.count ?? 0,
      };
    },
  });
  const deals = useQuery({
    queryKey: ["finance", "deal-options"],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("finance_deals")
          .select("project_id,project_number,project_name,client_id,company_name")
          .order("closed_on", { ascending: false })
          .limit(500),
      ) as unknown as Deal[],
  });

  const done = (m: string) => {
    toast.success(m);
    invalidateFinance(qc);
    setRid(crypto.randomUUID());
  };
  const err = (e: Error) => toast.error(e.message);
  const needAmount = (v: string | undefined) => {
    const n = parseMoney(v ?? "");
    if (n == null) throw new Error("Enter a valid amount (up to 2 decimals).");
    return n;
  };

  const createInv = useMutation({
    mutationFn: async (v: Record<string, string>) => {
      const deal = deals.data?.find((d) => d.project_id === v["project_id"]);
      if (deal && deal.client_id !== v["client_id"])
        throw new Error("That deal belongs to a different client.");
      return unwrap(
        await supabase.from("invoices").insert({
          client_id: v["client_id"],
          project_id: v["project_id"] || null,
          total: needAmount(v["total"]),
          due_date: v["due_date"],
          status: v["status"] || "issued",
          notes: v["notes"] || null,
        }),
      );
    },
    onSuccess: () => {
      setNewInv(false);
      done("Invoice created");
    },
    onError: err,
  });
  const recordPay = useMutation({
    mutationFn: async (v: Record<string, string>) =>
      unwrap(
        await supabase.from("payments").insert({
          invoice_id: dlg!.inv.invoice_id,
          kind: dlg!.kind === "refund" ? "refund" : "payment",
          amount: needAmount(v["amount"]),
          purpose: dlg!.kind === "refund" ? "partial" : v["purpose"] || "partial",
          method: v["method"] || "bank_transfer",
          paid_at: v["paid_at"] || undefined,
          transaction_reference: v["transaction_reference"] || null,
          request_id: rid,
        }),
      ),
    onSuccess: () => {
      setDlg(null);
      done("Recorded");
    },
    onError: err,
  });
  const adjust = useMutation({
    mutationFn: async (v: Record<string, string>) =>
      unwrap(
        await supabase.from("invoice_adjustments").insert({
          invoice_id: dlg!.inv.invoice_id,
          kind: v["kind"] || "credit",
          amount: needAmount(v["amount"]),
          reason: v["reason"] ?? "",
          request_id: rid,
        }),
      ),
    onSuccess: () => {
      setDlg(null);
      done("Adjustment recorded");
    },
    onError: err,
  });

  const rows = q.data?.rows ?? [];
  return (
    <>
      <PageHeader
        title="Invoices & payments"
        subtitle="Admin only · balances come from completed payments, refunds and approved adjustments"
        actions={
          <Button size="sm" onClick={() => setNewInv(true)}>
            New invoice
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search invoice or client"
          aria-label="Search invoices"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <SelectBox
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(0);
          }}
          allLabel="All statuses"
          options={["draft", "issued", "partially_paid", "paid", "cancelled", "overdue"].map(
            (s) => ({ value: s, label: label(s) }),
          )}
        />
      </div>
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState message="No invoices found." />
      ) : (
        <>
          <div className="surface overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => (
                  <TableRow key={b.invoice_id}>
                    <TableCell className="font-medium">{b.invoice_number}</TableCell>
                    <TableCell>{b.company_name}</TableCell>
                    <TableCell className={b.is_overdue ? "font-medium text-destructive" : ""}>
                      {date(b.due_date)}
                      {b.is_overdue ? " · overdue" : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      {money(b.adjusted_total, b.currency)}
                      {b.adjustment !== 0 ? (
                        <div className="text-xs text-muted-foreground">
                          {money(b.total, b.currency)} {b.adjustment > 0 ? "+" : "−"}{" "}
                          {money(Math.abs(b.adjustment), b.currency)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">{money(b.received, b.currency)}</TableCell>
                    <TableCell className="text-right">{money(b.balance, b.currency)}</TableCell>
                    <TableCell>
                      <StatusPill value={b.status} />
                    </TableCell>
                    <TableCell className="space-x-1 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDlg({ kind: "history", inv: b })}
                      >
                        History
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          printDocument({
                            title: `Invoice ${b.invoice_number}`,
                            rows: [
                              ["Client", b.company_name],
                              ["Status", b.status.replace(/_/g, " ")],
                              ["Due date", date(b.due_date)],
                              ["Amount", money(b.adjusted_total, b.currency)],
                              ["Received", money(b.received, b.currency)],
                              ["Balance due", money(b.balance, b.currency)],
                            ],
                            footer: `Generated ${new Date().toLocaleString("en-IN")}`,
                          }) || toast.error("Allow pop-ups to print.")
                        }
                      >
                        Print / PDF
                      </Button>
                      {["issued", "partially_paid"].includes(b.status) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDlg({ kind: "payment", inv: b })}
                        >
                          Record payment
                        </Button>
                      ) : null}
                      {["issued", "partially_paid", "paid"].includes(b.status) ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDlg({ kind: "adjust", inv: b })}
                        >
                          Adjust
                        </Button>
                      ) : null}
                      {b.received > 0 ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDlg({ kind: "refund", inv: b })}
                        >
                          Refund
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
        open={newInv}
        onOpenChange={setNewInv}
        title="New invoice"
        description="Link it to a deal so collections count towards that deal and its sales employee."
        submitting={createInv.isPending}
        initial={{ status: "issued" }}
        fields={[
          {
            name: "client_id",
            label: "Client",
            type: "select",
            required: true,
            options: (clients.data ?? []).map((c) => ({ value: c.id, label: c.company_name })),
          },
          {
            name: "project_id",
            label: "Deal (optional)",
            type: "select",
            options: (deals.data ?? []).map((d) => ({
              value: d.project_id,
              label: `${d.company_name} — ${d.project_number} ${d.project_name}`,
            })),
          },
          { name: "total", label: "Amount (₹)", type: "number", step: "0.01", required: true },
          { name: "due_date", type: "date", required: true },
          { name: "status", type: "select", options: ["draft", "issued"] },
          { name: "notes", type: "textarea" },
        ]}
        onSubmit={(v) => createInv.mutate(v)}
      />
      <RecordDialog
        open={dlg?.kind === "payment" || dlg?.kind === "refund"}
        onOpenChange={(o) => !o && setDlg(null)}
        title={`${dlg?.kind === "refund" ? "Refund" : "Payment"} — ${dlg?.inv.invoice_number ?? ""}`}
        description="Reference numbers only — never enter card details."
        submitting={recordPay.isPending}
        initial={{
          method: "bank_transfer",
          purpose: "partial",
          paid_at: new Date().toISOString().slice(0, 10),
          amount: dlg && dlg.kind === "payment" ? String(dlg.inv.balance) : "",
        }}
        fields={[
          { name: "amount", label: "Amount (₹)", type: "number", step: "0.01", required: true },
          ...(dlg?.kind === "payment"
            ? [
                {
                  name: "purpose",
                  label: "Payment type",
                  type: "select" as const,
                  options: PAYMENT_PURPOSES,
                },
              ]
            : []),
          { name: "paid_at", label: "Date", type: "date", required: true },
          { name: "method", type: "select", options: PAYMENT_METHODS },
          { name: "transaction_reference", label: "Transaction reference" },
        ]}
        onSubmit={(v) => recordPay.mutate(v)}
      />
      <RecordDialog
        open={dlg?.kind === "adjust"}
        onOpenChange={(o) => !o && setDlg(null)}
        title={`Adjust ${dlg?.inv.invoice_number ?? ""}`}
        description="Adjustments are permanent entries. Mistakes are fixed by reversing, never by editing."
        submitting={adjust.isPending}
        initial={{ kind: "credit" }}
        fields={[
          {
            name: "kind",
            label: "Type",
            type: "select",
            options: [
              { value: "credit", label: "Credit (reduces the amount due)" },
              { value: "debit", label: "Debit (increases the amount due)" },
            ],
          },
          { name: "amount", label: "Amount (₹)", type: "number", step: "0.01", required: true },
          { name: "reason", type: "textarea", required: true },
        ]}
        onSubmit={(v) => adjust.mutate(v)}
      />
      <History dlg={dlg?.kind === "history" ? dlg : null} onClose={() => setDlg(null)} />
    </>
  );
}

type Pay = {
  id: string;
  kind: string;
  purpose: string;
  amount: number;
  paid_at: string;
  method: string;
  transaction_reference: string | null;
  status: string;
};
type Adj = {
  id: string;
  kind: string;
  amount: number;
  reason: string;
  reverses_id: string | null;
  created_at: string;
};

function History({ dlg, onClose }: { dlg: Dlg | null; onClose: () => void }) {
  const qc = useQueryClient();
  const id = dlg?.inv.invoice_id;
  const q = useQuery({
    queryKey: ["invoices", "history", id],
    enabled: !!id,
    queryFn: async () => {
      const [p, a] = await Promise.all([
        supabase
          .from("payments")
          .select("id,kind,purpose,amount,paid_at,method,transaction_reference,status")
          .eq("invoice_id", id!)
          .order("paid_at", { ascending: false }),
        supabase
          .from("invoice_adjustments")
          .select("id,kind,amount,reason,reverses_id,created_at")
          .eq("invoice_id", id!)
          .order("created_at", { ascending: false }),
      ]);
      return {
        payments: unwrap(p) as unknown as Pay[],
        adjustments: unwrap(a) as unknown as Adj[],
      };
    },
  });
  const cancel = useMutation({
    mutationFn: async (pid: string) =>
      unwrap(await supabase.from("payments").update({ status: "cancelled" }).eq("id", pid)),
    onSuccess: () => {
      toast.success("Payment cancelled — history kept");
      invalidateFinance(qc);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reverse = useMutation({
    mutationFn: async (a: Adj) => {
      const reason = window.prompt("Reason for reversing this adjustment?")?.trim();
      if (!reason) throw new Error("A reason is required.");
      return frpc<string>("reverse_invoice_adjustment", { p_adjustment: a.id, p_reason: reason });
    },
    onSuccess: () => {
      toast.success("Adjustment reversed");
      invalidateFinance(qc);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reversed = new Set((q.data?.adjustments ?? []).map((a) => a.reverses_id).filter(Boolean));
  return (
    <Dialog open={!!dlg} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{dlg?.inv.invoice_number} — payments & adjustments</DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <LoadingBlock />
        ) : q.isError ? (
          <ErrorBlock error={q.error} />
        ) : (
          <div className="space-y-6">
            <section>
              <h3 className="mb-2 text-sm font-semibold">Payments</h3>
              {q.data!.payments.length === 0 ? (
                <EmptyState message="No payments." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Method / reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {q.data!.payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{date(p.paid_at)}</TableCell>
                        <TableCell>{p.kind === "refund" ? "Refund" : label(p.purpose)}</TableCell>
                        <TableCell>
                          {label(p.method)}
                          {p.transaction_reference ? ` · ${p.transaction_reference}` : ""}
                        </TableCell>
                        <TableCell className="text-right">
                          {p.kind === "refund" ? `− ${money(p.amount)}` : money(p.amount)}
                        </TableCell>
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
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold">Adjustments (permanent)</h3>
              {q.data!.adjustments.length === 0 ? (
                <EmptyState message="No adjustments." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {q.data!.adjustments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>{date(a.created_at)}</TableCell>
                        <TableCell>
                          {label(a.kind)}
                          {a.reverses_id ? " (reversal)" : reversed.has(a.id) ? " (reversed)" : ""}
                        </TableCell>
                        <TableCell className="max-w-xs">{a.reason}</TableCell>
                        <TableCell className="text-right">
                          {a.kind === "credit" ? `− ${money(a.amount)}` : money(a.amount)}
                        </TableCell>
                        <TableCell className="text-right">
                          {!a.reverses_id && !reversed.has(a.id) ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={reverse.isPending}
                              onClick={() => reverse.mutate(a)}
                            >
                              Reverse
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
