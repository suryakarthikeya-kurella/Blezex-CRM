import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/crm/ui-bits";
import { Pager, SelectBox, useUserName } from "@/components/crm/controls";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { supabase, toError } from "@/lib/supabase";
import { dateTime } from "@/lib/format";

export const Route = createFileRoute("/audit-logs")({
  head: () => ({ meta: [{ title: "Audit log — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <Page />
    </AppShell>
  ),
});
type L = {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
};

function changed(l: L) {
  if (!l.after_data) return "deleted";
  if (!l.before_data) return "created";
  return Object.keys(l.after_data)
    .filter(
      (k) =>
        !["updated_at", "row_version"].includes(k) &&
        JSON.stringify(l.after_data![k]) !== JSON.stringify(l.before_data![k]),
    )
    .map((k) => `${k}: ${JSON.stringify(l.before_data![k])} → ${JSON.stringify(l.after_data![k])}`)
    .join("; ");
}

function Page() {
  const { role } = useAuth();
  const userName = useUserName();
  const [page, setPage] = useState(0);
  const [type, setType] = useState("");
  const q = useQuery({
    queryKey: ["audit", page, type],
    queryFn: async () => {
      let s = supabase.from("audit_logs").select("*", { count: "exact" });
      if (type) s = s.eq("entity_type", type);
      const r = await s.order("created_at", { ascending: false }).range(page * 25, page * 25 + 24);
      if (r.error) throw toError(r.error);
      return { rows: (r.data ?? []) as L[], total: r.count ?? 0 };
    },
  });
  const types =
    role === "admin"
      ? [
          "leads",
          "profiles",
          "team_memberships",
          "clients",
          "projects",
          "proposals",
          "invoices",
          "payments",
          "tasks",
          "app_settings",
          "approval_requests",
        ]
      : ["leads", "tasks"];
  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle={
          role === "admin"
            ? "Immutable history of every sensitive change"
            : "Your work-related history"
        }
      />
      <div className="mb-3">
        <SelectBox
          value={type}
          onChange={(v) => {
            setType(v);
            setPage(0);
          }}
          options={types.map((t) => ({ value: t, label: t }))}
          allLabel="All records"
        />
      </div>
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} />
      ) : (q.data?.rows ?? []).length === 0 ? (
        <EmptyState message="No entries." />
      ) : (
        <div className="surface overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Record</TableHead>
                <TableHead>Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(q.data?.rows ?? []).map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs">{dateTime(l.created_at)}</TableCell>
                  <TableCell className="text-xs">
                    {l.actor_id ? userName(l.actor_id) : "System"}
                  </TableCell>
                  <TableCell className="text-xs">{l.action}</TableCell>
                  <TableCell className="text-xs">{l.entity_type}</TableCell>
                  <TableCell
                    className="max-w-md truncate text-xs text-muted-foreground"
                    title={changed(l)}
                  >
                    {changed(l)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pager page={page} total={q.data?.total ?? 0} onPage={setPage} />
    </>
  );
}
