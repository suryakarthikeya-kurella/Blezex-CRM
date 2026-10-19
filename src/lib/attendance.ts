import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase, unwrap } from "./supabase";
import { useConfig } from "./api";

/** Derived values (net hours, late minutes, status) come from public.attendance_report(); the UI never recomputes them. */
export type AttStatus =
  | "present"
  | "late"
  | "half_day"
  | "absent"
  | "incomplete"
  | "not_checked_in"
  | "weekly_off"
  | "holiday"
  | "on_leave";

export type AttRow = {
  user_id: string;
  full_name: string;
  role: "mentor" | "bds_employee";
  teams: string | null;
  work_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  break_minutes: number | null;
  net_minutes: number | null;
  late_minutes: number;
  early_minutes: number;
  overtime_minutes: number;
  on_break: boolean;
  is_corrected: boolean;
  status: AttStatus;
  leave_type: string | null;
  /** every check-in/check-out of the day, in order (the open session has out = null) */
  sessions: { in: string; out: string | null }[] | null;
};

export type AttCorrection = {
  id: string;
  user_id: string;
  work_date: string;
  source: "request" | "admin";
  old_check_in: string | null;
  old_check_out: string | null;
  new_check_in: string;
  new_check_out: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requested_by: string;
  decided_by: string | null;
  decision_note: string | null;
  created_at: string;
};

export type AttPolicy = {
  work_start: string;
  work_end: string;
  lunch_start: string;
  lunch_end: string;
  grace_minutes: number;
  early_departure_grace_minutes: number;
  half_day_min_net_minutes: number;
  full_day_min_net_minutes: number;
  weekly_offs: number[];
  holidays: string[];
  track_breaks: boolean;
  overtime_enabled: boolean;
};

/** Mirrors app.attendance_policy_default(); only used until/unless the setting row is readable. */
export const DEFAULT_POLICY: AttPolicy = {
  work_start: "10:00",
  work_end: "18:00",
  lunch_start: "13:00",
  lunch_end: "14:00",
  grace_minutes: 10,
  early_departure_grace_minutes: 0,
  half_day_min_net_minutes: 240,
  full_day_min_net_minutes: 360,
  weekly_offs: [0],
  holidays: [],
  track_breaks: false,
  overtime_enabled: false,
};

export const STATUS_LABEL: Record<AttStatus, string> = {
  present: "Present",
  late: "Late",
  half_day: "Half day",
  absent: "Absent",
  incomplete: "Missing check-out",
  not_checked_in: "Not checked in",
  weekly_off: "Weekly off",
  holiday: "Holiday",
  on_leave: "On leave",
};
export const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as AttStatus[]).map((v) => ({
  value: v,
  label: STATUS_LABEL[v],
}));
export const isOffDay = (s: AttStatus) => s === "weekly_off" || s === "holiday";

// ───────── pure helpers (unit-tested) ─────────
export const hm = (m: number | null | undefined) =>
  m == null ? "—" : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

export const clock = (iso: string | null | undefined, tz: string) =>
  iso
    ? new Intl.DateTimeFormat("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: tz,
      }).format(new Date(iso))
    : "—";

/** 'HH:MM' in the company timezone, for pre-filling <input type="time">. */
export const clockInput = (iso: string | null | undefined, tz: string) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: tz,
      }).format(new Date(iso))
    : "";

/** "10:47 am – 11:19 am, 11:30 am – now" for one day's sessions. */
export const sessionsText = (s: AttRow["sessions"], tz: string) =>
  (s ?? []).map((x) => `${clock(x.in, tz)} – ${x.out ? clock(x.out, tz) : "now"}`).join(", ");

export const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
export const weekBounds = (d: string) => {
  const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const from = addDays(d, -dow);
  return { from, to: addDays(from, 6) };
};
export const monthBounds = (d: string) => {
  const [y, m] = d.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
};
export type RangeKind = "day" | "week" | "month";
export const rangeFor = (kind: RangeKind, d: string) =>
  kind === "day" ? { from: d, to: d } : kind === "week" ? weekBounds(d) : monthBounds(d);

