import { describe, expect, it } from "vitest";
import { LEAD_CSV_TEMPLATE, parseCsv, validateLeadCsv } from "../src/lib/csv";
import { passwordIssue } from "../src/lib/password";

describe("CSV reader", () => {
  it("handles quotes, commas, escaped quotes, CRLF, BOM and blank lines", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n1,2');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["1", "2"],
    ]);
  });
  it("keeps a trailing row without newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("lead CSV validation", () => {
  it("accepts the shipped template", () => {
    const r = validateLeadCsv(parseCsv(LEAD_CSV_TEMPLATE));
    expect(r.errors).toEqual([]);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]!.row).toMatchObject({
      company_name: "Acme Pvt Ltd",
      priority: "high",
      estimated_value: 250000,
    });
  });
  it("reports row-level problems with line numbers", () => {
    const r = validateLeadCsv(
      parseCsv(
        "company,email,priority,value\nA,a@x.io,high,10\n,b@x.io,low,1\nC,not-an-email,low,1\nD,d@x.io,urgent,1\nE,e@x.io,low,abc\nA,a@x.io,low,2",
      ),
    );
    expect(r.valid.map((v) => v.line)).toEqual([2]);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7]);
  });
  it("needs a company column and flags unknown ones", () => {
    expect(validateLeadCsv(parseCsv("name\nx")).errors[0]!.message).toMatch(/company_name/);
    expect(validateLeadCsv(parseCsv("company,favourite colour\nx,red")).unknownColumns).toEqual([
      "favourite colour",
    ]);
  });
});

describe("password policy", () => {
  it("enforces length and character mix", () => {
    expect(passwordIssue("short1A!")).toMatch(/10/);
    expect(passwordIssue("alllowercaseletters")).toMatch(/three/);
    expect(passwordIssue("Sample@Pass1")).toBeNull();
    expect(passwordIssue("Correct-Horse-9")).toBeNull();
    expect(passwordIssue("x".repeat(73) + "A1!")).toMatch(/72/);
  });
});
