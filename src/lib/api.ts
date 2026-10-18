import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase, unwrap, toError } from "./supabase";
import { useAuth } from "./auth";
import { safeSearch } from "./format";
import type {
  Activity,
  Client,
  DashboardSummary,
  DirectoryUser,
  Lead,
  Lookup,
  Notification,
  Stage,
  Task,
} from "./db-types";

const STALE = 5 * 60_000;
const rpc = async <T>(fn: string, args?: Record<string, unknown>) =>
  unwrap<T>(await supabase.rpc(fn, args as never));

// ───────── configuration & directory ─────────
export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    staleTime: STALE,
    queryFn: async () => {
      const [stages, sources, services, lost, settings] = await Promise.all([
        supabase.from("pipeline_stages").select("*").order("position"),
        supabase.from("lead_sources").select("*").order("position"),
        supabase.from("services").select("*").order("position"),
        supabase.from("lost_reasons").select("*").order("position"),
        supabase.from("app_settings").select("key,value,description").order("key"),
      ]);
      return {
        stages: unwrap(stages) as Stage[],
        sources: unwrap(sources) as Lookup[],
        services: unwrap(services) as Lookup[],
        lostReasons: unwrap(lost) as Lookup[],
        settings: Object.fromEntries(
          (unwrap(settings) as { key: string; value: unknown }[]).map((s) => [s.key, s.value]),
        ) as Record<string, unknown>,
        settingRows: unwrap(settings) as {
          key: string;
          value: unknown;
          description: string | null;
        }[],
      };
    },
  });
}
export function useDirectory() {
  return useQuery({
    queryKey: ["directory"],
    staleTime: STALE,
    queryFn: async () => {
      const list = unwrap(
        await supabase.from("user_directory").select("id,full_name,role").order("full_name"),
      ) as DirectoryUser[];
      return { list, byId: new Map(list.map((u) => [u.id, u])) };
    },
  });
}

// ───────── leads ─────────
export type LeadFilters = {
  search?: string;
  stage?: string;
  priority?: string;
  owner?: string;
  source?: string;
  from?: string;
  to?: string;
  archived?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
  asc?: boolean;
};
export const LEAD_COLUMNS = "*";

