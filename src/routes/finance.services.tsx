import { useMemo, useState } from "react";
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
import { RecordDialog } from "@/components/crm/record-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { invalidateFinance } from "@/lib/finance-api";
import { netPrice, parseMoney } from "@/lib/finance";
import { money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { supabase, unwrap } from "@/lib/supabase";

export const Route = createFileRoute("/finance/services")({
  head: () => ({ meta: [{ title: "Services & pricing — BlezeX Connect" }] }),
  component: Page,
});

type Service = {
  id: string;
  name: string;
  description: string | null;
  standard_price: number;
  discount_percent: number;
  is_active: boolean;
};

function Page() {
  const { role } = useAuth();
  const manage = can(role, "services.manage"); // UI only — RLS is what actually blocks non-admin writes
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<Service | "new" | null>(null);
  const q = useQuery({
    queryKey: ["services", "catalogue"],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("services")
          .select("id,name,description,standard_price,discount_percent,is_active")
          .order("position")
          .order("name"),
      ) as Service[],
  });
  const rows = useMemo(
    () =>
      (q.data ?? [])
        .filter((s) => manage || s.is_active) // others see what is on offer
        .filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase())),
    [q.data, manage, search],
  );
  const save = useMutation({
    mutationFn: async (v: Record<string, string>) => {
      const price = parseMoney(v["standard_price"] ?? "", true);
      const disc = Number(v["discount_percent"] || "0");
      if (!v["name"]?.trim()) throw new Error("Name is required.");
      if (price == null) throw new Error("Enter a valid price (up to 2 decimals).");
      if (!Number.isFinite(disc) || disc < 0 || disc > 100)
        throw new Error("Discount must be between 0 and 100.");
      const body = {
        name: v["name"].trim(),
        description: v["description"]?.trim() || null,
        standard_price: price,
        discount_percent: disc,
      };
      return edit && edit !== "new"
        ? unwrap(await supabase.from("services").update(body).eq("id", edit.id))
        : unwrap(await supabase.from("services").insert(body));
    },
    onSuccess: () => {
      toast.success("Service saved");
      setEdit(null);
      invalidateFinance(qc);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: async (s: Service) =>
      unwrap(await supabase.from("services").update({ is_active: !s.is_active }).eq("id", s.id)),
    onSuccess: () => invalidateFinance(qc),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Services & pricing"
        subtitle={
          manage
            ? "Standard prices apply to new deals only — agreed prices on existing deals never change"
            : "Standard prices and discounts for client conversations (view only)"
        }
        actions={
          manage ? (
            <Button size="sm" onClick={() => setEdit("new")}>
              Add service
            </Button>
          ) : undefined
        }
      />
      <Input
        className="mb-4 max-w-xs"
        placeholder="Search services"
        aria-label="Search services"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          message={search ? "No services match your search." : "No services available yet."}
        />
      ) : (
        <div className="surface overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Standard price</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Price after discount</TableHead>
                {manage ? <TableHead>Status</TableHead> : null}
                {manage ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="max-w-sm text-muted-foreground">
                    {s.description || "—"}
                  </TableCell>
                  <TableCell className="text-right">{money(s.standard_price)}</TableCell>
                  <TableCell className="text-right">
                    {s.discount_percent ? `${s.discount_percent}%` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {money(netPrice(s.standard_price, s.discount_percent))}
                  </TableCell>
                  {manage ? (
                    <TableCell>
                      <StatusPill value={s.is_active ? "active" : "paused"} />
                    </TableCell>
                  ) : null}
                  {manage ? (
                    <TableCell className="space-x-1 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate(s)}
                      >
                        {s.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {manage ? (
        <RecordDialog
          open={edit !== null}
          onOpenChange={(o) => !o && setEdit(null)}
          title={edit === "new" ? "Add service" : "Edit service"}
          submitting={save.isPending}
          initial={
            edit && edit !== "new"
              ? {
                  name: edit.name,
                  description: edit.description ?? "",
                  standard_price: String(edit.standard_price),
                  discount_percent: String(edit.discount_percent),
                }
              : { standard_price: "0", discount_percent: "0" }
          }
          fields={[
            { name: "name", required: true },
            { name: "description", type: "textarea" },
            {
              name: "standard_price",
              label: "Standard price (₹)",
              type: "number",
              step: "0.01",
              required: true,
            },
            { name: "discount_percent", label: "Discount (%)", type: "number", step: "0.01" },
          ]}
          onSubmit={(v) => save.mutate(v)}
        />
      ) : null}
    </>
  );
}
