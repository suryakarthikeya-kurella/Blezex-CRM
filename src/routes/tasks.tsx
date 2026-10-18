import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, MessageSquare, Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import {
  EmptyState,
  ErrorBlock,
  KpiCard,
  LoadingBlock,
  PageHeader,
  PriorityPill,
  StatusPill,
} from "@/components/crm/ui-bits";
import { SelectBox, useUserName, userOptions } from "@/components/crm/controls";
import { RecordDialog } from "@/components/crm/record-dialog";
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
import { useAuth } from "@/lib/auth";
import {
  useAddComment,
  useCreateTask,
  useDirectory,
  useTaskComments,
  useTasks,
  useUpdateTask,
} from "@/lib/api";
import { date, dateTime, downloadCsv, isOverdue } from "@/lib/format";
import type { Task } from "@/lib/db-types";

export const Route = createFileRoute("/tasks")({
  head: () => ({ meta: [{ title: "Tasks — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <Page />
    </AppShell>
  ),
});

function Page() {
  const { profile, role } = useAuth();
  const { data: dir } = useDirectory();
  const userName = useUserName();
  const [scope, setScope] = useState<"mine" | "all">(role === "bds_employee" ? "mine" : "all");
  const [status, setStatus] = useState("open");
  const [open, setOpen] = useState(false);
  const [rid, setRid] = useState(() => crypto.randomUUID());
  const [commentsFor, setCommentsFor] = useState<Task | null>(null);
  const q = useTasks({ scope, status, userId: profile?.id ?? "" });
  const create = useCreateTask();
  const update = useUpdateTask();
  const rows = q.data ?? [];
  const overdue = rows.filter(
    (t) => ["todo", "in_progress"].includes(t.status) && isOverdue(t.due_at),
  ).length;
  const today = rows.filter(
    (t) =>
      ["todo", "in_progress"].includes(t.status) &&
      t.due_at &&
      new Date(t.due_at).toDateString() === new Date().toDateString(),
  ).length;
  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle="Assign, track and complete work"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!rows.length}
              onClick={() =>
                downloadCsv(
                  "tasks.csv",
                  ["title", "status", "priority", "assignee", "due"],
                  rows.map((t) => ({
                    title: t.title,
                    status: t.status,
                    priority: t.priority,
                    assignee: userName(t.assigned_to),
                    due: t.due_at,
                  })),
                )
              }
            >
              <Download className="size-4" /> Export
            </Button>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New task
            </Button>
          </>
        }
      />
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <KpiCard label="Shown" value={rows.length} />
        <KpiCard label="Due today" value={today} />
        <KpiCard label="Overdue" value={overdue} tone={overdue ? "danger" : "default"} />
      </div>
      <div className="surface mb-3 flex flex-wrap gap-2 p-3">
        {role !== "bds_employee" ? (
          <SelectBox
            value={scope}
            onChange={(v) => setScope(v === "mine" ? "mine" : "all")}
            options={[
              { value: "mine", label: "My tasks" },
              { value: "all", label: role === "admin" ? "All tasks" : "Team tasks" },
            ]}
            className="w-40"
          />
        ) : null}
        <SelectBox
          value={status}
          onChange={setStatus}
          options={[
            { value: "open", label: "Open" },
            { value: "todo", label: "To do" },
            { value: "in_progress", label: "In progress" },
            { value: "completed", label: "Completed" },
          ]}
          allLabel="All statuses"
          className="w-40"
        />
      </div>
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState message="No tasks here. 🎉" />
      ) : (
        <div className="surface overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell
                    className={t.status === "completed" ? "line-through opacity-60" : "font-medium"}
                  >
                    {t.title}
                  </TableCell>
                  <TableCell>
                    {t.lead_id ? (
                      <Link
                        to="/leads/$leadId"
                        params={{ leadId: t.lead_id }}
                        className="text-xs hover:underline"
                      >
                        {t.lead?.company_name ?? "Lead"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{userName(t.assigned_to)}</TableCell>
                  <TableCell>
                    <PriorityPill value={t.priority} />
                  </TableCell>
                  <TableCell
                    className={
                      isOverdue(t.due_at) && t.status !== "completed"
                        ? "text-xs font-medium text-destructive"
                        : "text-xs"
                    }
                  >
                    {date(t.due_at)}
                  </TableCell>
                  <TableCell>
                    <SelectBox
                      value={t.status}
                      onChange={(v) =>
                        update.mutate({ id: t.id, patch: { status: v as Task["status"] } })
                      }
                      options={[
                        { value: "todo", label: "To do" },
                        { value: "in_progress", label: "In progress" },
                        { value: "completed", label: "Completed" },
                        { value: "cancelled", label: "Cancelled" },
                      ]}
                      className="h-8 w-36 text-xs"
                      ariaLabel={`Status of ${t.title}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Comments"
                      onClick={() => setCommentsFor(t)}
                    >
                      <MessageSquare className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title="New task"
        submitting={create.isPending}
        initial={{ priority: "medium", assigned_to: profile?.id ?? "" }}
        fields={[
          { name: "title", required: true, full: true },
          { name: "description", type: "textarea" },
          { name: "priority", type: "select", options: ["low", "medium", "high"] },
          { name: "due_at", label: "Due date", type: "date" },
          {
            name: "assigned_to",
            label: "Assign to",
            type: "select",
            options: userOptions(dir?.list),
            disabled: role === "bds_employee",
          },
        ]}
        onSubmit={(v) =>
          create.mutate(
            {
              request_id: rid,
              title: v["title"] ?? "",
              description: v["description"] ?? "",
              priority: v["priority"] || "medium",
              assigned_to: v["assigned_to"] || profile!.id,
              due_at: v["due_at"] ? new Date(`${v["due_at"]}T17:00:00`).toISOString() : null,
            },
            {
              onSuccess: () => {
                setOpen(false);
                setRid(crypto.randomUUID());
              },
            },
          )
        }
      />
      <Comments task={commentsFor} onClose={() => setCommentsFor(null)} />
    </>
  );
}

function Comments({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const { profile } = useAuth();
  const userName = useUserName();
  const q = useTaskComments(task?.id ?? null);
  const add = useAddComment();
  const [text, setText] = useState("");
  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{task?.title}</DialogTitle>
        </DialogHeader>
        <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
          {(q.data ?? []).length === 0 ? (
            <li className="text-muted-foreground">No comments yet.</li>
          ) : (
            (q.data ?? []).map((c) => (
              <li key={c.id}>
                <span className="font-medium">{userName(c.author_id)}</span>{" "}
                <span className="text-[11px] text-muted-foreground">{dateTime(c.created_at)}</span>
                <p>{c.content}</p>
              </li>
            ))
          )}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (task && text.trim())
              add.mutate(
                { task_id: task.id, author_id: profile!.id, content: text.trim() },
                { onSuccess: () => setText("") },
              );
          }}
        >
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a comment"
            aria-label="Comment"
          />
          <Button type="submit" disabled={add.isPending || !text.trim()}>
            Post
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
