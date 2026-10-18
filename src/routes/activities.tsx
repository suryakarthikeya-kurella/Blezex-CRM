import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/crm/ui-bits";
import { Pager, SelectBox, useUserName, userOptions } from "@/components/crm/controls";
import { RecordDialog } from "@/components/crm/record-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { useActivities, useCreateActivity, useDirectory, useLeads } from "@/lib/api";
import { dateTime, downloadCsv, label } from "@/lib/format";

export const Route = createFileRoute("/activities")({
  head: () => ({ meta: [{ title: "Activities — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <Page />
    </AppShell>
  ),
});
const TYPES = [
  "call",
  "email",
  "whatsapp",
  "meeting",
  "demo",
  "follow_up",
  "client_review",
  "note",
  "other",
].map((v) => ({ value: v, label: label(v) }));

function Page() {
  const { profile, role } = useAuth();
  const { data: dir } = useDirectory();
  const userName = useUserName();
  const [page, setPage] = useState(0);
  const [type, setType] = useState("");
  const [user, setUser] = useState("");
  const [open, setOpen] = useState(false);
  const [rid, setRid] = useState(() => crypto.randomUUID());
  const q = useActivities({ page, type, user });
  const leads = useLeads({ pageSize: 100, page: 0 });
  const create = useCreateActivity();
  const rows = q.data?.rows ?? [];
  return (
    <>
      <PageHeader
        title="Activities"
        subtitle="Calls, messages, meetings and notes"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!rows.length}
              onClick={() =>
                downloadCsv(
                  "activities.csv",
                  ["when", "type", "lead", "subject", "outcome", "by"],
                  rows.map((a) => ({
                    when: a.occurred_at,
                    type: a.activity_type,
                    lead: a.lead?.company_name,
                    subject: a.subject,
                    outcome: a.outcome,
                    by: userName(a.user_id),
                  })),
                )
              }
            >
              <Download className="size-4" /> Export page
            </Button>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="size-4" /> Log activity
            </Button>
          </>
        }
      />
      <div className="surface mb-3 flex flex-wrap gap-2 p-3">
        <SelectBox
          value={type}
          onChange={(v) => {
            setType(v);
            setPage(0);
          }}
          options={TYPES}
          allLabel="All types"
        />
        {role !== "bds_employee" ? (
          <SelectBox
            value={user}
            onChange={(v) => {
              setUser(v);
              setPage(0);
            }}
            options={userOptions(dir?.list)}
            allLabel="All people"
          />
        ) : null}
      </div>
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState message="No activities yet." />
      ) : (
        <div className="surface overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-xs">{dateTime(a.occurred_at)}</TableCell>
                  <TableCell>{label(a.activity_type)}</TableCell>
                  <TableCell>
                    {a.lead_id ? (
                      <Link
                        to="/leads/$leadId"
                        params={{ leadId: a.lead_id }}
                        className="hover:underline"
                      >
                        {a.lead?.company_name ?? "Lead"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {a.subject ?? a.description ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">{a.outcome ?? "—"}</TableCell>
                  <TableCell className="text-xs">{userName(a.user_id)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pager page={page} total={q.data?.total ?? 0} onPage={setPage} />
      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title="Log activity"
        submitting={create.isPending}
        initial={{ activity_type: "call" }}
        fields={[
          {
            name: "lead_id",
            label: "Lead",
            type: "select",
            required: true,
            full: true,
            options: (leads.data?.rows ?? []).map((l) => ({
              value: l.id,
              label: `${l.company_name} (${l.lead_number})`,
            })),
          },
          { name: "activity_type", label: "Type", type: "select", options: TYPES },
          { name: "subject" },
          { name: "description", label: "Summary", type: "textarea" },
          { name: "outcome" },
          { name: "next_action", label: "Next action" },
          { name: "next_follow_up_at", label: "Next follow-up", type: "date" },
        ]}
        onSubmit={(v) => {
          if (!v["lead_id"]) return;
          create.mutate(
            {
              request_id: rid,
              lead_id: v["lead_id"],
              user_id: profile!.id,
              activity_type: v["activity_type"] || "note",
              subject: v["subject"] ?? "",
              description: v["description"] ?? "",
              outcome: v["outcome"] ?? "",
              next_action: v["next_action"] ?? "",
              next_follow_up_at: v["next_follow_up_at"]
                ? new Date(`${v["next_follow_up_at"]}T09:00:00`).toISOString()
                : null,
            },
            {
              onSuccess: () => {
                setOpen(false);
                setRid(crypto.randomUUID());
              },
            },
          );
        }}
      />
    </>
  );
}
