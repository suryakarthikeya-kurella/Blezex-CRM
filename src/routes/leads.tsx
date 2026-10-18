import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Pencil, Plus, Search, Trash2, UserPlus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader, PriorityPill, StatusPill, EmptyState } from "@/components/crm/ui-bits";
import { RecordDialog, type FieldDef } from "@/components/crm/record-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ALL_USERS, useAuth } from "@/lib/auth";
import {
  currency,
  exportCsv,
  nextId,
  nowStamp,
  num,
  useCrmMutations,
  useTable,
} from "@/lib/crm-hooks";
import {
  KANBAN_STAGES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  PRIORITIES,
  SERVICES,
  SHEET_COLUMNS,
  type SheetRow,
} from "@/lib/crm-schema";
import { toast } from "sonner";

export const Route = createFileRoute("/leads")({
  head: () => ({
    meta: [
      { title: "Leads — BlezeX CRM" },
      { name: "description", content: "Track, qualify and convert BlezeX sales leads." },
      { property: "og:title", content: "Leads — BlezeX CRM" },
      { property: "og:description", content: "Track, qualify and convert BlezeX sales leads." },
    ],
  }),
  component: LeadsPage,
});

const LEAD_FIELDS: FieldDef[] = [
  { name: "Company Name", required: true },
  { name: "Contact Person", required: true },
  { name: "Phone Number", type: "tel" },
  { name: "Email Address", type: "email" },
  { name: "Service Requirement", type: "select", options: SERVICES },
  { name: "Lead Source", type: "select", options: LEAD_SOURCES },
  { name: "Priority", type: "select", options: PRIORITIES },
  { name: "Status", type: "select", options: LEAD_STATUSES },
  { name: "Last Follow-up Date", type: "date" },
  { name: "Next Follow-up Date", type: "date" },
  { name: "Expected Deal Value", type: "number" },
  { name: "Probability %", type: "number" },
  { name: "Expected Closing Date", type: "date" },
  { name: "Notes", type: "textarea" },
];