export function useLeads(f: LeadFilters) {
  const pageSize = f.pageSize ?? 25,
    page = f.page ?? 0;
  return useQuery({
    queryKey: ["leads", f],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase.from("leads").select(LEAD_COLUMNS, { count: "exact" });
      q = f.archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
      if (f.stage) q = q.eq("stage", f.stage);
      if (f.priority) q = q.eq("priority", f.priority);
      if (f.owner) q = f.owner === "none" ? q.is("owner_id", null) : q.eq("owner_id", f.owner);
      if (f.source) q = q.eq("lead_source_id", f.source);
      if (f.from) q = q.gte("created_at", f.from);
      if (f.to) q = q.lt("created_at", f.to);
      const s = f.search ? safeSearch(f.search) : "";
      if (s)
        q = q.or(
          ["company_name", "contact_name", "email", "phone", "lead_number", "legacy_id"]
            .map((c) => `${c}.ilike.%${s}%`)
            .join(","),
        );
      q = q
        .order(f.sort ?? "created_at", { ascending: f.asc ?? false })
        .range(page * pageSize, page * pageSize + pageSize - 1);
      const res = await q;
      if (res.error) throw toError(res.error);
      return { rows: (res.data ?? []) as unknown as Lead[], total: res.count ?? 0 };
    },
  });
}
export const KANBAN_LIMIT = 400;
export function useKanbanLeads(owner?: string) {
  return useQuery({
    queryKey: ["leads", "kanban", owner ?? ""],
    queryFn: async () => {
      let q = supabase.from("leads").select("*", { count: "exact" }).is("archived_at", null);
      if (owner) q = q.eq("owner_id", owner);
      const res = await q.order("updated_at", { ascending: false }).limit(KANBAN_LIMIT);
      if (res.error) throw toError(res.error);
      return { rows: (res.data ?? []) as unknown as Lead[], total: res.count ?? 0 };
    },
  });
}
export function useLead(id: string) {
  return useQuery({
    queryKey: ["lead", id],
    queryFn: async () => {
      const [lead, activities, history, assignments, tasks, proposals, qual] = await Promise.all([
        supabase.from("leads").select("*").eq("id", id).maybeSingle(),
        supabase
          .from("activities")
          .select("*")
          .eq("lead_id", id)
          .order("occurred_at", { ascending: false })
          .limit(100),
        supabase
          .from("lead_stage_history")
          .select("*")
          .eq("lead_id", id)
          .order("changed_at", { ascending: false }),
        supabase
          .from("lead_assignments")
          .select("*")
          .eq("lead_id", id)
          .order("assigned_at", { ascending: false }),
        supabase
          .from("tasks")
          .select("*")
          .eq("lead_id", id)
          .order("due_at", { ascending: true, nullsFirst: false }),
        supabase
          .from("proposals")
          .select("*")
          .eq("lead_id", id)
          .order("version", { ascending: false }),
        supabase.rpc("lead_qualification", { p_lead: id }),
      ]);
      const l = unwrap(lead) as unknown as Lead | null;
      if (!l) return null;
      return {
        lead: l,
        activities: unwrap(activities) as unknown as Activity[],
        history: unwrap(history) as {
          id: string;
          from_stage: string | null;
          to_stage: string;
          actor_id: string | null;
          changed_at: string;
          note: string | null;
        }[],
        assignments: unwrap(assignments) as {
          id: string;
          assigned_to: string;
          assigned_by: string | null;
          assigned_at: string;
          unassigned_at: string | null;
          reason: string | null;
        }[],
        tasks: unwrap(tasks) as unknown as Task[],
        proposals: unwrap(proposals) as {
          id: string;
          proposal_number: string;
          version: number;
          title: string;
          amount: number;
          status: string;
          sent_at: string | null;
          followup_due_at: string | null;
        }[],
        qualification: unwrap(qual) as { score: number; missing: string[] },
      };
    },
  });
}

/** Mutation helper: toast on error, invalidate listed keys on success. */
function useAction<TArgs, TOut>(
  fn: (a: TArgs) => Promise<TOut>,
  invalidate: string[][],
  success?: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      invalidate.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      if (success) toast.success(success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
const LEAD_KEYS = [["leads"], ["lead"], ["dashboard"], ["notifications"]];

export function useCreateLead() {
  const { profile } = useAuth();
  return useAction(
    async (v: Partial<Lead> & { request_id: string }) => {
      const row = { ...v, owner_id: v.owner_id ?? profile?.id };
      return unwrap(
        await supabase
          .from("leads")
          .insert(row as never)
          .select("id,lead_number")
          .single(),
      ) as { id: string; lead_number: string };
    },
    LEAD_KEYS,
    "Lead created",
  );
}
/** Update with optimistic-concurrency: fails if someone else changed the row since it was loaded. */
export function useUpdateLead() {
  return useAction(
    async ({ id, version, patch }: { id: string; version: number; patch: Partial<Lead> }) => {
      const res = await supabase
        .from("leads")
        .update(patch as never)
        .eq("id", id)
        .eq("row_version", version)
        .select("id");
      const rows = unwrap(res) as { id: string }[];
      if (rows.length === 0)
        throw new Error(
          "This lead was changed by someone else (or you no longer have access). Reload and try again.",
        );
    },
    LEAD_KEYS,
    "Lead updated",
  );
}
export function useMoveStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: {
      id: string;
      stage: string;
      note?: string;
      lostReasonId?: string;
      version?: number;
    }) =>
      rpc<number>("move_lead_stage", {
        p_lead_id: a.id,
        p_to_stage: a.stage,
        p_note: a.note ?? null,
        p_lost_reason_id: a.lostReasonId ?? null,
        p_expected_version: a.version ?? null,
      }),
    // optimistic update for kanban; rolled back on failure
    onMutate: async (a) => {
      await qc.cancelQueries({ queryKey: ["leads", "kanban"] });
      const prev = qc.getQueriesData<{ rows: Lead[]; total: number }>({
        queryKey: ["leads", "kanban"],
      });
      qc.setQueriesData<{ rows: Lead[]; total: number }>(
        { queryKey: ["leads", "kanban"] },
        (d) =>
          d && { ...d, rows: d.rows.map((l) => (l.id === a.id ? { ...l, stage: a.stage } : l)) },
      );
      return { prev };
    },
    onError: (e: Error, _a, ctx) => {
      ctx?.prev.forEach(([k, d]) => qc.setQueryData(k, d));
      toast.error(e.message);
    },
    onSettled: () => LEAD_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k })),
    onSuccess: () => toast.success("Stage updated"),
  });
}
export const useAssignLead = () =>
  useAction(
    (a: { id: string; to: string; reason?: string }) =>
      rpc("assign_lead", { p_lead_id: a.id, p_assignee: a.to, p_reason: a.reason ?? null }),
    LEAD_KEYS,
    "Lead assigned",
  );
