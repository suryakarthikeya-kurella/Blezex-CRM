import { describe, expect, it } from "vitest";
import { can, navFor, routeAllowed } from "../src/lib/permissions";
import { safeSearch, toCsv } from "../src/lib/format";
import { toError } from "../src/lib/supabase";

describe("permissions (UI map — DB RLS is the real enforcement)", () => {
  it("only admins get admin capabilities", () => {
    for (const cap of [
      "users.manage",
      "settings.manage",
      "finance.manage",
      "targets.manage",
      "dashboard.company",
    ] as const) {
      expect(can("admin", cap)).toBe(true);
      expect(can("mentor", cap)).toBe(false);
      expect(can("bds_employee", cap)).toBe(false);
    }
  });
  it("mentors can assign/coach but employees cannot", () => {
    expect(can("mentor", "leads.assign")).toBe(true);
    expect(can("bds_employee", "leads.assign")).toBe(false);
    expect(can("mentor", "coaching.write")).toBe(true);
  });
  it("unknown / missing role has no capability", () => {
    expect(can(undefined, "audit.view")).toBe(false);
    expect(navFor(null)).toEqual([]);
  });
  it("navigation is role specific", () => {
    expect(navFor("bds_employee").map((n) => n.to)).not.toContain("/settings");
    expect(navFor("bds_employee").map((n) => n.to)).not.toContain("/finance");
    expect(navFor("mentor").map((n) => n.to)).toContain("/team");
    expect(navFor("admin").map((n) => n.to)).toContain("/finance");
  });
  it("route guard denies finance to mentors but allows nested lead pages", () => {
    expect(routeAllowed("mentor", "/finance")).toBe(false);
    expect(routeAllowed("bds_employee", "/leads/123")).toBe(true);
    expect(routeAllowed("bds_employee", "/settings")).toBe(false);
  });
});

describe("csv export", () => {
  it("quotes and escapes", () => {
    expect(toCsv(["a"], [{ a: 'he said "hi", ok' }])).toBe('"a"\r\n"he said ""hi"", ok"');
  });
  it("neutralises spreadsheet formula injection", () => {
    for (const bad of ["=HYPERLINK(1)", "+1", "-2", "@SUM(A1)"])
      expect(toCsv(["a"], [{ a: bad }]).split("\r\n")[1]).toBe(`"'${bad}"`);
  });
  it("handles null", () => expect(toCsv(["a"], [{ a: null }])).toBe('"a"\r\n""'));
});

describe("search sanitiser", () => {
  it("removes PostgREST filter metacharacters", () => {
    expect(safeSearch("a,b)(c*d%e")).not.toMatch(/[,()*%]/);
    expect(safeSearch("x".repeat(500)).length).toBeLessThanOrEqual(80);
  });
});

describe("error mapping", () => {
  it("never silently swallows; maps codes to friendly text", () => {
    expect(toError({ code: "23505", message: "dup" }).message).toMatch(/duplicate/i);
    expect(
      toError({ code: "40001", message: "lead was modified by someone else; reload and retry" })
        .message,
    ).toMatch(/modified/);
    expect(toError({ code: "42501", message: "permission denied for table x" }).message).toMatch(
      /permission/i,
    );
    expect(toError(null).message).toBe("Unknown error");
  });
});
