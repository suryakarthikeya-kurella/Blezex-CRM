import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script module without types
import {
  makeLookups,
  mapActivity,
  mapLead,
  mapTask,
  parseCsv,
  parseDate,
  parseMoney,
} from "../scripts/migrate/mapping.mjs";

const lk = makeLookups({
  profiles: [{ id: "u1", email: "emp1@blezex.test", full_name: "Eve" }],
  sources: [{ id: "s1", name: "Referral" }],
  services: [{ id: "v1", name: "SEO" }],
  lostReasons: [],
});

describe("sheets migration mapping", () => {
  it("parses quoted CSV with commas and newlines", () => {
    const r = parseCsv('a,b\r\n"x, y","line1\nline2"\r\n');
    expect(r).toEqual([{ a: "x, y", b: "line1\nline2" }]);
  });
  it("parses dates strictly", () => {
    expect(parseDate("15/02/2026")).toBe("2026-02-15T00:00:00.000Z");
    expect(parseDate("2026-01-10")).toBe("2026-01-10T00:00:00.000Z");
    expect(parseDate("32/13/2026")).toBeNull();
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
  it("parses currency text", () => {
    expect(parseMoney("₹50,000")).toBe(50000);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
  });
  it("maps a lead, preserving unmappable originals in notes", () => {
    const { row, issues, targetStage } = mapLead(
      {
        "Lead ID": "LD-1",
        "Company Name": "Acme",
        Status: "Converted Client",
        Priority: "Urgent",
        "Assigned To": "Ghost",
        "Email Address": "bad",
        "Lead Source": "Referral",
      },
      lk,
    );
    expect(targetStage).toBe("won");
    expect(row.priority).toBe("medium");
    expect(row.owner_id).toBeNull();
    expect(row.email).toBeNull();
    expect(row.lead_source_id).toBe("s1");
    expect(row.notes).toContain("Assigned To: Ghost");
    expect(row.notes).toContain("Email: bad");
    expect(issues.some((i: { level: string }) => i.level === "error")).toBe(false);
  });
  it("flags required fields as errors", () => {
    expect(
      mapLead({ "Company Name": "X" }, lk).issues.some((i: { msg: string }) =>
        /Lead ID/.test(i.msg),
      ),
    ).toBe(true);
    expect(
      mapTask({ "Task ID": "T", "Task Title": "t", "Assigned To": "nobody" }, lk).issues.some(
        (i: { level: string }) => i.level === "error",
      ),
    ).toBe(true);
    expect(
      mapActivity({ "Activity ID": "A", Owner: "nobody" }, lk).issues.some(
        (i: { level: string }) => i.level === "error",
      ),
    ).toBe(true);
  });
  it("maps legacy vocabularies", () => {
    expect(
      mapLead({ "Lead ID": "1", "Company Name": "c", Status: "On Hold" }, lk).targetStage,
    ).toBe("nurture");
    expect(
      mapActivity(
        { "Activity ID": "1", "Activity Type": "Proposal Discussion", Owner: "emp1@blezex.test" },
        lk,
      ).row.activity_type,
    ).toBe("proposal");
    expect(
      mapTask(
        { "Task ID": "1", "Task Title": "t", Status: "In Progress", "Assigned To": "Eve" },
        lk,
      ).row.status,
    ).toBe("in_progress");
  });
});