export const useArchiveLead = () =>
  useAction(
    (a: { id: string; restore?: boolean }) =>
      rpc("archive_lead", { p_lead_id: a.id, p_restore: a.restore ?? false }),
    LEAD_KEYS,
    "Lead updated",
  );
export type ConvertArgs = {
  id: string;
  value?: number;
  projectName?: string;
  serviceId?: string;
  scope?: string;
  paymentTerms?: string;
  commitments?: string;
  nextAction?: string;
  startDate?: string;
  targetEnd?: string;
  proposalId?: string;
};
export const useConvertLead = () =>
  useAction(
    (a: ConvertArgs) =>
      rpc<{ client_id: string; client_number: string; already_converted: boolean }>(
        "convert_lead_to_client",
        {
          p_lead_id: a.id,
          p_agreed_value: a.value ?? null,
          p_project_name: a.projectName || null,
          p_service_id: a.serviceId || null,
          p_scope: a.scope || null,
          p_payment_terms: a.paymentTerms || null,
          p_commitments: a.commitments || null,
          p_next_action: a.nextAction || null,
          p_start_date: a.startDate || null,
          p_target_end_date: a.targetEnd || null,
          p_proposal_id: a.proposalId || null,
        },
      ),
    [...LEAD_KEYS, ["clients"]],
  );
export const findDuplicates = (a: {
  email?: string;
  phone?: string;
  company?: string;
  website?: string;
  exclude?: string;
}) =>
  rpc<
    { lead_number: string; company_name: string; owner_name: string | null; match_reason: string }[]
  >("find_duplicate_leads", {
    p_email: a.email || null,
    p_phone: a.phone || null,
    p_company: a.company || null,
    p_website: a.website || null,
    p_exclude: a.exclude ?? null,
  });

// ───────── activities / tasks ─────────
export function useActivities(p: {
  page: number;
  type?: string;
  user?: string;
  pageSize?: number;
}) {
  const size = p.pageSize ?? 25;
  return useQuery({
    queryKey: ["activities", p],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase
        .from("activities")
        .select("*, lead:leads(company_name,lead_number)", { count: "exact" });
      if (p.type) q = q.eq("activity_type", p.type);
      if (p.user) q = q.eq("user_id", p.user);
      const res = await q
        .order("occurred_at", { ascending: false })
        .range(p.page * size, p.page * size + size - 1);
      if (res.error) throw toError(res.error);
      return { rows: (res.data ?? []) as unknown as Activity[], total: res.count ?? 0 };
    },
  });
}
export const useCreateActivity = () =>
  useAction(
    async (v: {
      request_id: string;
      lead_id?: string;
      client_id?: string;
      activity_type: string;
      subject?: string;
      description?: string;
      outcome?: string;
      next_action?: string;
      next_follow_up_at?: string | null;
      occurred_at?: string;
      user_id: string;
    }) => unwrap(await supabase.from("activities").insert(v as never)),
    [["activities"], ["lead"], ["leads"], ["dashboard"]],
    "Activity logged",
  );

