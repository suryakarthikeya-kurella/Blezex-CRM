import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, KpiCard, PageHeader, StatusPill } from "@/components/crm/ui-bits";
import { RecordDialog, type FieldDef } from "@/components/crm/record-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ALL_USERS, useAuth } from "@/lib/auth";
import { currency, exportCsv, nextId, nowStamp, num, useCrmMutations, useTable } from "@/lib/crm-hooks";
import {
  PAYMENT_STATUSES,
  PROJECT_STATUSES,
  SERVICES,
  SHEET_COLUMNS,
  type SheetRow,
} from "@/lib/crm-schema";

export const Route = createFileRoute("/clients")({
  head: () => ({
    meta: [
      { title: "Clients — BlezeX CRM" },
      { name: "description", content: "Client projects, delivery status and payment tracking." },
      { property: "og:title", content: "Clients — BlezeX CRM" },
      {
        property: "og:description",
        content: "Client projects, delivery status and payment tracking.",
      },
    ],
  }),
  component: ClientsPage,
});

const FIELDS: FieldDef[] = [
  { name: "Company Name", required: true },
  { name: "Contact Person", required: true },
  { name: "Phone Number", type: "tel" },
  { name: "Email Address", type: "email" },
  { name: "Service Purchased", type: "select", options: SERVICES },
  { name: "Project Value", type: "number" },
  { name: "Account Manager", type: "select", options: ALL_USERS.map((u) => u.email) },
  { name: "Start Date", type: "date" },
  { name: "Completion Date", type: "date" },
  { name: "Project Status", type: "select", options: PROJECT_STATUSES },
  { name: "Payment Status", type: "select", options: PAYMENT_STATUSES },
  { name: "Amount Paid", type: "number" },
  { name: "Notes", type: "textarea" },
];

