import { useMemo, useState } from "react";
import { Plane } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  SectionCard,
  StatusPill,
} from "@/components/crm/ui-bits";
import { useUserName } from "@/components/crm/controls";
import { RecordDialog } from "@/components/crm/record-dialog";
import { date as fmtDate } from "@/lib/format";
import {
  LEAVE_TYPES,
  useAttendanceAction,
  useLeaveApprovers,
  useLeaveBalance,
  useLeaveRequests,
  type LeaveRequest,
} from "@/lib/attendance";

const typeLabel = (v: string) => LEAVE_TYPES.find((t) => t.value === v)?.label ?? v;
const span = (l: LeaveRequest) =>
  l.start_date === l.end_date
    ? fmtDate(l.start_date)
    : `${fmtDate(l.start_date)} – ${fmtDate(l.end_date)}`;

/** Leave lives on the Attendance page. Routing (employee→mentor, mentor→admin) and who may decide are
 *  enforced in Postgres (request_leave / decide_leave_request / RLS); this only renders and calls them. */
export function LeavePanel({
  me,
  isAdmin,
  today,
}: {
  me: string;
  isAdmin: boolean;
  today: string;
}) {
  const userName = useUserName();
  const q = useLeaveRequests();
  const approvers = useLeaveApprovers();
  const balance = useLeaveBalance();
  const [applying, setApplying] = useState(false);
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);

  const apply = useAttendanceAction(
    "request_leave",
    "Leave request sent",
    (v: Record<string, string>) => ({
      p_type: v["leave_type"],
      p_start: v["start_date"],
      p_end: v["end_date"],
      p_reason: v["reason"],
      p_half: v["half_day"] === "yes",
    }),
  );
  const decide = useAttendanceAction(
    "decide_leave_request",
    "Decision recorded",
    (a: { id: string; approve: boolean; note?: string }) => ({
      p_id: a.id,
      p_approve: a.approve,
      p_note: a.note ?? null,
    }),
  );
  const cancel = useAttendanceAction("cancel_leave", "Leave cancelled", (id: string) => ({
    p_id: id,
  }));

  const initial = useMemo(
    () => ({
      leave_type: "casual",
      start_date: today,
      end_date: today,
      half_day: "no",
      reason: "",
    }),
    [today],
  );
  const all = q.data ?? [];
  const mine = all.filter((l) => l.user_id === me);
  const others = all
    .filter((l) => l.user_id !== me)
    .sort((a, b) => Number(b.can_decide) - Number(a.can_decide));
  const canCancel = (l: LeaveRequest) =>
    l.user_id === me &&
    (l.status === "pending" || (l.status === "approved" && l.start_date > today));

  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <div className="space-y-4">
      {!isAdmin ? (
        <SectionCard
          title="My leave"
          action={
            <Button size="sm" onClick={() => setApplying(true)}>
              <Plane className="size-4" /> Apply for leave
            </Button>
          }
        >
          <p className="mb-3 text-xs text-muted-foreground">
            {approvers.data?.length
              ? `Your requests are reviewed by ${approvers.data.map((a) => a.full_name || "Unnamed").join(" or ")}.`
              : "Checking who reviews your requests…"}{" "}
            You are notified when they decide.
          </p>
          {(balance.data ?? []).some((b) => b.quota != null) ? (
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              {(balance.data ?? [])
                .filter((b) => b.quota != null)
                .map((b) => (
                  <span key={b.leave_type} className="rounded-full border px-2.5 py-1">
                    <span className="font-medium">{typeLabel(b.leave_type)}</span>: {b.remaining}{" "}
                    left of {b.quota} ({b.used} used{b.pending ? `, ${b.pending} pending` : ""})
                  </span>
                ))}
            </div>
          ) : null}
          {mine.length === 0 ? (
            <EmptyState message="You haven't applied for leave yet." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dates</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mine.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs whitespace-nowrap">{span(l)}</TableCell>
                      <TableCell className="text-xs">{typeLabel(l.leave_type)}</TableCell>
                      <TableCell className="text-xs">
                        {l.days}
                        {l.is_half_day ? " (half)" : ""}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs" title={l.reason}>
                        {l.reason}
                      </TableCell>
                      <TableCell>
                        <StatusPill value={l.status} />
                      </TableCell>
                      <TableCell className="max-w-xs text-xs text-muted-foreground">
                        {l.decided_by
                          ? `${userName(l.decided_by)}${l.decision_note ? ` — ${l.decision_note}` : ""}`
                          : l.status === "pending"
                            ? "Awaiting review"
                            : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {canCancel(l) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={cancel.isPending}
                            onClick={() => cancel.mutate(l.id)}
                          >
                            Cancel
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      ) : null}

      {isAdmin || others.length > 0 ? (
        <SectionCard title={isAdmin ? "All leave requests" : "Team leave requests"}>
          {others.length === 0 ? (
            <EmptyState message="No leave requests to review." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {others.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs font-medium">{userName(l.user_id)}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{span(l)}</TableCell>
                      <TableCell className="text-xs">{typeLabel(l.leave_type)}</TableCell>
                      <TableCell className="text-xs">{l.days}</TableCell>
                      <TableCell className="max-w-xs truncate text-xs" title={l.reason}>
                        {l.reason}
                      </TableCell>
                      <TableCell>
                        <StatusPill value={l.status} />
                        {l.decided_by ? (
                          <span className="block text-[10px] text-muted-foreground">
                            by {userName(l.decided_by)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="space-x-1 text-right whitespace-nowrap">
                        {l.can_decide ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={decide.isPending}
                              onClick={() => decide.mutate({ id: l.id, approve: true })}
                            >
                              Approve
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRejecting(l)}>
                              Reject
                            </Button>
                          </>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      ) : null}

      <RecordDialog
        open={applying}
        onOpenChange={setApplying}
        title="Apply for leave"
        description="Weekly offs and holidays are not counted. You can cancel a pending request at any time."
        submitting={apply.isPending}
        initial={initial}
        fields={[
          {
            name: "leave_type",
            label: "Type",
            type: "select",
            options: LEAVE_TYPES,
            required: true,
          },
          { name: "start_date", label: "From", type: "date", required: true },
          { name: "end_date", label: "To", type: "date", required: true },
          {
            name: "half_day",
            label: "Half day (single day only)",
            type: "select",
            options: ["no", "yes"],
          },
          { name: "reason", type: "textarea", required: true },
        ]}
        onSubmit={(v) => apply.mutate(v, { onSuccess: () => setApplying(false) })}
      />
      <RecordDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={`Reject leave — ${rejecting ? userName(rejecting.user_id) : ""}`}
        description="Optionally tell them why."
        submitting={decide.isPending}
        fields={[{ name: "note", type: "textarea" }]}
        onSubmit={(v) =>
          rejecting &&
          decide.mutate(
            { id: rejecting.id, approve: false, note: v["note"] ?? "" },
            { onSuccess: () => setRejecting(null) },
          )
        }
      />
    </div>
  );
}