function LeadsPage() {
  const { user, isAdmin } = useAuth();
  const { data, isLoading } = useTable("Leads");
  const clients = useTable("Clients");
  const { createMutation, updateMutation, deleteMutation } = useCrmMutations("Leads");
  const clientMutations = useCrmMutations("Clients");

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [sortBy, setSortBy] = useState("Created Date");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SheetRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SheetRow | null>(null);

  const canEdit = (lead: SheetRow) => isAdmin || lead["Assigned To"] === user?.email;

  const rows = useMemo(() => {
    let list = data ?? [];
    const q = search.trim().toLowerCase();
    if (q)
      list = list.filter((l) =>
        ["Lead ID", "Company Name", "Contact Person", "Email Address", "Phone Number"].some((f) =>
          String(l[f] ?? "").toLowerCase().includes(q),
        ),
      );
    if (status !== "all") list = list.filter((l) => l["Status"] === status);
    if (priority !== "all") list = list.filter((l) => l["Priority"] === priority);
    if (assignee !== "all") list = list.filter((l) => l["Assigned To"] === assignee);
    return [...list].sort((a, b) => {
      if (sortBy === "Expected Deal Value") return num(b[sortBy]) - num(a[sortBy]);
      return String(b[sortBy] ?? "").localeCompare(String(a[sortBy] ?? ""));
    });
  }, [data, search, status, priority, assignee, sortBy]);

  const fields: FieldDef[] = [
    ...LEAD_FIELDS,
    {
      name: "Assigned To",
      type: "select",
      options: ALL_USERS.map((u) => u.email),
      disabled: !isAdmin,
    },
  ];

  const submit = (values: Record<string, string>) => {
    const stamp = nowStamp();
    if (editing) {
      updateMutation.mutate({
        row: editing.__row,
        record: {
          ...editing,
          ...values,
          "Lead ID": editing["Lead ID"],
          "Created By": editing["Created By"],
          "Created Date": editing["Created Date"],
          "Last Updated By": user!.email,
          "Last Updated Date": stamp,
        },
      });
    } else {
      createMutation.mutate({
        ...values,
        "Lead ID": nextId(data, "Lead ID", "LD"),
        Status: values["Status"] || "New Lead",
        "Assigned To": values["Assigned To"] || user!.email,
        "Created By": user!.email,
        "Created Date": stamp,
        "Last Updated By": user!.email,
        "Last Updated Date": stamp,
      });
    }
    setDialogOpen(false);
  };

  const quickStatus = (lead: SheetRow, value: string) => {
    updateMutation.mutate({
      row: lead.__row,
      record: {
        ...lead,
        Status: value,
        "Last Updated By": user!.email,
        "Last Updated Date": nowStamp(),
      },
    });
  };

  const convertToClient = (lead: SheetRow) => {
    const exists = (clients.data ?? []).some(
      (c) => c["Company Name"] === lead["Company Name"] && c["Contact Person"] === lead["Contact Person"],
    );
    if (exists) {
      toast.info("This company already exists in Clients.");
      return;
    }
    const stamp = nowStamp();
    clientMutations.createMutation.mutate({
      "Client ID": nextId(clients.data, "Client ID", "CL"),
      "Company Name": lead["Company Name"],
      "Contact Person": lead["Contact Person"],
      "Phone Number": lead["Phone Number"],
      "Email Address": lead["Email Address"],
      "Service Purchased": lead["Service Requirement"],
      "Project Value": lead["Expected Deal Value"],
      "Account Manager": lead["Assigned To"],
      "Start Date": new Date().toISOString().slice(0, 10),
      "Project Status": "Onboarding",
      "Payment Status": "Pending",
      "Amount Paid": "0",
      "Balance Amount": lead["Expected Deal Value"],
      Notes: lead["Notes"],
      "Created By": user!.email,
      "Created Date": stamp,
      "Last Updated By": user!.email,
      "Last Updated Date": stamp,
    });
  };

  return (
    <AppShell>
      <PageHeader
        title="Leads"
        subtitle={`${rows.length} of ${(data ?? []).length} leads`}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => exportCsv("blezex-leads.csv", SHEET_COLUMNS.Leads, rows)}
            >
              <Download className="size-4" /> Export CSV
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="size-4" /> Add Lead
            </Button>
          </>
        }
      />

      <div className="surface mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company, contact, email…"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {LEAD_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={assignee} onValueChange={setAssignee}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Assigned to" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            {ALL_USERS.map((u) => (
              <SelectItem key={u.email} value={u.email}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Created Date">Newest first</SelectItem>
            <SelectItem value="Next Follow-up Date">Next follow-up</SelectItem>
            <SelectItem value="Expected Deal Value">Deal value</SelectItem>
            <SelectItem value="Company Name">Company name</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="table">
        <TabsList>
          <TabsTrigger value="table">Table view</TabsTrigger>
          <TabsTrigger value="kanban">Kanban view</TabsTrigger>
        </TabsList>

        <TabsContent value="table">
          <div className="surface overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead className="min-w-44">Status</TableHead>
                  <TableHead>Next follow-up</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10}>
                      <EmptyState message="Loading leads…" />
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10}>
                      <EmptyState message="No leads match your filters." />
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((lead) => (
                    <TableRow key={lead.__row}>
                      <TableCell>
                        <p className="font-medium">{lead["Company Name"]}</p>
                        <p className="text-xs text-muted-foreground">{lead["Lead ID"]}</p>
                      </TableCell>
                      <TableCell>
                        <p>{lead["Contact Person"]}</p>
                        <p className="text-xs text-muted-foreground">{lead["Phone Number"]}</p>
                      </TableCell>
                      <TableCell className="max-w-40 truncate">
                        {lead["Service Requirement"]}
                      </TableCell>
                      <TableCell>{lead["Lead Source"]}</TableCell>
                      <TableCell className="text-xs">{lead["Assigned To"]}</TableCell>
                      <TableCell>
                        <PriorityPill value={lead["Priority"]} />
                      </TableCell>
                      <TableCell>
                        {canEdit(lead) ? (
                          <Select
                            value={lead["Status"] || "New Lead"}
                            onValueChange={(v) => quickStatus(lead, v)}
                          >
                            <SelectTrigger className="h-8 w-40 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {LEAD_STATUSES.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {s}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <StatusPill value={lead["Status"]} />
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{lead["Next Follow-up Date"] || "—"}</TableCell>
                      <TableCell className="text-right font-medium">
                        {currency(num(lead["Expected Deal Value"]))}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {lead["Status"] === "Converted Client" ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Convert to client"
                              onClick={() => convertToClient(lead)}
                            >
                              <UserPlus className="size-4 text-success" />
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Edit"
                            disabled={!canEdit(lead)}
                            onClick={() => {
                              setEditing(lead);
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
                              onClick={() => setDeleteTarget(lead)}
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
        </TabsContent>

        <TabsContent value="kanban">
          <div className="flex gap-3 overflow-x-auto pb-4">
            {KANBAN_STAGES.map((stage) => {
              const stageLeads = rows.filter((l) => (l["Status"] || "New Lead") === stage);
              return (
                <div
                  key={stage}
                  className="w-72 shrink-0 rounded-xl bg-muted/60 p-3"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const row = Number(e.dataTransfer.getData("text/plain"));
                    const lead = (data ?? []).find((l) => l.__row === row);
                    if (!lead) return;
                    if (!canEdit(lead)) {
                      toast.error("You can only update leads assigned to you.");
                      return;
                    }
                    if (lead["Status"] !== stage) quickStatus(lead, stage);
                  }}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-semibold">{stage}</p>
                    <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
                      {stageLeads.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {stageLeads.map((lead) => (
                      <div
                        key={lead.__row}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", String(lead.__row))}
                        className="surface cursor-grab p-3 active:cursor-grabbing"
                        onDoubleClick={() => {
                          if (!canEdit(lead)) return;
                          setEditing(lead);
                          setDialogOpen(true);
                        }}
                      >
                        <p className="text-sm font-medium">{lead["Company Name"]}</p>
                        <p className="text-xs text-muted-foreground">{lead["Contact Person"]}</p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <PriorityPill value={lead["Priority"]} />
                          <span className="text-xs font-medium">
                            {currency(num(lead["Expected Deal Value"]))}
                          </span>
                        </div>
                      </div>
                    ))}
                    {stageLeads.length === 0 ? (
                      <p className="py-6 text-center text-xs text-muted-foreground">Drop here</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      <RecordDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? `Edit ${editing["Company Name"]}` : "Add lead"}
        description={editing ? `Lead ${editing["Lead ID"]}` : "Create a new sales lead."}
        fields={fields}
        initial={editing ?? { Status: "New Lead", Priority: "Medium", "Assigned To": user!.email }}
        submitting={createMutation.isPending || updateMutation.isPending}
        onSubmit={submit}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.["Company Name"]} will be permanently removed from the shared sheet.
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