export function useTasks(p: { scope: "mine" | "all"; status?: string; userId?: string }) {
  return useQuery({
    queryKey: ["tasks", p],
    queryFn: async () => {
      let q = supabase.from("tasks").select("*, lead:leads(company_name)");
      if (p.scope === "mine" && p.userId) q = q.eq("assigned_to", p.userId);
      if (p.status === "open") q = q.in("status", ["todo", "in_progress"]);
      else if (p.status) q = q.eq("status", p.status);
      const res = await q.order("due_at", { ascending: true, nullsFirst: false }).limit(500);
      if (res.error) throw toError(res.error);
      return (res.data ?? []) as unknown as Task[];
    },
  });
}
export const useCreateTask = () =>
  useAction(
    async (v: {
      request_id: string;
      title: string;
      description?: string;
      priority?: string;
      assigned_to: string;
      lead_id?: string;
      due_at?: string | null;
    }) => unwrap(await supabase.from("tasks").insert(v as never)),
    [["tasks"], ["lead"], ["dashboard"]],
    "Task created",
  );
export const useUpdateTask = () =>
  useAction(
    async (a: {
      id: string;
      patch: Partial<
        Pick<Task, "status" | "title" | "description" | "priority" | "due_at" | "assigned_to">
      >;
    }) => {
      const rows = unwrap(
        await supabase
          .from("tasks")
          .update(a.patch as never)
          .eq("id", a.id)
          .select("id"),
      ) as unknown[];
      if (!rows.length) throw new Error("Task not found or you cannot change it.");
    },
    [["tasks"], ["lead"], ["dashboard"], ["actions"]],
  );
export function useTaskComments(taskId: string | null) {
  return useQuery({
    queryKey: ["task-comments", taskId],
    enabled: !!taskId,
    queryFn: async () =>
      unwrap(
        await supabase.from("task_comments").select("*").eq("task_id", taskId!).order("created_at"),
      ) as { id: string; author_id: string; content: string; created_at: string }[],
  });
}
export const useAddComment = () =>
  useAction(
    async (a: { task_id: string; author_id: string; content: string }) =>
      unwrap(await supabase.from("task_comments").insert(a)),
    [["task-comments"]],
  );

// ───────── clients ─────────
export const useClients = () =>
  useQuery({
    queryKey: ["clients"],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("clients")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(500),
      ) as unknown as Client[],
  });
export function useClient(id: string) {
  return useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const [c, h] = await Promise.all([
        supabase.from("clients").select("*").eq("id", id).maybeSingle(),
        supabase.rpc("client_handover", { p_client_id: id }),
      ]);
      return {
        client: unwrap(c) as unknown as Client | null,
        handover: unwrap(h) as Record<string, unknown> | null,
      };
    },
  });
}

// ───────── dashboard, reports, notifications ─────────
export function useDashboard(from: string, to: string, scope: "visible" | "mine") {
  return useQuery({
    queryKey: ["dashboard", from, to, scope],
    queryFn: () =>
      rpc<DashboardSummary>("dashboard_summary", { p_from: from, p_to: to, p_scope: scope }),
  });
}
export const useReport = <T>(name: string, args: Record<string, unknown>, enabled = true) =>
  useQuery({ queryKey: ["report", name, args], enabled, queryFn: () => rpc<T[]>(name, args) });
export const useActionItems = () =>
  useQuery({
    queryKey: ["actions"],
    queryFn: () =>
      rpc<
        {
          kind: string;
          id: string;
          title: string;
          due_at: string;
          is_overdue: boolean;
          lead_id: string | null;
        }[]
      >("my_action_items"),
  });
export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("notifications")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50),
      ) as Notification[],
  });
}
export const useMarkRead = () =>
  useAction(
    async (ids?: string[]) => {
      let q = supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .is("read_at", null);
      if (ids) q = q.in("id", ids);
      unwrap(await q);
    },
    [["notifications"]],
  );
