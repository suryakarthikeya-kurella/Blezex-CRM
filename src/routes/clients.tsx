import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  StatusPill,
} from "@/components/crm/ui-bits";
import { useUserName } from "@/components/crm/controls";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useClients } from "@/lib/api";
import { date } from "@/lib/format";

export const Route = createFileRoute("/clients")({
  head: () => ({ meta: [{ title: "Clients — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <Page />
    </AppShell>
  ),
});

function Page() {
  const match = useMatchRoute();
  const q = useClients();
  const userName = useUserName();
  if (match({ to: "/clients/$clientId", fuzzy: true })) return <Outlet />;
  return (
    <>
      <PageHeader title="Clients" subtitle="Created automatically when a lead is converted" />
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState message="No clients yet. Convert a lead to create one." />
      ) : (
        <div className="surface overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(q.data ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="text-xs text-muted-foreground">{c.client_number}</TableCell>
                  <TableCell>
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: c.id }}
                      className="font-medium hover:underline"
                    >
                      {c.company_name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">
                    {c.contact_name}
                    <div className="text-muted-foreground">{c.email}</div>
                  </TableCell>
                  <TableCell className="text-xs">{userName(c.relationship_owner_id)}</TableCell>
                  <TableCell>
                    <StatusPill value={c.status} />
                  </TableCell>
                  <TableCell className="text-xs">{date(c.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
