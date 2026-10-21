import { describe, expect, it } from "vitest";
import {
  can,
  FINANCE_SECTIONS,
  financeSectionsFor,
  navFor,
  routeAllowed,
} from "../src/lib/permissions";
import { fetchAllPages, netPrice, parseMoney, presetRange } from "../src/lib/finance";

const SECTION_PATHS = [
  "/finance",
  "/finance/services",
  "/finance/accounts",
  "/finance/invoices",
  "/finance/sales",
  "/finance/payroll",
  "/finance/expenses",
  "/finance/reports",
];

describe("finance navigation and route guard (UI map — RLS is the real enforcement)", () => {
  it("defines exactly the eight approved sections", () => {
    expect(FINANCE_SECTIONS.map((s) => s.to)).toEqual(SECTION_PATHS);
  });
  it("admin reaches all eight sections", () => {
    expect(financeSectionsFor("admin").map((s) => s.to)).toEqual(SECTION_PATHS);
    for (const p of SECTION_PATHS) expect(routeAllowed("admin", p)).toBe(true);
  });
  it.each(["mentor", "bds_employee"] as const)("%s reaches only Services & Pricing", (role) => {
    expect(financeSectionsFor(role).map((s) => s.to)).toEqual(["/finance/services"]);
    expect(routeAllowed(role, "/finance/services")).toBe(true);
    for (const p of SECTION_PATHS.filter((x) => x !== "/finance/services"))
      expect(routeAllowed(role, p)).toBe(false);
    expect(routeAllowed(role, "/finance/invoices/anything")).toBe(false);
  });
  it("sidebar: admin gets one Finance entry, others get Services & pricing", () => {
    expect(navFor("admin").map((n) => n.to)).toContain("/finance");
    expect(navFor("admin").map((n) => n.to)).not.toContain("/finance/services");
    for (const role of ["mentor", "bds_employee"] as const) {
      const to = navFor(role).map((n) => n.to);
      expect(to).toContain("/finance/services");
      expect(to).not.toContain("/finance");
    }
  });
  it("nobody without a role gets anything", () => {
    expect(financeSectionsFor(undefined)).toEqual([]);
    for (const p of SECTION_PATHS) expect(routeAllowed(undefined, p)).toBe(false);
  });
  it("only admins can manage prices and see payroll; everyone signed in can view prices", () => {
    expect(can("admin", "services.manage")).toBe(true);
    expect(can("mentor", "services.manage")).toBe(false);
    expect(can("bds_employee", "services.manage")).toBe(false);
    for (const r of ["admin", "mentor", "bds_employee"] as const)
      expect(can(r, "services.view")).toBe(true);
    expect(can(undefined, "services.view")).toBe(false);
    expect(can("admin", "payroll.view")).toBe(true);
    expect(can("mentor", "payroll.view")).toBe(false);
    expect(can("bds_employee", "payroll.view")).toBe(false);
  });
});

describe("parseMoney (client-side guard; the database re-validates)", () => {
  it.each([
    ["100", 100],
    ["1,25,000.50", 125000.5],
    [" 0.01 ", 0.01],
    ["99999999999.99", 99999999999.99],
  ])("accepts %s", (input, out) => expect(parseMoney(input)).toBe(out));
  it.each(["", "0", "-5", "abc", "1.234", "1e3", "NaN", "Infinity", "100000000000", "5,,0"])(
    "rejects %j",
    (input) => expect(parseMoney(input)).toBeNull(),
  );
});

describe("netPrice", () => {
  it("applies a percentage discount and rounds to paise", () => {
    expect(netPrice(50000, 10)).toBe(45000);
    expect(netPrice(999.99, 15)).toBe(849.99);
    expect(netPrice(100, 0)).toBe(100);
    expect(netPrice(100, 100)).toBe(0);
  });
  it("clamps nonsense discounts instead of producing negative prices", () => {
    expect(netPrice(100, -5)).toBe(100);
    expect(netPrice(100, 150)).toBe(0);
  });
});

describe("presetRange", () => {
  const today = new Date(2026, 4, 17); // 17 May 2026 (local)
  it("this month", () =>
    expect(presetRange("this_month", today)).toEqual({ from: "2026-05-01", to: "2026-05-31" }));
  it("last month", () =>
    expect(presetRange("last_month", today)).toEqual({ from: "2026-04-01", to: "2026-04-30" }));
  it("this quarter", () =>
    expect(presetRange("this_quarter", today)).toEqual({ from: "2026-04-01", to: "2026-06-30" }));
  it("this year", () =>
    expect(presetRange("this_year", today)).toEqual({ from: "2026-01-01", to: "2026-12-31" }));
  it("last month across a year boundary", () =>
    expect(presetRange("last_month", new Date(2026, 0, 3))).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    }));
  it("leap-year February", () =>
    expect(presetRange("this_month", new Date(2028, 1, 10))).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    }));
});

describe("fetchAllPages (CSV export walks server pages, never one giant query)", () => {
  const rows = Array.from({ length: 2500 }, (_, i) => i);
  const pager = (from: number, to: number) => Promise.resolve(rows.slice(from, to + 1));
  it("collects every page", async () => expect(await fetchAllPages(pager, 1000)).toEqual(rows));
  it("stops on a short page", async () => {
    let calls = 0;
    await fetchAllPages((f, t) => ((calls += 1), pager(f, t)), 1000);
    expect(calls).toBe(3);
  });
  it("refuses to run away on an endless source", async () => {
    await expect(fetchAllPages(() => Promise.resolve([1, 2, 3]), 3, 5)).rejects.toThrow(
      /too large/i,
    );
  });
});