function ClientsPage() {
  const { user, isAdmin } = useAuth();
  const { data, isLoading } = useTable("Clients");
  const activities = useTable("Activities");
  const { createMutation, updateMutation, deleteMutation } = useCrmMutations("Clients");

  const [search, setSearch] = useState("");
  const [projectStatus, setProjectStatus] = useState("all");
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SheetRow | null>(null);
  const [profile, setProfile] = useState<SheetRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SheetRow | null>(null);

  const rows = useMemo(() => {
    let list = data ?? [];
    const q = search.trim().toLowerCase();
    if (q)
      list = list.filter((c) =>
        ["Client ID", "Company Name", "Contact Person", "Email Address"].some((f) =>
          String(c[f] ?? "").toLowerCase().includes(q),
        ),
      );
    if (projectStatus !== "all") list = list.filter((c) => c["Project Status"] === projectStatus);
    if (paymentStatus !== "all") list = list.filter((c) => c["Payment Status"] === paymentStatus);
    return list;
  }, [data, search, projectStatus, paymentStatus]);

  const totals = useMemo(() => {
    const list = data ?? [];
    const value = list.reduce((s, c) => s + num(c["Project Value"]), 0);
    const paid = list.reduce((s, c) => s + num(c["Amount Paid"]), 0);
    return { count: list.length, value, paid, balance: value - paid };
  }, [data]);

  const submit = (values: Record<string, string>) => {
    const stamp = nowStamp();
    const balance = String(num(values["Project Value"]) - num(values["Amount Paid"]));
    if (editing) {
      updateMutation.mutate({
        row: editing.__row,
        record: {
          ...editing,
          ...values,
          "Balance Amount": balance,
          "Client ID": editing["Client ID"],
          "Created By": editing["Created By"],
          "Created Date": editing["Created Date"],
          "Last Updated By": user!.email,
          "Last Updated Date": stamp,
        },
      });
    } else {
      createMutation.mutate({
        ...values,
        "Client ID": nextId(data, "Client ID", "CL"),
        "Balance Amount": balance,
        "Project Status": values["Project Status"] || "Onboarding",
        "Payment Status": values["Payment Status"] || "Pending",
        "Created By": user!.email,
        "Created Date": stamp,
        "Last Updated By": user!.email,
        "Last Updated Date": stamp,
      });
    }
    setDialogOpen(false);
  };

  const history = (client: SheetRow | null) =>
    (activities.data ?? []).filter((a) => a["Company"] === client?.["Company Name"]);

  return (
    <AppShell>
      <PageHeader
        title="Clients"
        subtitle="Projects, delivery and payments"
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => exportCsv("blezex-clients.csv", SHEET_COLUMNS.Clients, rows)}
            >
              <Download className="size-4" /> Export CSV
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="size-4" /> Add Client
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total clients" value={totals.count} tone="primary" />
        <KpiCard label="Contracted value" value={currency(totals.value)} />
        <KpiCard label="Amount received" value={currency(totals.paid)} tone="success" />
        <KpiCard label="Outstanding" value={currency(totals.balance)} tone="warning" />
      </div>

      <div className="surface mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients…"
          />
        </div>
        <Select value={projectStatus} onValueChange={setProjectStatus}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Project status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All project statuses</SelectItem>
            {PROJECT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={paymentStatus} onValueChange={setPaymentStatus}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Payment status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payment statuses</SelectItem>
            {PAYMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="surface overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Account manager</TableHead>
              <TableHead>Project status</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <EmptyState message="Loading clients…" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <EmptyState message="No clients yet. Convert a lead to get started." />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((c) => (
                <TableRow key={c.__row}>
                  <TableCell>
                    <button className="text-left" onClick={() => setProfile(c)}>
                      <p className="font-medium hover:text-primary">{c["Company Name"]}</p>
                      <p className="text-xs text-muted-foreground">
                        {c["Client ID"]} · {c["Contact Person"]}
                      </p>
                    </button>
                  </TableCell>
                  <TableCell className="max-w-40 truncate">{c["Service Purchased"]}</TableCell>
                  <TableCell className="text-xs">{c["Account Manager"]}</TableCell>
                  <TableCell>
                    <StatusPill value={c["Project Status"]} />
                  </TableCell>
                  <TableCell>
                    <StatusPill value={c["Payment Status"]} />
                  </TableCell>
                  <TableCell className="text-right">{currency(num(c["Project Value"]))}</TableCell>
                  <TableCell className="text-right font-medium">
                    {currency(num(c["Balance Amount"]))}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Edit"
                        onClick={() => {
                          setEditing(c);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      {isAdmin ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete"
                          onClick={() => setDeleteTarget(c)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {profile ? (
        <div className="surface mt-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold">{profile["Company Name"]}</h2>
              <p className="text-sm text-muted-foreground">
                {profile["Contact Person"]} · {profile["Email Address"]} · {profile["Phone Number"]}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setProfile(null)}>
              Close
            </Button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Project value" value={currency(num(profile["Project Value"]))} />
            <KpiCard
              label="Paid"
              value={currency(num(profile["Amount Paid"]))}
              tone="success"
            />
            <KpiCard
              label="Balance"
              value={currency(num(profile["Balance Amount"]))}
              tone="warning"
            />
            <KpiCard
              label="Timeline"
              value={`${profile["Start Date"] || "—"} → ${profile["Completion Date"] || "—"}`}
            />
          </div>
          <h3 className="mt-5 mb-2 font-display text-sm font-semibold">Service history</h3>
          {history(profile).length === 0 ? (
            <EmptyState message="No activities logged for this client yet." />
          ) : (
            <ul className="space-y-2">
              {history(profile).map((a) => (
                <li key={a.__row} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <StatusPill value={a["Activity Type"]} />
                    <span className="text-xs text-muted-foreground">{a["Date"]}</span>
                  </div>
                  <p className="mt-1">{a["Discussion Summary"]}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <RecordDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? `Edit ${editing["Company Name"]}` : "Add client"}
        fields={FIELDS}
        initial={
          editing ?? {
            "Project Status": "Onboarding",
            "Payment Status": "Pending",
            "Account Manager": user!.email,
            "Amount Paid": "0",
          }
        }
        submitting={createMutation.isPending || updateMutation.isPending}
        onSubmit={submit}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this client?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.["Company Name"]} will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.__row);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
