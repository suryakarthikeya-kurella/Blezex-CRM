import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorBlock, LoadingBlock, StatusPill } from "@/components/crm/ui-bits";
import { useUserName } from "@/components/crm/controls";
import { RecordDialog } from "@/components/crm/record-dialog";
import { date as fmtDate } from "@/lib/format";
import {
  clock,
  clockInput,
  useAttendanceAction,
  useAttendanceSettings,
  useCorrections,
  type AttCorrection,
} from "@/lib/attendance";

export type CorrectionTarget = {
  /** Admin mode: whose day is being corrected. Request mode: the signed-in user. */
  userId: string;
  name: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
};

/** Employee/mentor: ask for a change to their own day. Admin: change anyone's day directly (reason mandatory). */
export function CorrectionDialog({
  mode,
  target,
  onClose,
}: {
  mode: "request" | "admin";
  target: CorrectionTarget | null;
  onClose: () => void;
}) {
  const { tz } = useAttendanceSettings();
  const request = useAttendanceAction(
    "request_attendance_correction",
    "Correction request sent",
    (v: Record<string, string>) => ({
      p_date: v["date"],
      p_check_in: v["check_in"],
      p_check_out: v["check_out"] || null,
      p_reason: v["reason"],
    }),
  );
  const admin = useAttendanceAction(
    "attendance_admin_correct",
    "Attendance corrected",
    (v: Record<string, string>) => ({
      p_user: target?.userId,
      p_date: v["date"],
      p_check_in: v["check_in"],
      p_check_out: v["check_out"] || null,
      p_reason: v["reason"],
    }),
  );
  const m = mode === "admin" ? admin : request;
  // stable identity: RecordDialog re-seeds its fields whenever `initial` changes
  const initial = useMemo(
    () => ({
      date: target?.date ?? "",
      check_in: clockInput(target?.checkIn, tz),
      check_out: clockInput(target?.checkOut, tz),
      reason: "",
    }),
    [target, tz],
  );
  return (
    <RecordDialog
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={
        mode === "admin" ? `Correct attendance — ${target?.name ?? ""}` : "Request a correction"
      }
      description={`Times are in ${tz}. ${
        mode === "admin"
          ? "The change is applied immediately and the reason is kept on record."
          : "An administrator reviews your request; nothing changes until it is approved."
      }`}
      submitting={m.isPending}
      initial={initial}
      fields={[
        { name: "date", type: "date", required: true, disabled: mode === "admin" },
        { name: "check_in", label: "Check-in time", type: "time", required: true },
        { name: "check_out", label: "Check-out time", type: "time" },
        { name: "reason", type: "textarea", required: true },
      ]}
      onSubmit={(v) => m.mutate(v, { onSuccess: onClose })}
    />
  );
}

export function CorrectionsPanel({ isAdmin, me }: { isAdmin: boolean; me: string }) {
  const { tz } = useAttendanceSettings();
  const userName = useUserName();
  const q = useCorrections();
  const [rejecting, setRejecting] = useState<AttCorrection | null>(null);
  const approve = useAttendanceAction(
    "decide_attendance_correction",
    "Request approved",
    (a: { id: string; approve: boolean; note?: string }) => ({
      p_id: a.id,
      p_approve: a.approve,
      p_note: a.note ?? null,
    }),
  );
  const reject = useAttendanceAction(
    "decide_attendance_correction",
    "Request rejected",
    (a: { id: string; approve: boolean; note?: string }) => ({
      p_id: a.id,
      p_approve: a.approve,
      p_note: a.note ?? null,
    }),
  );
  const cancel = useAttendanceAction(
    "cancel_attendance_correction",
    "Request cancelled",
    (id: string) => ({ p_id: id }),
  );

  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const rows = q.data ?? [];
  if (rows.length === 0) return <EmptyState message="No correction requests." />;
  return (
    <>
      <div className="surface overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Before</TableHead>
              <TableHead>After</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-xs">
                  {userName(c.user_id)}
                  {c.source === "admin" ? (
                    <span className="ml-1 text-muted-foreground">(admin edit)</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">{fmtDate(c.work_date)}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {clock(c.old_check_in, tz)} – {clock(c.old_check_out, tz)}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {clock(c.new_check_in, tz)} – {clock(c.new_check_out, tz)}
                </TableCell>
                <TableCell className="max-w-xs truncate text-xs" title={c.reason}>
                  {c.reason}
                  {c.decision_note ? (
                    <span className="block text-muted-foreground">Note: {c.decision_note}</span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <StatusPill value={c.status} />
                </TableCell>
                <TableCell className="space-x-1 text-right whitespace-nowrap">
                  {c.status === "pending" && isAdmin ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={approve.isPending}
                        onClick={() => approve.mutate({ id: c.id, approve: true })}
                      >
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRejecting(c)}>
                        Reject
                      </Button>
                    </>
                  ) : null}
                  {c.status === "pending" && c.requested_by === me ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(c.id)}
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
      <RecordDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title="Reject correction request"
        description="Optionally tell them why."
        submitting={reject.isPending}
        fields={[{ name: "note", type: "textarea" }]}
        onSubmit={(v) =>
          rejecting &&
          reject.mutate(
            { id: rejecting.id, approve: false, note: v["note"] ?? "" },
            { onSuccess: () => setRejecting(null) },
          )
        }
      />
    </>
  );
}
