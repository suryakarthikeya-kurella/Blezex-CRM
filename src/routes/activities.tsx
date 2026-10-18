import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, PageHeader, StatusPill } from "@/components/crm/ui-bits";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ALL_USERS, useAuth } from "@/lib/auth";
import { exportCsv, nextId, nowStamp, today, useCrmMutations, useTable } from "@/lib/crm-hooks";
import { ACTIVITY_TYPES, SHEET_COLUMNS, type SheetRow } from "@/lib/crm-schema";

export const Route = createFileRoute("/activities")({
  head: () => ({
    meta: [
      { title: "Activities — BlezeX CRM" },
      { name: "description", content: "Every call, meeting and follow-up logged in one timeline." },
      { property: "og:title", content: "Activities — BlezeX CRM" },
      {
        property: "og:description",
        content: "Every call, meeting and follow-up logged in one timeline.",
      },
    ],
  }),
  component: ActivitiesPage,
});

const FIELDS: FieldDef[] = [
  { name: "Date", type: "date", required: true },
  { name: "Company", required: true },
  { name: "Contact Person" },
  { name: "Activity Type", type: "select", options: ACTIVITY_TYPES },
  { name: "Discussion Summary", type: "textarea" },
  { name: "Outcome", type: "textarea" },
  { name: "Next Action", type: "textarea" },
  { name: "Next Follow-up Date", type: "date" },
  { name: "Owner", type: "select", options: ALL_USERS.map((u) => u.email) },
];

function ActivitiesPage() {
  const { user, isAdmin } = useAuth();
  const { data, isLoading } = useTable("Activities");
  const { createMutation, updateMutation, deleteMutation } = useCrmMutations("Activities");

  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [owner, setOwner] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SheetRow | null>(null);

  const rows = useMemo(() => {
    let list = data ?? [];
    const q = search.trim().toLowerCase();
    if (q)
      list = list.filter((a) =>
        ["Company", "Contact Person", "Discussion Summary", "Outcome"].some((f) =>
          String(a[f] ?? "").toLowerCase().includes(q),
        ),
      );
    if (type !== "all") list = list.filter((a) => a["Activity Type"] === type);
    if (owner !== "all") list = list.filter((a) => a["Owner"] === owner);
    return [...list].sort((a, b) => String(b["Date"]).localeCompare(String(a["Date"])));
  }, [data, search, type, owner]);

  const submit = (values: Record<string, string>) => {
    const stamp = nowStamp();
    if (editing) {
      updateMutation.mutate({
        row: editing.__row,
        record: {
          ...editing,
          ...values,
          "Activity ID": editing["Activity ID"],
          "Created By": editing["Created By"],
          "Created Date": editing["Created Date"],
          "Last Updated By": user!.email,
          "Last Updated Date": stamp,
        },
      });
    } else {
      createMutation.mutate({
        ...values,
        "Activity ID": nextId(data, "Activity ID", "AC"),
        Owner: values["Owner"] || user!.email,
        "Created By": user!.email,
        "Created Date": stamp,
        "Last Updated By": user!.email,
        "Last Updated Date": stamp,
      });
    }
    setDialogOpen(false);
  };

  return (
    <AppShell>
      <PageHeader
        title="Activities"
        subtitle="Calls, meetings, demos and follow-ups"
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => exportCsv("blezex-activities.csv", SHEET_COLUMNS.Activities, rows)}
            >
              <Download className="size-4" /> Export CSV
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="size-4" /> Log Activity
            </Button>
          </>
        }
      />

      <div className="surface mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activities…"
          />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {ACTIVITY_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={owner} onValueChange={setOwner}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Owner" />
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
      </div>

      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">Timeline view</TabsTrigger>
          <TabsTrigger value="table">Table view</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline">
          <div className="surface p-5">
            {isLoading ? (
              <EmptyState message="Loading activities…" />
            ) : rows.length === 0 ? (
              <EmptyState message="No activities logged yet." />
            ) : (
              <ol className="relative space-y-5 border-l border-border pl-6">
                {rows.map((a) => (
                  <li key={a.__row} className="relative">
                    <span className="absolute top-1.5 -left-[1.6875rem] size-3 rounded-full border-2 border-background bg-primary" />
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill value={a["Activity Type"]} />
                      <span className="font-medium">{a["Company"]}</span>
                      <span className="text-xs text-muted-foreground">{a["Date"]}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{a["Owner"]}</span>
                    </div>
                    <p className="mt-1.5 text-sm">{a["Discussion Summary"]}</p>
                    {a["Outcome"] ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Outcome: {a["Outcome"]}
                      </p>
                    ) : null}
                    {a["Next Action"] ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Next: {a["Next Action"]}
                        {a["Next Follow-up Date"] ? ` (${a["Next Follow-up Date"]})` : ""}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </TabsContent>

        <TabsContent value="table">
          <div className="surface overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead>Next follow-up</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.__row}>
                    <TableCell className="text-xs">{a["Date"]}</TableCell>
                    <TableCell className="font-medium">{a["Company"]}</TableCell>
                    <TableCell>{a["Contact Person"]}</TableCell>
                    <TableCell>
                      <StatusPill value={a["Activity Type"]} />
                    </TableCell>
                    <TableCell className="max-w-64 truncate">{a["Discussion Summary"]}</TableCell>
                    <TableCell className="text-xs">{a["Next Follow-up Date"] || "—"}</TableCell>
                    <TableCell className="text-xs">{a["Owner"]}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditing(a);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        {isAdmin ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteMutation.mutate(a.__row)}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <RecordDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? "Edit activity" : "Log activity"}
        fields={FIELDS}
        initial={editing ?? { Date: today(), Owner: user!.email, "Activity Type": "Call" }}
        submitting={createMutation.isPending || updateMutation.isPending}
        onSubmit={submit}
      />
    </AppShell>
  );
}
