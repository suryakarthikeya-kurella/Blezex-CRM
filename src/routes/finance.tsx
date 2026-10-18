import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  StatusPill,
} from "@/components/crm/ui-bits";
import { RecordDialog } from "@/components/crm/record-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useClients } from "@/lib/api";
import { supabase, unwrap } from "@/lib/supabase";
import { date, money } from "@/lib/format";

export const Route = createFileRoute("/finance")({
  head: () => ({ meta: [{ title: "Invoices & payments — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <Page />
    </AppShell>
  ),
});
type B = {
  invoice_id: string;
  invoice_number: string;
  client_id: string;
  total: number;
  currency: string;
  status: string;
  due_date: string;
  received: number;
  balance: number;
  is_overdue: boolean;
};

function Page() {
  const qc = useQueryClient();
  const clients = useClients();
  const q = useQuery({
    queryKey: ["invoices"],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("invoice_balances")
          .select("*")
          .order("due_date", { ascending: false })
          .limit(300),
      ) as B[],
  });
  const [inv, setInv] = useState(false);
  const [pay, setPay] = useState<{ b: B; refund: boolean } | null>(null);
  const [rid, setRid] = useState(() => crypto.randomUUID());
  const done = (m: string) => {
    toast.success(m);
    void qc.invalidateQueries({ queryKey: ["invoices"] });
    void qc.invalidateQueries({ queryKey: ["report"] });
    setRid(crypto.randomUUID());
  };
  const err = (e: Error) => toast.error(e.message);
  const createInv = useMutation({
    mutationFn: async (v: Record<string, string>) =>
      unwrap(
        await supabase.from("invoices").insert({
          client_id: v["client_id"],
          total: Number(v["total"]),
          due_date: v["due_date"],
          status: v["status"] || "issued",
          notes: v["notes"] || null,
        }),
      ),
    onSuccess: () => {
      setInv(false);
      done("Invoice created");
    },
    onError: err,
  });
  const recordPay = useMutation({
    mutationFn: async (v: Record<string, string>) =>
      unwrap(
        await supabase.from("payments").insert({
          invoice_id: pay!.b.invoice_id,
          kind: pay!.refund ? "refund" : "payment",
          amount: Number(v["amount"]),
          method: v["method"] || "bank_transfer",
          transaction_reference: v["transaction_reference"] || null,
          request_id: rid,
        }),
      ),
    onSuccess: () => {
      setPay(null);
      done("Recorded");
    },
    onError: err,
  });
  const clientName = (id: string) => clients.data?.find((c) => c.id === id)?.company_name ?? "—";
  return (
    <>
      <PageHeader
        title="Invoices & payments"
        subtitle="Admin only · balances are calculated from completed payments and refunds"
        actions={
          <Button size="sm" onClick={() => setInv(true)}>
            New invoice
          </Button>
        }
      />
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState message="No invoices yet." />
      ) : (
        <div className="surface overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(q.data ?? []).map((b) => (
                <TableRow key={b.invoice_id}>
                  <TableCell className="font-medium">{b.invoice_number}</TableCell>
                  <TableCell>{clientName(b.client_id)}</TableCell>
                  <TableCell className={b.is_overdue ? "font-medium text-destructive" : ""}>
                    {date(b.due_date)}
                    {b.is_overdue ? " · overdue" : ""}
                  </TableCell>
                  <TableCell className="text-right">{money(b.total, b.currency)}</TableCell>
                  <TableCell className="text-right">{money(b.received, b.currency)}</TableCell>
                  <TableCell className="text-right">{money(b.balance, b.currency)}</TableCell>
                  <TableCell>
                    <StatusPill value={b.status} />
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    {["issued", "partially_paid"].includes(b.status) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPay({ b, refund: false })}
                      >
                        Record payment
                      </Button>
                    ) : null}
                    {b.received > 0 ? (
                      <Button size="sm" variant="ghost" onClick={() => setPay({ b, refund: true })}>
                        Refund
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
        open={inv}
        onOpenChange={setInv}
        title="New invoice"
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
          { name: "total", label: "Total (INR)", type: "number", required: true },
          { name: "due_date", type: "date", required: true },
          { name: "status", type: "select", options: ["draft", "issued"] },
          { name: "notes", type: "textarea" },
        ]}
        onSubmit={(v) => createInv.mutate(v)}
      />
      <RecordDialog
        open={!!pay}
        onOpenChange={(o) => !o && setPay(null)}
        title={`${pay?.refund ? "Refund" : "Payment"} — ${pay?.b.invoice_number ?? ""}`}
        description="Reference numbers only — never enter card details."
        submitting={recordPay.isPending}
        initial={{
          method: "bank_transfer",
          amount: pay && !pay.refund ? String(pay.b.balance) : "",
        }}
        fields={[
          { name: "amount", type: "number", required: true },
          {
            name: "method",
            type: "select",
            options: ["bank_transfer", "upi", "cash", "cheque", "gateway", "other"],
          },
          { name: "transaction_reference", label: "Transaction reference" },
        ]}
        onSubmit={(v) => recordPay.mutate(v)}
      />
    </>
  );
}
