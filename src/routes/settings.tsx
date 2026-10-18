import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { PageHeader, SectionCard } from "@/components/crm/ui-bits";
import { ALL_USERS } from "@/lib/auth";
import { useTable } from "@/lib/crm-hooks";
import { SERVICES } from "@/lib/crm-schema";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — BlezeX CRM" },
      { name: "description", content: "Workspace users, services and data source configuration." },
      { property: "og:title", content: "Settings — BlezeX CRM" },
      {
        property: "og:description",
        content: "Workspace users, services and data source configuration.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const settings = useTable("Settings");

  return (
    <AppShell adminOnly>
      <PageHeader title="Settings" subtitle="Workspace configuration (admins only)" />

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Users and roles">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ALL_USERS.map((u) => (
                <TableRow key={u.email}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="text-xs">{u.email}</TableCell>
                  <TableCell>
                    <span
                      className={
                        u.role === "Admin"
                          ? "inline-flex rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                          : "inline-flex rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
                      }
                    >
                      {u.role}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Accounts are fixed. There is no signup, registration or password recovery.
          </p>
        </SectionCard>

        <SectionCard title="Data source">
          <p className="text-sm">
            All records are stored in the shared <strong>BlezeX CRM Data</strong> spreadsheet with
            tabs for Leads, Clients, Activities, Tasks and Settings. Everyone sees the same data and
            updates refresh automatically.
          </p>
          <div className="mt-3 space-y-1 text-sm">
            {(settings.data ?? []).map((r) => (
              <div key={r.__row} className="flex justify-between border-b border-border/60 py-1.5">
                <span className="text-muted-foreground">{r["Key"]}</span>
                <span className="font-medium">{r["Value"]}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Service catalogue" className="lg:col-span-2">
          <div className="flex flex-wrap gap-2">
            {SERVICES.map((s) => (
              <span
                key={s}
                className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium"
              >
                {s}
              </span>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Permissions" className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2 text-sm">
            <div>
              <p className="mb-1 font-semibold">Admin</p>
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                <li>View, create, edit and delete all records</li>
                <li>Assign leads and tasks</li>
                <li>Access reports, analytics and settings</li>
                <li>View team performance</li>
              </ul>
            </div>
            <div>
              <p className="mb-1 font-semibold">Team Member</p>
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                <li>Create leads and log activities</li>
                <li>Update assigned leads and lead status</li>
                <li>Complete assigned tasks</li>
                <li>No deletes, reports, analytics or settings</li>
              </ul>
            </div>
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