export type Summary = {
  user_id: string;
  full_name: string;
  role: AttRow["role"];
  teams: string | null;
  present: number;
  late: number;
  half_day: number;
  absent: number;
  incomplete: number;
  on_leave: number;
  net_minutes: number;
  worked_days: number;
  late_minutes: number;
  early_minutes: number;
  overtime_minutes: number;
};

/** One line per person: day counts per status plus worked time. Off days / not-yet-checked-in days are ignored. */
export function summarize(rows: AttRow[]): Summary[] {
  const by = new Map<string, Summary>();
  for (const r of rows) {
    let s = by.get(r.user_id);
    if (!s) {
      s = {
        user_id: r.user_id,
        full_name: r.full_name,
        role: r.role,
        teams: r.teams,
        present: 0,
        late: 0,
        half_day: 0,
        absent: 0,
        incomplete: 0,
        on_leave: 0,
        net_minutes: 0,
        worked_days: 0,
        late_minutes: 0,
        early_minutes: 0,
        overtime_minutes: 0,
      };
      by.set(r.user_id, s);
    }
    if (r.status === "present") s.present++;
    else if (r.status === "late") s.late++;
    else if (r.status === "half_day") s.half_day++;
    else if (r.status === "absent") s.absent++;
    else if (r.status === "incomplete") s.incomplete++;
    else if (r.status === "on_leave") s.on_leave++;
    if (r.net_minutes != null) {
      s.net_minutes += r.net_minutes;
      s.worked_days++;
    }
    s.late_minutes += r.late_minutes;
    s.early_minutes += r.early_minutes;
    s.overtime_minutes += r.overtime_minutes;
  }
  return [...by.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export type DayStats = {
  present: number; // anyone who checked in
  late: number;
  absent: number;
  onLeave: number;
  missingCheckout: number;
  checkedIn: number; // in right now
  avgNetMinutes: number | null;
};
export function dayStats(rows: AttRow[]): DayStats {
  const withNet = rows.filter((r) => r.net_minutes != null);
  return {
    present: rows.filter((r) => r.check_in_at).length,
    late: rows.filter((r) => r.status === "late").length,
    absent: rows.filter((r) => r.status === "absent" && !r.check_in_at).length,
    onLeave: rows.filter((r) => r.status === "on_leave").length,
    missingCheckout: rows.filter((r) => r.status === "incomplete").length,
    checkedIn: rows.filter((r) => r.check_in_at && !r.check_out_at && r.status !== "incomplete")
      .length,
    avgNetMinutes: withNet.length
      ? Math.round(withNet.reduce((a, r) => a + (r.net_minutes ?? 0), 0) / withNet.length)
      : null,
  };
}

// ───────── leave ─────────
export const LEAVE_TYPES = [
  { value: "casual", label: "Casual" },
  { value: "sick", label: "Sick" },
  { value: "earned", label: "Earned / paid" },
  { value: "unpaid", label: "Unpaid" },
  { value: "other", label: "Other" },
];
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
export type LeaveRequest = {
  id: string;
  user_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: LeaveStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  days: number;
  is_half_day: boolean;
  can_decide: boolean;
};
export type LeaveBalance = {
  leave_type: string;
  quota: number | null;
  used: number;
  pending: number;
  remaining: number | null;
};

export const SUMMARY_COLUMNS = [
  "Name",
  "Role",
  "Team",
  "Present days",
  "Late days",
  "Half days",
  "Absent days",
  "Leave days",
  "Missing check-outs",
  "Net work (hours)",
  "Avg net per worked day (hours)",
  "Late (min)",
  "Early departure (min)",
  "Overtime (min)",
];
const hours = (m: number) => Math.round((m / 60) * 100) / 100;
/** One line per person for payroll / HR: day counts per status plus worked hours. */
export const summaryCsvRows = (s: Summary[]): Record<string, unknown>[] =>
  s.map((x) => ({
    Name: x.full_name,
    Role: x.role === "mentor" ? "Mentor" : "BDS Employee",
    Team: x.teams ?? "",
    "Present days": x.present,
    "Late days": x.late,
    "Half days": x.half_day,
    "Absent days": x.absent,
    "Leave days": x.on_leave,
    "Missing check-outs": x.incomplete,
    "Net work (hours)": hours(x.net_minutes),
    "Avg net per worked day (hours)": x.worked_days ? hours(x.net_minutes / x.worked_days) : "",
    "Late (min)": x.late_minutes,
    "Early departure (min)": x.early_minutes,
    "Overtime (min)": x.overtime_minutes,
  }));

export const CSV_COLUMNS = [
  "Name",
  "Role",
  "Team",
  "Date",
  "Check-in",
  "Check-out",
  "Break (min)",
  "Net work (min)",
  "Late (min)",
  "Early departure (min)",
  "Overtime (min)",
  "Status",
  "Leave type",
  "Sessions",
];
export const toCsvRows = (rows: AttRow[], tz: string): Record<string, unknown>[] =>
  rows.map((r) => ({
    Name: r.full_name,
    Role: r.role === "mentor" ? "Mentor" : "BDS Employee",
    Team: r.teams ?? "",
    Date: r.work_date,
    "Check-in": clockInput(r.check_in_at, tz),
    "Check-out": clockInput(r.check_out_at, tz),
    "Break (min)": r.break_minutes ?? "",
    "Net work (min)": r.net_minutes ?? "",
    "Late (min)": r.late_minutes,
    "Early departure (min)": r.early_minutes,
    "Overtime (min)": r.overtime_minutes,
    Status: STATUS_LABEL[r.status],
    "Leave type": r.leave_type ?? "",
    Sessions: (r.sessions ?? [])
      .map((s) => `${clockInput(s.in, tz)}-${clockInput(s.out, tz)}`)
      .join("; "),
  }));

// ───────── data hooks ─────────
const rpc = async <T>(fn: string, args?: Record<string, unknown>) =>
  unwrap<T>(await supabase.rpc(fn, args as never));

export function useAttendanceSettings() {
  const { data } = useConfig();
  const policy = {
    ...DEFAULT_POLICY,
    ...((data?.settings["attendance.policy"] as Partial<AttPolicy> | undefined) ?? {}),
  };
  const tz = ((data?.settings["company"] as { timezone?: string } | undefined)?.timezone ??
    "Asia/Kolkata") as string;
  return { policy, tz };
}

export function useAttendanceToday() {
  return useQuery({
    queryKey: ["attendance", "today"],
    staleTime: 60_000,
    queryFn: () => rpc<string>("attendance_today"),
  });
}

export type ReportArgs = { from: string; to: string; user?: string; team?: string; role?: string };
export const fetchReport = (a: ReportArgs) =>
  rpc<AttRow[]>("attendance_report", {
    p_from: a.from,
    p_to: a.to,
    p_user: a.user ?? null,
    p_team: a.team || null,
    p_role: a.role || null,
  });
export function useAttendanceReport(a: ReportArgs, enabled = true) {
  return useQuery({
    queryKey: ["attendance", "report", a],
    enabled,
    queryFn: () => fetchReport(a),
  });
}

export function useLeaveRequests() {
  return useQuery({
    queryKey: ["attendance", "leave"],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("leave_request_details")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(300),
      ) as LeaveRequest[],
  });
}
export function useLeaveBalance(year?: number) {
  return useQuery({
    queryKey: ["attendance", "leave-balance", year ?? "current"],
    queryFn: () => rpc<LeaveBalance[]>("my_leave_balance", year ? { p_year: year } : {}),
  });
}
/** Who will review the signed-in user's leave (decided server-side from team assignments). */
export function useLeaveApprovers() {
  return useQuery({
    queryKey: ["attendance", "leave-approvers"],
    staleTime: 5 * 60_000,
    queryFn: () => rpc<{ id: string; full_name: string }[]>("my_leave_approvers"),
  });
}

export function useCorrections() {
  return useQuery({
    queryKey: ["attendance", "corrections"],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("attendance_corrections")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200),
      ) as AttCorrection[],
  });
}

/** Run an attendance RPC, then refresh every attendance query. */
export function useAttendanceAction<A = void>(
  fn: string,
  success?: string,
  map?: (a: A) => Record<string, unknown>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: A) => rpc(fn, map ? map(a) : undefined),
    onSuccess: () => {
      if (success) toast.success(success);
      void qc.invalidateQueries({ queryKey: ["attendance"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
