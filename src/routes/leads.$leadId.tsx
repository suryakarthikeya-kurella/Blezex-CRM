import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Archive, Pencil, Trophy, UserCog } from "lucide-react";
import { toast } from "sonner";
import { AppShell, AccessDenied } from "@/components/app-shell";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  PriorityPill,
  SectionCard,
  StatusPill,
} from "@/components/crm/ui-bits";
import { SelectBox, useUserName, userOptions } from "@/components/crm/controls";
import { LeadFormDialog, formToPatch, leadToForm } from "@/components/crm/lead-form";
import { RecordDialog } from "@/components/crm/record-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import {
  useArchiveLead,
  useAssignLead,
  useConfig,
  useConvertLead,
  useCreateActivity,
  useCreateTask,
  useDirectory,
  useLead,
  useMoveStage,
  useUpdateLead,
  useUpdateTask,
} from "@/lib/api";
import { supabase, unwrap } from "@/lib/supabase";
import { date, dateTime, label, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/leads/$leadId")({
  head: () => ({ meta: [{ title: "Lead — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <LeadDetail />
    </AppShell>
  ),
});

const ACTIVITY_TYPES = [
  "call",
  "email",
  "whatsapp",
  "meeting",
  "demo",
  "follow_up",
  "note",
  "other",
].map((v) => ({ value: v, label: label(v) }));
const FOLLOW_UP_DAYS = [1, 3, 7, 14, 21];

function LeadDetail() {
  const { leadId } = Route.useParams();
  const nav = useNavigate();
  const { profile, role } = useAuth();
  const { data: cfg } = useConfig();
  const { data: dir } = useDirectory();
  const userName = useUserName();
  const q = useLead(leadId);
  const update = useUpdateLead();
  const move = useMoveStage();
  const assign = useAssignLead();
  const archive = useArchiveLead();
  const convert = useConvertLead();
  const logAct = useCreateActivity();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const qc = useQueryClient();
  const proposal = useMutation({
    mutationFn: async (v: { title: string; amount: number; status: string; version: number }) =>
      unwrap(await supabase.from("proposals").insert({ lead_id: leadId, ...v } as never)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["lead", leadId] });
      toast.success("Proposal saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const [edit, setEdit] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTo, setAssignTo] = useState("");
  const [convertOpen, setConvertOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [actOpen, setActOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [propOpen, setPropOpen] = useState(false);
  const [rid, setRid] = useState(() => crypto.randomUUID());
  const [note, setNote] = useState("");

  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data)
    return <AccessDenied message="This lead doesn't exist or you don't have access to it." />;
  const { lead: l, activities, history, assignments, tasks, proposals, qualification } = q.data;
  const stage = cfg?.stages.find((s) => s.key === l.stage);
  const closed = !!(stage?.is_won || stage?.is_lost);
  const stageOpts = (cfg?.stages ?? [])
    .filter((s) => s.is_active && !s.is_won)
    .map((s) => ({ value: s.key, label: s.label }));
  const timeline = [
    ...activities.map((a) => ({
      at: a.occurred_at,
      kind: "activity" as const,
      title: `${label(a.activity_type)}${a.subject ? ` — ${a.subject}` : ""}`,
      body: [
        a.description,
        a.outcome && `Outcome: ${a.outcome}`,
        a.next_action && `Next: ${a.next_action}`,
      ]
        .filter(Boolean)
        .join(" · "),
      who: userName(a.user_id),
    })),
    ...history.map((h) => ({
      at: h.changed_at,
      kind: "stage" as const,
      title: h.from_stage
        ? `Stage: ${cfg?.stages.find((s) => s.key === h.from_stage)?.label ?? h.from_stage} → ${cfg?.stages.find((s) => s.key === h.to_stage)?.label ?? h.to_stage}`
        : "Lead created",
      body: h.note ?? "",
      who: userName(h.actor_id),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const scoreTone =
    qualification.score >= Number(cfg?.settings["qualification.min_score"] ?? 60)
      ? "text-success"
      : "text-warning";

  const setFollowUp = (days: number) =>
    update.mutate({
      id: l.id,
      version: l.row_version,
      patch: { next_follow_up_at: new Date(Date.now() + days * 864e5).toISOString() },
    });

  return (
    <>
      <Link
        to="/leads"
        className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" /> Leads
      </Link>
      <PageHeader
        title={l.company_name}
        subtitle={`${l.lead_number}${l.legacy_id ? ` · legacy ${l.legacy_id}` : ""} · ${l.contact_name ?? "no contact"}`}
        actions={
          <>
            {!l.archived_at && !l.converted_client_id ? (
              <Button variant="outline" size="sm" onClick={() => setEdit(true)}>
                <Pencil className="size-4" /> Edit
              </Button>
            ) : null}
            {can(role, "leads.assign") && !closed ? (
              <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
                <UserCog className="size-4" /> Reassign
              </Button>
            ) : null}
            {can(role, "leads.archive") ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => archive.mutate({ id: l.id, restore: !!l.archived_at })}
              >
                <Archive className="size-4" /> {l.archived_at ? "Restore" : "Archive"}
              </Button>
            ) : null}
            {!closed && !l.archived_at ? (
              <Button size="sm" onClick={() => setConvertOpen(true)}>
                <Trophy className="size-4" /> Convert to client
              </Button>
            ) : null}
            {l.converted_client_id ? (
              <Button size="sm" asChild>
                <Link to="/clients/$clientId" params={{ clientId: l.converted_client_id }}>
                  View client & handover
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      {l.archived_at ? (
        <p
          role="status"
          className="mb-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm"
        >
          This lead is archived and read-only.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <SectionCard title="Overview">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Stage</dt>
              <dd>
                {closed || l.archived_at ? (
                  <StatusPill value={l.stage} />
                ) : (
                  <SelectBox
                    value={l.stage}
                    onChange={(v) =>
                      cfg?.stages.find((s) => s.key === v)?.is_lost
                        ? setLostOpen(true)
                        : move.mutate({ id: l.id, stage: v, version: l.row_version })
                    }
                    options={stageOpts}
                    className="h-8 w-40"
                    ariaLabel="Change stage"
                  />
                )}
              </dd>
              <dt className="text-muted-foreground">Priority</dt>
              <dd>
                <PriorityPill value={l.priority} />
              </dd>
              <dt className="text-muted-foreground">Owner</dt>
              <dd>{userName(l.owner_id)}</dd>
              <dt className="text-muted-foreground">Value</dt>
              <dd>{money(l.estimated_value, l.currency)}</dd>
              <dt className="text-muted-foreground">Probability</dt>
              <dd>
                {l.probability ?? "—"}
                {l.probability != null ? "%" : ""}
              </dd>
              <dt className="text-muted-foreground">Source</dt>
              <dd>{cfg?.sources.find((s) => s.id === l.lead_source_id)?.name ?? "—"}</dd>
              <dt className="text-muted-foreground">Service</dt>
              <dd>{cfg?.services.find((s) => s.id === l.service_id)?.name ?? "—"}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="break-all">{l.email ?? "—"}</dd>
              <dt className="text-muted-foreground">Phone</dt>
              <dd>{l.phone ?? "—"}</dd>
              <dt className="text-muted-foreground">Decision maker</dt>
              <dd>{l.decision_maker ?? "—"}</dd>
              <dt className="text-muted-foreground">Last contact</dt>
              <dd>{date(l.last_contacted_at)}</dd>
              <dt className="text-muted-foreground">Next follow-up</dt>
              <dd
                className={
                  l.next_follow_up_at && new Date(l.next_follow_up_at) < new Date() && !closed
                    ? "font-medium text-destructive"
                    : ""
                }
              >
                {date(l.next_follow_up_at)}
              </dd>
            </dl>
            {!closed && !l.archived_at ? (
              <div className="mt-3 flex flex-wrap items-center gap-1 text-xs">
                <span className="text-muted-foreground">Schedule follow-up in</span>
                {FOLLOW_UP_DAYS.map((d) => (
                  <Button
                    key={d}
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    disabled={update.isPending}
                    onClick={() => setFollowUp(d)}
                  >
                    {d}d
                  </Button>
                ))}
              </div>
            ) : null}
          </SectionCard>
          <SectionCard title="Qualification">
            <p className={`font-display text-2xl font-semibold ${scoreTone}`}>
              {qualification.score}
              <span className="text-sm text-muted-foreground"> / 100</span>
            </p>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary" style={{ width: `${qualification.score}%` }} />
            </div>
            {qualification.missing.length ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Missing: {qualification.missing.map((m) => label(m)).join(", ")}
              </p>
            ) : (
              <p className="mt-2 text-xs text-success">All criteria met.</p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Minimum {String(cfg?.settings["qualification.min_score"] ?? 60)} to reach Qualified or
              later stages.
            </p>
            {l.qualification_notes ? <p className="mt-2 text-sm">{l.qualification_notes}</p> : null}
          </SectionCard>
        </div>

        <div className="lg:col-span-2">
          <Tabs defaultValue="timeline">
            <TabsList>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="tasks">Tasks ({tasks.length})</TabsTrigger>
              <TabsTrigger value="proposals">Proposals ({proposals.length})</TabsTrigger>
              <TabsTrigger value="owners">Ownership</TabsTrigger>
            </TabsList>
            <TabsContent value="timeline" className="mt-3">
              <div className="mb-3 flex gap-2">
                <Input
                  placeholder="Quick note…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  aria-label="Quick note"
                />
                <Button
                  variant="outline"
                  disabled={!note.trim() || logAct.isPending}
                  onClick={() =>
                    logAct.mutate(
                      {
                        request_id: crypto.randomUUID(),
                        lead_id: l.id,
                        activity_type: "note",
                        subject: note.trim().slice(0, 120),
                        user_id: profile!.id,
                      },
                      { onSuccess: () => setNote("") },
                    )
                  }
                >
                  Add note
                </Button>
                <Button onClick={() => setActOpen(true)} disabled={!!l.archived_at}>
                  Log activity
                </Button>
              </div>
              {timeline.length === 0 ? (
                <EmptyState message="No activity yet." />
              ) : (
                <ol className="space-y-3 border-l border-border pl-4">
                  {timeline.map((t, i) => (
                    <li key={i} className="relative">
                      <span
                        className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full ${t.kind === "stage" ? "bg-primary" : "bg-muted-foreground"}`}
                      />
                      <p className="text-sm font-medium">{t.title}</p>
                      {t.body ? <p className="text-sm text-muted-foreground">{t.body}</p> : null}
                      <p className="text-[11px] text-muted-foreground">
                        {t.who} · {dateTime(t.at)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </TabsContent>
            <TabsContent value="tasks" className="mt-3">
              <Button
                size="sm"
                className="mb-3"
                onClick={() => setTaskOpen(true)}
                disabled={!!l.archived_at}
              >
                New task
              </Button>
              {tasks.length === 0 ? (
                <EmptyState message="No tasks linked to this lead." />
              ) : (
                <ul className="space-y-2">
                  {tasks.map((t) => (
                    <li
                      key={t.id}
                      className="surface flex items-center justify-between gap-2 p-3 text-sm"
                    >
                      <div>
                        <p
                          className={
                            t.status === "completed" ? "line-through opacity-60" : "font-medium"
                          }
                        >
                          {t.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {userName(t.assigned_to)} · due {date(t.due_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <PriorityPill value={t.priority} />
                        {t.status !== "completed" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={updateTask.isPending}
                            onClick={() =>
                              updateTask.mutate({ id: t.id, patch: { status: "completed" } })
                            }
                          >
                            Complete
                          </Button>
                        ) : (
                          <StatusPill value="completed" />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
            <TabsContent value="proposals" className="mt-3">
              <Button
                size="sm"
                className="mb-3"
                onClick={() => setPropOpen(true)}
                disabled={!!l.archived_at}
              >
                New proposal
              </Button>
              {proposals.length === 0 ? (
                <EmptyState message="No proposals yet." />
              ) : (
                <ul className="space-y-2">
                  {proposals.map((p) => (
                    <li
                      key={p.id}
                      className="surface flex items-center justify-between p-3 text-sm"
                    >
                      <div>
                        <p className="font-medium">
                          {p.proposal_number} · v{p.version} — {p.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {p.sent_at
                            ? `Sent ${dateTime(p.sent_at)} · follow up by ${dateTime(p.followup_due_at)}`
                            : "Not sent"}
                        </p>
                      </div>
                      <div className="text-right">
                        <StatusPill value={p.status} />
                        <p className="mt-1 text-xs">{money(p.amount)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
            <TabsContent value="owners" className="mt-3">
              <ul className="space-y-2 text-sm">
                {assignments.map((a) => (
                  <li key={a.id} className="surface p-3">
                    <span className="font-medium">{userName(a.assigned_to)}</span>{" "}
                    <span className="text-muted-foreground">
                      from {dateTime(a.assigned_at)}
                      {a.unassigned_at ? ` to ${dateTime(a.unassigned_at)}` : " (current)"}
                      {a.assigned_by ? ` · by ${userName(a.assigned_by)}` : ""}
                      {a.reason ? ` · ${a.reason}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <LeadFormDialog
        open={edit}
        onOpenChange={setEdit}
        title="Edit lead"
        initial={leadToForm(l)}
        submitting={update.isPending}
        onSubmit={(v) =>
          update.mutate(
            { id: l.id, version: l.row_version, patch: formToPatch(v, { includeOwner: false }) },
            { onSuccess: () => setEdit(false) },
          )
        }
      />

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign lead</DialogTitle>
          </DialogHeader>
          <SelectBox
            value={assignTo}
            onChange={setAssignTo}
            options={userOptions(dir?.list)}
            placeholder="Select a person"
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            Mentors can only reassign within their own team; the database enforces this.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!assignTo || assign.isPending}
              onClick={() =>
                assign.mutate({ id: l.id, to: assignTo }, { onSuccess: () => setAssignOpen(false) })
              }
            >
              Reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as lost</DialogTitle>
          </DialogHeader>
          <SelectBox
            value={lostReason}
            onChange={setLostReason}
            options={(cfg?.lostReasons ?? [])
              .filter((r) => r.is_active)
              .map((r) => ({ value: r.id, label: r.label ?? "" }))}
            placeholder="Select a lost reason"
            className="w-full"
          />
          <Textarea
            placeholder="Optional note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!lostReason || move.isPending}
              onClick={() =>
                move.mutate(
                  {
                    id: l.id,
                    stage: stage?.is_lost
                      ? l.stage
                      : (cfg?.stages.find((s) => s.is_lost)?.key ?? "lost"),
                    lostReasonId: lostReason,
                    note,
                    version: l.row_version,
                  },
                  {
                    onSuccess: () => {
                      setLostOpen(false);
                      setNote("");
                    },
                  },
                )
              }
            >
              Mark lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecordDialog
        open={actOpen}
        onOpenChange={setActOpen}
        title="Log activity"
        submitting={logAct.isPending}
        initial={{ activity_type: "call" }}
        fields={[
          {
            name: "activity_type",
            label: "Type",
            type: "select",
            options: ACTIVITY_TYPES,
            required: true,
          },
          { name: "subject", label: "Subject" },
          { name: "description", label: "Discussion summary", type: "textarea" },
          { name: "outcome", label: "Outcome" },
          { name: "next_action", label: "Next action" },
          { name: "next_follow_up_at", label: "Next follow-up", type: "date" },
        ]}
        onSubmit={(v) =>
          logAct.mutate(
            {
              request_id: rid,
              lead_id: l.id,
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
                setActOpen(false);
                setRid(crypto.randomUUID());
              },
            },
          )
        }
      />

      <RecordDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        title="New task"
        submitting={createTask.isPending}
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
          createTask.mutate(
            {
              request_id: rid,
              title: v["title"] ?? "",
              description: v["description"] ?? "",
              priority: v["priority"] || "medium",
              assigned_to: v["assigned_to"] || profile!.id,
              lead_id: l.id,
              due_at: v["due_at"] ? new Date(`${v["due_at"]}T17:00:00`).toISOString() : null,
            },
            {
              onSuccess: () => {
                setTaskOpen(false);
                setRid(crypto.randomUUID());
              },
            },
          )
        }
      />

      <RecordDialog
        open={propOpen}
        onOpenChange={setPropOpen}
        title="New proposal"
        submitting={proposal.isPending}
        initial={{
          status: "draft",
          title: `${l.company_name} proposal`,
          amount: String(l.estimated_value ?? ""),
        }}
        fields={[
          { name: "title", required: true, full: true },
          { name: "amount", label: "Amount (INR)", type: "number", required: true },
          { name: "status", type: "select", options: ["draft", "sent"] },
        ]}
        onSubmit={(v) =>
          proposal.mutate(
            {
              title: v["title"] ?? "",
              amount: Number(v["amount"] ?? 0),
              status: v["status"] || "draft",
              version: (proposals[0]?.version ?? 0) + 1,
            },
            { onSuccess: () => setPropOpen(false) },
          )
        }
      />

      <ConvertDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        lead={l}
        services={(cfg?.services ?? []).filter((s) => s.is_active)}
        proposals={proposals}
        pending={convert.isPending}
        onSubmit={(v) =>
          convert.mutate(
            {
              id: l.id,
              value: Number(v["value"]),
              projectName: v["project_name"] ?? "",
              serviceId: v["service_id"] ?? "",
              scope: v["scope"] ?? "",
              paymentTerms: v["payment_terms"] ?? "",
              commitments: v["commitments"] ?? "",
              nextAction: v["next_action"] ?? "",
              startDate: v["start_date"] ?? "",
              targetEnd: v["target_end"] ?? "",
              proposalId: v["proposal_id"] ?? "",
            },
            {
              onSuccess: (r) => {
                setConvertOpen(false);
                toast.success(
                  r.already_converted ? "Already converted" : `Converted — ${r.client_number}`,
                );
                void nav({ to: "/clients/$clientId", params: { clientId: r.client_id } });
              },
            },
          )
        }
      />
    </>
  );
}

function ConvertDialog({
  open,
  onOpenChange,
  lead,
  services,
  proposals,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: { estimated_value: number | null; service_id: string | null; company_name: string };
  services: { id: string; name?: string }[];
  proposals: { id: string; proposal_number: string; version: number }[];
  pending: boolean;
  onSubmit: (v: Record<string, string>) => void;
}) {
  const init = useMemo(
    () => ({ value: String(lead.estimated_value ?? ""), service_id: lead.service_id ?? "" }),
    [lead],
  );
  return (
    <RecordDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Convert to client (mark as Won)"
      description="Creates the client, project and handover in one step. Cannot be done twice."
      submitting={pending}
      initial={init}
      fields={[
        { name: "value", label: "Agreed deal value (INR)", type: "number", required: true },
        {
          name: "service_id",
          label: "Service",
          type: "select",
          options: services.map((s) => ({ value: s.id, label: s.name ?? "" })),
        },
        { name: "project_name", label: "Project name", full: true },
        { name: "scope", label: "Scope", type: "textarea" },
        { name: "payment_terms", label: "Payment terms" },
        { name: "commitments", label: "Key commitments" },
        { name: "start_date", label: "Start date", type: "date" },
        { name: "target_end", label: "Target end date", type: "date" },
        { name: "next_action", label: "Next action", full: true },
        {
          name: "proposal_id",
          label: "Related proposal",
          type: "select",
          options: proposals.map((p) => ({
            value: p.id,
            label: `${p.proposal_number} v${p.version}`,
          })),
        },
      ]}
      onSubmit={onSubmit}
    />
  );
}
