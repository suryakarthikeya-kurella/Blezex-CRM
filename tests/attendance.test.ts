import { describe, expect, it } from "vitest";
import {
  addDays,
  clockInput,
  dayStats,
  hm,
  monthBounds,
  rangeFor,
  summarize,
  toCsvRows,
  weekBounds,
  type AttRow,
} from "../src/lib/attendance";
import { toCsv } from "../src/lib/format";

// Net hours / late minutes / status are computed in SQL (supabase/tests/14_attendance.sql);
// these cover the client-side helpers that aggregate and present those server rows.
const row = (o: Partial<AttRow>): AttRow => ({
  user_id: "u1",
  full_name: "Eve",
  role: "bds_employee",
  teams: "Team One",
  work_date: "2025-03-03",
  check_in_at: "2025-03-03T04:30:00Z", // 10:00 IST
  check_out_at: "2025-03-03T12:30:00Z", // 18:00 IST
  break_minutes: 60,
  net_minutes: 420,
  late_minutes: 0,
  early_minutes: 0,
  overtime_minutes: 0,
  on_break: false,
  is_corrected: false,
  status: "present",
  leave_type: null,
  sessions: null,
  ...o,
});

describe("attendance helpers", () => {
  it("formats minutes as hours", () => {
    expect(hm(420)).toBe("7h 00m");
    expect(hm(75)).toBe("1h 15m");
    expect(hm(null)).toBe("—");
  });
  it("renders times in the company timezone, not the browser's", () => {
    expect(clockInput("2025-03-03T04:30:00Z", "Asia/Kolkata")).toBe("10:00");
    expect(clockInput(null, "Asia/Kolkata")).toBe("");
  });
  it("computes date ranges (Monday-first weeks, month ends, leap years)", () => {
    expect(addDays("2025-03-31", 1)).toBe("2025-04-01");
    expect(weekBounds("2025-03-09")).toEqual({ from: "2025-03-03", to: "2025-03-09" }); // Sunday
    expect(weekBounds("2025-03-03")).toEqual({ from: "2025-03-03", to: "2025-03-09" });
    expect(monthBounds("2024-02-10")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(rangeFor("day", "2025-03-05")).toEqual({ from: "2025-03-05", to: "2025-03-05" });
  });
  it("summarises per person and ignores days without worked time", () => {
    const s = summarize([
      row({}),
      row({ work_date: "2025-03-04", status: "late", late_minutes: 30, net_minutes: 390 }),
      row({ work_date: "2025-03-05", status: "absent", net_minutes: null, check_in_at: null }),
      row({ work_date: "2025-03-09", status: "weekly_off", net_minutes: null, check_in_at: null }),
      row({ user_id: "u2", full_name: "Adam", status: "incomplete", net_minutes: null }),
      row({
        work_date: "2025-03-11",
        status: "on_leave",
        net_minutes: null,
        check_in_at: null,
        leave_type: "sick",
      }),
    ]);
    expect(s.map((x) => x.full_name)).toEqual(["Adam", "Eve"]);
    const eve = s[1]!;
    expect([
      eve.present,
      eve.late,
      eve.absent,
      eve.on_leave,
      eve.net_minutes,
      eve.worked_days,
      eve.late_minutes,
    ]).toEqual([1, 1, 1, 1, 810, 2, 30]);
    expect(s[0]!.incomplete).toBe(1);
  });
  it("derives dashboard counts", () => {
    const st = dayStats([
      row({}),
      row({
        user_id: "u2",
        status: "late",
        late_minutes: 20,
        check_out_at: null,
        net_minutes: 100,
      }),
      row({
        user_id: "u3",
        status: "absent",
        check_in_at: null,
        check_out_at: null,
        net_minutes: null,
      }),
      row({ user_id: "u4", status: "incomplete", check_out_at: null, net_minutes: null }),
    ]);
    expect(st).toEqual({
      present: 3,
      late: 1,
      absent: 1,
      onLeave: 0,
      missingCheckout: 1,
      checkedIn: 1,
      avgNetMinutes: 260,
    });
    expect(dayStats([]).avgNetMinutes).toBeNull();
  });
  it("exports CSV with local times and formula-injection protection", () => {
    const rows = toCsvRows([row({ full_name: "=HYPERLINK(1)" })], "Asia/Kolkata");
    expect(rows[0]).toMatchObject({ "Check-in": "10:00", "Check-out": "18:00", Status: "Present" });
    expect(toCsv(["Name"], rows)).toContain(`"'=HYPERLINK(1)"`);
  });
});
