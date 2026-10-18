import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Download, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  PriorityPill,
  StatusPill,
} from "@/components/crm/ui-bits";
import { Pager, SelectBox, userOptions, useUserName } from "@/components/crm/controls";
import { LeadFormDialog, formToPatch, leadToForm } from "@/components/crm/lead-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import {
  KANBAN_LIMIT,
  findDuplicates,
  useAssignLead,
  useConfig,
  useCreateLead,
  useDirectory,
  useKanbanLeads,
  useLeads,
  useMoveStage,
  type LeadFilters,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { date, downloadCsv, isOverdue, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import type { Lead } from "@/lib/db-types";

export const Route = createFileRoute("/leads")({
  head: () => ({ meta: [{ title: "Leads — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <LeadsPage />
    </AppShell>
  ),
});

function LeadsPage() {
  const { role, profile } = useAuth();
  const nav = useNavigate();
  const { data: cfg } = useConfig();
  const { data: dir } = useDirectory();
  const userName = useUserName();
  const [f, setF] = useState<LeadFilters>({ page: 0, sort: "created_at", asc: false });
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("table");
  const [creating, setCreating] = useState(false);
  const [dupes, setDupes] = useState<{
    values: Record<string, string>;
    rows: Awaited<ReturnType<typeof findDuplicates>>;
  } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTo, setBulkTo] = useState("");
  const [lostFor, setLostFor] = useState<{ id: string } | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [exporting, setExporting] = useState(false);

  const leads = useLeads(f);
  const create = useCreateLead();
  const move = useMoveStage();
  const assign = useAssignLead();
  const canAssign = can(role, "leads.assign");
  const stageOpts = (cfg?.stages ?? [])
    .filter((s) => s.is_active)
    .map((s) => ({ value: s.key, label: s.label }));
  const stageLabel = (k: string) => cfg?.stages.find((s) => s.key === k)?.label ?? k;
  const sourceName = (id: string | null) => cfg?.sources.find((s) => s.id === id)?.name ?? "—";
  const set = (patch: Partial<LeadFilters>) => setF((p) => ({ ...p, page: 0, ...patch }));

  const submitCreate = async (values: Record<string, string>, force = false) => {
    if (!force) {
      try {
        const rows = await findDuplicates({
          email: values["email"] ?? "",
          phone: values["phone"] ?? "",
          company: values["company_name"] ?? "",
          website: values["website"] ?? "",
        });
        if (rows.length) return setDupes({ values, rows });
      } catch {
        /* duplicate check is advisory; the DB still enforces integrity */
      }
    }
    const patch = formToPatch(values, { includeOwner: true });
    create.mutate(
      { ...patch, request_id: requestId },
      {
        onSuccess: (r) => {
          setCreating(false);
          setDupes(null);
          setRequestId(crypto.randomUUID());
          void nav({ to: "/leads/$leadId", params: { leadId: r.id } });
        },
      },
    );
  };

  const quickStage = (l: Lead, stage: string) => {
    if (stage === "won")
      return void nav({ to: "/leads/$leadId", params: { leadId: l.id } }).then(() =>
        toast.info("Use “Convert to client” to mark a lead as Won."),
      );
    if (cfg?.stages.find((s) => s.key === stage)?.is_lost) return setLostFor({ id: l.id });
    move.mutate({ id: l.id, stage, version: l.row_version });
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      let q = supabase.from("leads").select("*").is("archived_at", null);
      if (f.stage) q = q.eq("stage", f.stage);
      if (f.owner) q = q.eq("owner_id", f.owner);
      if (f.priority) q = q.eq("priority", f.priority);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(5000);
      if (error) throw error;
      downloadCsv(
        `leads-${new Date().toISOString().slice(0, 10)}.csv`,
        [
          "lead_number",
          "legacy_id",
          "company_name",
          "contact_name",
          "email",
          "phone",
          "stage",
          "priority",
          "estimated_value",
          "owner",
          "next_follow_up_at",
          "created_at",
        ],
        (data ?? []).map((r) => ({ ...r, owner: userName(r.owner_id as string | null) })),
      );
      if ((data ?? []).length === 5000)
        toast.warning("Export limited to the first 5,000 rows — narrow the filters.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const rows = leads.data?.rows ?? [];
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const doBulk = async () => {
    for (const id of selected)
      await assign
        .mutateAsync({ id, to: bulkTo, reason: "Bulk assignment" })
        .catch(() => undefined);
    setSelected(new Set());
    setBulkTo("");
  };

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Track, qualify and convert opportunities"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting}>
              <Download className="size-4" /> {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New lead
            </Button>
          </>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="table">Table</TabsTrigger>
          <TabsTrigger value="kanban">Kanban</TabsTrigger>
        </TabsList>

        <TabsContent value="table" className="mt-3">
          <div className="surface mb-3 flex flex-wrap items-center gap-2 p-3">
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                set({ search });
              }}
            >
              <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input
                aria-label="Search leads"
                className="w-60 pl-8"
                placeholder="Search name, email, phone, ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onBlur={() => search !== (f.search ?? "") && set({ search })}
              />
            </form>
            <SelectBox
              value={f.stage ?? ""}
              onChange={(v) => set({ stage: v })}
              options={stageOpts}
              allLabel="All stages"
            />
            <SelectBox
              value={f.priority ?? ""}
              onChange={(v) => set({ priority: v })}
              options={[
                { value: "high", label: "High" },
                { value: "medium", label: "Medium" },
                { value: "low", label: "Low" },
              ]}
              allLabel="All priorities"
              className="w-36"
            />
            {role !== "bds_employee" ? (
              <SelectBox
                value={f.owner ?? ""}
                onChange={(v) => set({ owner: v })}
                options={[{ value: "none", label: "Unassigned" }, ...userOptions(dir?.list)]}
                allLabel="All owners"
              />
            ) : null}
            <SelectBox
              value={f.source ?? ""}
              onChange={(v) => set({ source: v })}
              options={(cfg?.sources ?? []).map((s) => ({ value: s.id, label: s.name ?? "" }))}
              allLabel="All sources"
              className="w-40"
            />
            <label className="flex items-center gap-1 text-xs">
              From{" "}
              <Input
                type="date"
                className="h-9 w-36"
                aria-label="Created from"
                onChange={(e) =>
                  set({ from: e.target.value ? new Date(e.target.value).toISOString() : "" })
                }
              />
            </label>
            <label className="flex items-center gap-1 text-xs">
              To{" "}
              <Input
                type="date"
                className="h-9 w-36"
                aria-label="Created to"
                onChange={(e) =>
                  set({
                    to: e.target.value
                      ? new Date(new Date(e.target.value).getTime() + 864e5).toISOString()
                      : "",
                  })
                }
              />
            </label>
            {canAssign && selected.size > 0 ? (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs">{selected.size} selected</span>
                <SelectBox
                  value={bulkTo}
                  onChange={setBulkTo}
                  options={userOptions(dir?.list)}
                  placeholder="Assign to…"
                />
                <Button size="sm" disabled={!bulkTo || assign.isPending} onClick={doBulk}>
                  Assign
                </Button>
              </div>
            ) : null}
          </div>
          {leads.isLoading ? (
            <LoadingBlock />
          ) : leads.isError ? (
            <ErrorBlock error={leads.error} onRetry={() => leads.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState message="No leads match these filters." />
          ) : (
            <div className="surface overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {canAssign ? (
                      <TableHead className="w-8">
                        <Checkbox
                          aria-label="Select all"
                          checked={allChecked}
                          onCheckedChange={(c) =>
                            setSelected(c ? new Set(rows.map((r) => r.id)) : new Set())
                          }
                        />
                      </TableHead>
                    ) : null}
                    <TableHead>Lead</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead className="text-right">
                      <button
                        className="font-medium"
                        onClick={() => set({ sort: "estimated_value", asc: !(f.asc ?? false) })}
                      >
                        Value ↕
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        className="font-medium"
                        onClick={() => set({ sort: "next_follow_up_at", asc: true })}
                      >
                        Follow-up ↕
                      </button>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((l) => (
                    <TableRow key={l.id}>
                      {canAssign ? (
                        <TableCell>
                          <Checkbox
                            aria-label={`Select ${l.company_name}`}
                            checked={selected.has(l.id)}
                            onCheckedChange={(c) =>
                              setSelected((s) => {
                                const n = new Set(s);
                                if (c) n.add(l.id);
                                else n.delete(l.id);
                                return n;
                              })
                            }
                          />
                        </TableCell>
                      ) : null}
                      <TableCell className="text-xs text-muted-foreground">
                        {l.lead_number}
                      </TableCell>
                      <TableCell>
                        <Link
                          to="/leads/$leadId"
                          params={{ leadId: l.id }}
                          className="font-medium hover:underline"
                        >
                          {l.company_name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{l.contact_name}</div>
                      </TableCell>
                      <TableCell>
                        {l.converted_client_id ? (
                          <StatusPill value={l.stage} />
                        ) : (
                          <SelectBox
                            value={l.stage}
                            onChange={(v) => quickStage(l, v)}
                            options={stageOpts}
                            className="h-8 w-40 text-xs"
                            ariaLabel={`Stage for ${l.company_name}`}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <PriorityPill value={l.priority} />
                      </TableCell>
                      <TableCell className="text-xs">{sourceName(l.lead_source_id)}</TableCell>
                      <TableCell className="text-xs">{userName(l.owner_id)}</TableCell>
                      <TableCell className="text-right text-xs">
                        {money(l.estimated_value, l.currency)}
                      </TableCell>
                      <TableCell
                        className={
                          isOverdue(l.next_follow_up_at) && !["won", "lost"].includes(l.stage)
                            ? "text-xs font-medium text-destructive"
                            : "text-xs"
                        }
                      >
                        {date(l.next_follow_up_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Pager
            page={f.page ?? 0}
            total={leads.data?.total ?? 0}
            onPage={(p) => setF((x) => ({ ...x, page: p }))}
          />
        </TabsContent>

        <TabsContent value="kanban" className="mt-3">
          <Kanban
            owner={role === "bds_employee" ? profile?.id : f.owner}
            stages={cfg?.stages ?? []}
            onMove={quickStage}
          />
        </TabsContent>
      </Tabs>

      <LeadFormDialog
        open={creating}
        onOpenChange={setCreating}
        title="New lead"
        initial={leadToForm(null)}
        allowOwner
        submitting={create.isPending}
        onSubmit={(v) => submitCreate(v)}
      />

      <AlertDialog open={!!dupes} onOpenChange={(o) => !o && setDupes(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Possible duplicate</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>
                  Similar leads already exist. Coordinate with the owner before creating another:
                </p>
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {dupes?.rows.map((d) => (
                    <li key={d.lead_number}>
                      {d.lead_number} — {d.company_name} ({d.match_reason}; owner:{" "}
                      {d.owner_name ?? "unassigned"})
                    </li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={() => dupes && submitCreate(dupes.values, true)}>
              Create anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!lostFor} onOpenChange={(o) => !o && setLostFor(null)}>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={!lostReason || move.isPending}
              onClick={() => {
                if (lostFor)
                  move.mutate(
                    {
                      id: lostFor.id,
                      stage: cfg?.stages.find((s) => s.is_lost)?.key ?? "lost",
                      lostReasonId: lostReason,
                    },
                    {
                      onSuccess: () => {
                        setLostFor(null);
                        setLostReason("");
                      },
                    },
                  );
              }}
            >
              Mark lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Kanban({
  owner,
  stages,
  onMove,
}: {
  owner: string | undefined;
  stages: { key: string; label: string; is_active: boolean; position: number }[];
  onMove: (l: Lead, stage: string) => void;
}) {
  const { data, isLoading, isError, error, refetch } = useKanbanLeads(owner || undefined);
  const userName = useUserName();
  const [over, setOver] = useState<string | null>(null);
  const cols = useMemo(
    () => stages.filter((s) => s.is_active).sort((a, b) => a.position - b.position),
    [stages],
  );
  const byStage = useMemo(() => {
    const m = new Map<string, Lead[]>();
    (data?.rows ?? []).forEach((l) => m.set(l.stage, [...(m.get(l.stage) ?? []), l]));
    return m;
  }, [data]);
  if (isLoading) return <LoadingBlock />;
  if (isError) return <ErrorBlock error={error} onRetry={() => refetch()} />;
  return (
    <>
      {(data?.total ?? 0) > KANBAN_LIMIT ? (
        <p className="mb-2 text-xs text-warning">
          Showing the {KANBAN_LIMIT} most recently updated of {data?.total} leads. Use the table for
          the full list.
        </p>
      ) : null}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {cols.map((c) => (
          <section
            key={c.key}
            aria-label={c.label}
            className={`w-64 shrink-0 rounded-lg border bg-muted/40 p-2 ${over === c.key ? "border-primary bg-primary/5" : "border-border"}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(c.key);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const l = data?.rows.find((x) => x.id === e.dataTransfer.getData("text/plain"));
              if (l && l.stage !== c.key) onMove(l, c.key);
            }}
          >
            <h3 className="mb-2 flex justify-between px-1 text-xs font-semibold">
              {c.label}
              <span className="text-muted-foreground">{byStage.get(c.key)?.length ?? 0}</span>
            </h3>
            <div className="space-y-2">
              {(byStage.get(c.key) ?? []).map((l) => (
                <article
                  key={l.id}
                  draggable={!l.converted_client_id}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)}
                  className="surface cursor-grab p-2.5 text-sm active:cursor-grabbing"
                >
                  <Link
                    to="/leads/$leadId"
                    params={{ leadId: l.id }}
                    className="font-medium hover:underline"
                  >
                    {l.company_name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {l.contact_name} · {userName(l.owner_id)}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <PriorityPill value={l.priority} />
                    <span className="text-xs">{money(l.estimated_value, l.currency)}</span>
                  </div>
                  {!l.converted_client_id ? (
                    <SelectBox
                      value={l.stage}
                      onChange={(v) => onMove(l, v)}
                      options={cols.map((s) => ({ value: s.key, label: s.label }))}
                      className="mt-2 h-7 w-full text-xs"
                      ariaLabel={`Move ${l.company_name} to stage`}
                    />
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
