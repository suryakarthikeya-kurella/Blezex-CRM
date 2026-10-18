import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, KpiCard, PageHeader, PriorityPill, StatusPill } from "@/components/crm/ui-bits";
import { RecordDialog, type FieldDef } from "@/components/crm/record-dialog";
import { Button } from "@/components/ui/button";
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
import { PRIORITIES, SHEET_COLUMNS, TASK_STATUSES, type SheetRow } from "@/lib/crm-schema";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks — BlezeX CRM" },
      { name: "description", content: "Assign, track and complete BlezeX sales and delivery tasks." },
      { property: "og:title", content: "Tasks — BlezeX CRM" },
      {
        property: "og:description",
        content: "Assign, track and complete BlezeX sales and delivery tasks.",
      },
    ],
  }),
  component: TasksPage,
});

function TasksPage() {
  const { user, isAdmin } = useAuth();
  const { data, isLoading } = useTable("Tasks");
  const { createMutation, updateMutation, deleteMutation } = useCrmMutations("Tasks");

  const [scope, setScope] = useState<"mine" | "all">(isAdmin ? "all" : "mine");
  const [status, setStatus] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SheetRow | null>(null);

  const day = today();

  const FIELDS: FieldDef[] = [
    { name: "Task Title", required: true, full: true },
    { name: "Description", type: "textarea" },
    {
      name: "Assigned To",
      type: "select",
      options: ALL_USERS.map((u) => u.email),
      disabled: !isAdmin,
    },
    { name: "Priority", type: "select", options: PRIORITIES },
    { name: "Due Date", type: "date" },
    { name: "Status", type: "select", options: TASK_STATUSES },
  ];

  const rows = useMemo(() => {
    let list = data ?? [];
    if (scope === "mine") list = list.filter((t) => t["Assigned To"] === user?.email);
    if (status !== "all") list = list.filter((t) => t["Status"] === status);
    return [...list].sort((a, b) => String(a["Due Date"]).localeCompare(String(b["Due Date"])));
  }, [data, scope, status, user]);

  const stats = useMemo(() => {
    const list = data ?? [];
    const open = list.filter((t) => t["Status"] !== "Completed");
    return {
      total: list.length,
      open: open.length,
      overdue: open.filter((t) => t["Due Date"] && t["Due Date"] < day).length,
      completed: list.filter((t) => t["Status"] === "Completed").length,
    };
  }, [data, day]);

  const canEdit = (t: SheetRow) => isAdmin || t["Assigned To"] === user?.email;

  const submit = (values: Record<string, string>) => {
    const stamp = nowStamp();
    if (editing) {
      updateMutation.mutate({
        row: editing.__row,
        record: {
          ...editing,
          ...values,
          "Task ID": editing["Task ID"],
          "Created By": editing["Created By"],
          "Created Date": editing["Created Date"],
          "Last Updated By": user!.email,
          "Last Updated Date": stamp,
        },
      });
    } else {
      createMutation.mutate({
        ...values,
        "Task ID": nextId(data, "Task ID", "TK"),
        Status: values["Status"] || "To Do",
        "Assigned To": values["Assigned To"] || user!.email,
        "Created By": user!.email,
        "Created Date": stamp,
        "Last Updated By": user!.email,
        "Last Updated Date": stamp,
      });
    }
    setDialogOpen(false);
  };

  const setStatusFor = (t: SheetRow, value: string) =>
    updateMutation.mutate({
      row: t.__row,
      record: {
        ...t,
        Status: value,
        "Last Updated By": user!.email,
        "Last Updated Date": nowStamp(),
      },
    });

  return (
    <AppShell>
      <PageHeader
        title="Tasks"
        subtitle="Internal work assignments"
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => exportCsv("blezex-tasks.csv", SHEET_COLUMNS.Tasks, rows)}
            >
              <Download className="size-4" /> Export CSV
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="size-4" /> Create Task
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="All tasks" value={stats.total} />
        <KpiCard label="Open" value={stats.open} tone="primary" />
        <KpiCard label="Overdue" value={stats.overdue} tone="danger" />
        <KpiCard label="Completed" value={stats.completed} tone="success" />
      </div>

      <div className="surface mb-4 flex flex-wrap items-center gap-2 p-3">
        <Select value={scope} onValueChange={(v) => setScope(v as "mine" | "all")}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mine">My tasks</SelectItem>
            <SelectItem value="all">All tasks</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {TASK_STATUSES.map((s) => (
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
              <TableHead>Task</TableHead>
              <TableHead>Assigned to</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="min-w-40">Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyState message="Loading tasks…" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyState message="No tasks here." />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((t) => {
                const overdue = t["Due Date"] && t["Due Date"] < day && t["Status"] !== "Completed";
                return (
                  <TableRow key={t.__row}>
                    <TableCell>
                      <p className="font-medium">{t["Task Title"]}</p>
                      <p className="max-w-80 truncate text-xs text-muted-foreground">
                        {t["Description"]}
                      </p>
                    </TableCell>
                    <TableCell className="text-xs">{t["Assigned To"]}</TableCell>
                    <TableCell>
                      <PriorityPill value={t["Priority"]} />
                    </TableCell>
                    <TableCell
                      className={cn("text-xs", overdue && "font-semibold text-destructive")}
                    >
                      {t["Due Date"] || "—"}
                      {overdue ? " · overdue" : ""}
                    </TableCell>
                    <TableCell>
                      {canEdit(t) ? (
                        <Select
                          value={t["Status"] || "To Do"}
                          onValueChange={(v) => setStatusFor(t, v)}
                        >
                          <SelectTrigger className="h-8 w-36 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TASK_STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <StatusPill value={t["Status"]} />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {canEdit(t) && t["Status"] !== "Completed" ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Mark complete"
                            onClick={() => setStatusFor(t, "Completed")}
                          >
                            <CheckCircle2 className="size-4 text-success" />
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={!canEdit(t)}
                          onClick={() => {
                            setEditing(t);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        {isAdmin ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteMutation.mutate(t.__row)}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <RecordDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? "Edit task" : "Create task"}
        fields={FIELDS}
        initial={
          editing ?? { Status: "To Do", Priority: "Medium", "Assigned To": user!.email, "Due Date": day }
        }
        submitting={createMutation.isPending || updateMutation.isPending}
        onSubmit={submit}
      />
    </AppShell>
  );
}
