import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  StatusPill,
} from "@/components/crm/ui-bits";
import { Pager } from "@/components/crm/controls";
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
import { date, label, money, safeSearch } from "@/lib/format";
import { supabase, unwrap } from "@/lib/supabase";

export const Route = createFileRoute("/finance/accounts")({
  head: () => ({ meta: [{ title: "Client accounts — BlezeX Connect" }] }),
  component: Page,
});

const PAGE = 25;
type Account = {
  project_id: string;
  project_number: string;
  project_name: string;
  client_id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  service_name: string | null;
  sales_user_name: string | null;
  list_price: number | null;
  discount_percent: number;
  agreed_value: number;
  invoiced: number;
  advance_paid: number;
  subsequent_paid: number;
  total_collected: number;
  contract_balance: number;
  invoice_outstanding: number;
  next_due: string | null;
  closed_on: string;
};

function Page() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Account | null>(null);
  const term = safeSearch(search);
  const q = useQuery({
    queryKey: ["finance", "accounts", term, page],
    queryFn: async () => {
      let b = supabase.from("client_accounts").select("*", { count: "exact" });
      if (term)
        b = b.or(
          `company_name.ilike.%${term}%,project_number.ilike.%${term}%,project_name.ilike.%${term}%`,
        );
      const res = await b
        .order("closed_on", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      return {
        rows: unwrap({ data: res.data, error: res.error }) as unknown as Account[],
        count: res.count ?? 0,
      };
    },
  });
  return (
    <>
      <PageHeader
        title="Client accounts"
        subtitle="One row per deal · contract balance = agreed amount − net collected · invoice outstanding = billed but unpaid"
      />
      <Input
        className="mb-4 max-w-xs"
        placeholder="Search client, deal or number"
        aria-label="Search client accounts"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
      />
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : (q.data?.rows ?? []).length === 0 ? (
        <EmptyState message="No client deals found." />
      ) : (
        <>
          <div className="surface overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Deal</TableHead>
                  <TableHead>Sales employee</TableHead>
                  <TableHead className="text-right">Agreed</TableHead>
                  <TableHead className="text-right">Invoiced</TableHead>
                  <TableHead className="text-right">Advance</TableHead>
                  <TableHead className="text-right">Later payments</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead className="text-right">Contract balance</TableHead>
                  <TableHead className="text-right">Invoice outstanding</TableHead>
                  <TableHead>Next due</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data!.rows.map((a) => (
                  <TableRow key={a.project_id}>
                    <TableCell>
                      <div className="font-medium">{a.company_name}</div>
                      <div className="text-xs text-muted-foreground">{a.contact_name ?? ""}</div>
                    </TableCell>
                    <TableCell>
                      <div>{a.project_number}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.service_name ?? a.project_name}
                      </div>
                    </TableCell>
                    <TableCell>{a.sales_user_name ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {money(a.agreed_value)}
                      {a.list_price != null && a.discount_percent > 0 ? (
                        <div className="text-xs text-muted-foreground">
                          list {money(a.list_price)} · {a.discount_percent}% off
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">{money(a.invoiced)}</TableCell>
                    <TableCell className="text-right">{money(a.advance_paid)}</TableCell>
                    <TableCell className="text-right">{money(a.subsequent_paid)}</TableCell>
                    <TableCell className="text-right">{money(a.total_collected)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {money(a.contract_balance)}
                    </TableCell>
                    <TableCell className="text-right">{money(a.invoice_outstanding)}</TableCell>
                    <TableCell>{date(a.next_due)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setOpen(a)}>
                        History
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={page} total={q.data!.count} pageSize={PAGE} onPage={setPage} />
        </>
      )}
      <History account={open} onClose={() => setOpen(null)} />
    </>
  );
}

type Inv = {
  invoice_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  adjusted_total: number;
  received: number;
  balance: number;
  status: string;
  is_overdue: boolean;
};
type Pay = {
  payment_id: string;
  invoice_number: string;
  kind: string;
  purpose: string;
  amount: number;
  paid_at: string;
  method: string;
  transaction_reference: string | null;
  status: string;
};

function History({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const id = account?.project_id;
  const q = useQuery({
    queryKey: ["finance", "account-history", id],
    enabled: !!id,
    queryFn: async () => {
      const [inv, pay] = await Promise.all([
        supabase.from("finance_invoice_ledger").select("*").eq("deal_id", id!).order("due_date"),
        supabase
          .from("finance_collections")
          .select("*")
          .eq("deal_id", id!)
          .order("paid_at", { ascending: false }),
      ]);
      return {
        invoices: unwrap(inv) as unknown as Inv[],
        payments: unwrap(pay) as unknown as Pay[],
      };
    },
  });
  return (
    <Dialog open={!!account} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {account?.company_name} · {account?.project_number}
          </DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <LoadingBlock />
        ) : q.isError ? (
          <ErrorBlock error={q.error} />
        ) : (
          <div className="space-y-6">
            <section>
              <h3 className="mb-2 text-sm font-semibold">Invoices & due dates</h3>
              {q.data!.invoices.length === 0 ? (
                <EmptyState message="No invoices for this deal yet." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {q.data!.invoices.map((i) => (
                      <TableRow key={i.invoice_id}>
                        <TableCell>{i.invoice_number}</TableCell>
                        <TableCell className={i.is_overdue ? "font-medium text-destructive" : ""}>
                          {date(i.due_date)}
                        </TableCell>
                        <TableCell className="text-right">{money(i.adjusted_total)}</TableCell>
                        <TableCell className="text-right">{money(i.received)}</TableCell>
                        <TableCell className="text-right">{money(i.balance)}</TableCell>
                        <TableCell>
                          <StatusPill value={i.is_overdue ? "overdue" : i.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold">Payment history</h3>
              {q.data!.payments.length === 0 ? (
                <EmptyState message="No payments recorded." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {q.data!.payments.map((p) => (
                      <TableRow key={p.payment_id}>
                        <TableCell>{date(p.paid_at)}</TableCell>
                        <TableCell>{p.invoice_number}</TableCell>
                        <TableCell>{p.kind === "refund" ? "Refund" : label(p.purpose)}</TableCell>
                        <TableCell>{label(p.method)}</TableCell>
                        <TableCell>{p.transaction_reference ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          {p.kind === "refund" ? `− ${money(p.amount)}` : money(p.amount)}
                        </TableCell>
                        <TableCell>
                          <StatusPill value={p.status} />
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
