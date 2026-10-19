/** Minimal RFC-4180 CSV reader: quoted fields, escaped quotes, CRLF/LF, commas inside quotes, a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export type LeadCsvRow = {
  company_name: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  website?: string;
  industry?: string;
  notes?: string;
  priority?: "low" | "medium" | "high";
  estimated_value?: number;
  lead_source?: string; // resolved to an id by the importer
  service?: string;
};
export type LeadCsvResult = {
  valid: { line: number; row: LeadCsvRow }[];
  errors: { line: number; message: string }[];
  unknownColumns: string[];
};

const HEADERS: Record<string, keyof LeadCsvRow> = {
  company: "company_name",
  "company name": "company_name",
  company_name: "company_name",
  contact: "contact_name",
  "contact name": "contact_name",
  contact_name: "contact_name",
  email: "email",
  phone: "phone",
  mobile: "phone",
  website: "website",
  industry: "industry",
  notes: "notes",
  priority: "priority",
  value: "estimated_value",
  "estimated value": "estimated_value",
  estimated_value: "estimated_value",
  source: "lead_source",
  "lead source": "lead_source",
  lead_source: "lead_source",
  service: "service",
};
export const LEAD_CSV_TEMPLATE =
  "company_name,contact_name,email,phone,website,industry,priority,estimated_value,lead_source,service,notes\r\n" +
  'Acme Pvt Ltd,Asha Rao,asha@acme.example,+91 98765 43210,https://acme.example,Retail,high,250000,Referral,Web Application Development,"Met at expo"\r\n';

/** Validate rows of a lead CSV (first row = headers). Pure: no database access. */
export function validateLeadCsv(rows: string[][]): LeadCsvResult {
  const out: LeadCsvResult = { valid: [], errors: [], unknownColumns: [] };
  const head = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  const map = head.map((h) => HEADERS[h]);
  head.forEach((h, i) => {
    if (!map[i] && h) out.unknownColumns.push(h);
  });
  if (!map.includes("company_name")) {
    out.errors.push({ line: 1, message: "Missing required column: company_name" });
    return out;
  }
  const seen = new Set<string>();
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const o: Record<string, string> = {};
    map.forEach((k, i) => {
      if (k) o[k] = (r[i] ?? "").trim();
    });
    if (!o["company_name"]) return void out.errors.push({ line, message: "company_name is empty" });
    if (o["email"] && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o["email"]))
      return void out.errors.push({ line, message: `invalid email "${o["email"]}"` });
    if (o["priority"] && !["low", "medium", "high"].includes(o["priority"].toLowerCase()))
      return void out.errors.push({ line, message: `priority must be low, medium or high` });
    let value: number | undefined;
    if (o["estimated_value"]) {
      value = Number(o["estimated_value"].replace(/[,₹\s]/g, ""));
      if (!Number.isFinite(value) || value < 0)
        return void out.errors.push({ line, message: `invalid value "${o["estimated_value"]}"` });
    }
    const key = (o["email"] || o["company_name"]).toLowerCase();
    if (seen.has(key))
      return void out.errors.push({ line, message: "duplicate of an earlier row in this file" });
    seen.add(key);
    const row: LeadCsvRow = { company_name: o["company_name"] };
    for (const k of [
      "contact_name",
      "email",
      "phone",
      "website",
      "industry",
      "notes",
      "lead_source",
      "service",
    ] as const)
      if (o[k]) row[k] = o[k];
    if (o["priority"]) row.priority = o["priority"].toLowerCase() as "low" | "medium" | "high";
    if (value !== undefined) row.estimated_value = value;
    out.valid.push({ line, row });
  });
  return out;
}
