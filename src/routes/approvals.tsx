import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  StatusPill,
} from "@/components/crm/ui-bits";
import { useUserName } from "@/components/crm/controls";
import { RecordDialog } from "@/components/crm/record-dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { supabase, unwrap } from "@/lib/supabase";
import { can } from "@/lib/permissions";
import { dateTime, label } from "@/lib/format";

export const Route = createFileRoute("/approvals")({
  head: () => ({ meta: [{ title: "Approvals — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <Page />
    </AppShell>
  ),
});
type A = {
  id: string;
  request_type: string;
  reason: string | null;
  status: string;
  requested_by: string;
  decision_note: string | null;
  created_at: string;
};

function Page() {
  const { profile, role } = useAuth();
  const qc = useQueryClient();
  const userName = useUserName();
  const q = useQuery({
    queryKey: ["approvals"],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("approval_requests")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
      ) as A[],
  });
  const [open, setOpen] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["approvals"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const err = (e: Error) => toast.error(e.message);
  const create = useMutation({
    mutationFn: async (v: Record<string, string>) =>
      unwrap(
        await supabase.from("approval_requests").insert({
          request_type: v["request_type"] || "mentor_support",
          reason: v["reason"],
          requested_by: profile!.id,
        }),
      ),
    onSuccess: () => {
      setOpen(false);
      refresh();
      toast.success("Request sent");
    },
    onError: err,
  });
  const decide = useMutation({
    mutationFn: async (a: { id: string; ok: boolean }) =>
      unwrap(await supabase.rpc("decide_approval", { p_id: a.id, p_approve: a.ok })),
    onSuccess: () => {
      refresh();
      toast.success("Decision recorded");
    },
    onError: err,
  });
  const cancel = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await supabase.from("approval_requests").update({ status: "cancelled" }).eq("id", id)),
    onSuccess: refresh,
    onError: err,
  });
  const types =
    role === "admin"
      ? ["mentor_support", "escalation", "discount_exception", "deletion", "restricted_change"]
      : ["mentor_support", "escalation", "discount_exception", "deletion"];
  return (
    <>
      <PageHeader
        title="Approvals & escalations"
        subtitle="Request mentor help, escalate an opportunity, or ask for an exception"
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            New request
          </Button>
        }
      />
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState message="No requests." />
      ) : (
        <ul className="space-y-2">
          {(q.data ?? []).map((a) => (
            <li
              key={a.id}
              className="surface flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {label(a.request_type)} <StatusPill value={a.status} />
                </p>
                <p className="text-muted-foreground">{a.reason}</p>
                <p className="text-[11px] text-muted-foreground">
                  {userName(a.requested_by)} · {dateTime(a.created_at)}
                  {a.decision_note ? ` · ${a.decision_note}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                {a.status === "pending" &&
                a.requested_by !== profile?.id &&
                can(role, "approvals.decide") ? (
                  <>
                    <Button size="sm" onClick={() => decide.mutate({ id: a.id, ok: true })}>
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => decide.mutate({ id: a.id, ok: false })}
                    >
                      Reject
                    </Button>
                  </>
                ) : null}
                {a.status === "pending" && a.requested_by === profile?.id ? (
                  <Button size="sm" variant="ghost" onClick={() => cancel.mutate(a.id)}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title="New request"
        submitting={create.isPending}
        initial={{ request_type: "mentor_support" }}
        fields={[
          {
            name: "request_type",
            label: "Type",
            type: "select",
            options: types.map((t) => ({ value: t, label: label(t) })),
          },
          { name: "reason", type: "textarea", required: true },
        ]}
        onSubmit={(v) => create.mutate(v)}
      />
    </>
  );
}
