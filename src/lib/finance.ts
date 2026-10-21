/** Pure Finance helpers (no Supabase import, so they run in unit tests). Definitions of every metric live in SQL (0018). */

export type Overview = {
  from: string;
  to: string;
  as_of: string;
  total_closed_sales: number;
  invoiced: number;
  total_collected: number;
  advances_received: number;
  outstanding_receivables: number;
  overdue_payments: number;
  total_expenses_paid: number;
  salaries_paid: number;
  salaries_payable: number;
  net_cash_flow: number;
  net_profit: number | null;
  net_profit_status: "not_available";
};

export type SeriesRow = {
  bucket: string;
  closed_sales: number;
  collected: number;
  advances: number;
  expenses_paid: number;
  salaries_paid: number;
  net_cash_flow: number;
};

export const EXPENSE_CATEGORIES = [
  { value: "office_rent", label: "Office rent" },
  { value: "utilities", label: "Utilities" },
  { value: "marketing", label: "Marketing" },
  { value: "software", label: "Software" },
  { value: "travel", label: "Travel" },
  { value: "equipment", label: "Equipment" },
  { value: "other", label: "Other business expenses" },
] as const;

export const PAYMENT_METHODS = [
  "bank_transfer",
  "upi",
  "cash",
  "cheque",
  "gateway",
  "other",
] as const;
export const PAYMENT_PURPOSES = [
  { value: "advance", label: "Advance" },
  { value: "partial", label: "Partial payment" },
  { value: "final", label: "Final payment" },
] as const;

/** Amount with at most two decimals and optional thousands separators (1,25,000.50 or 125,000.50). Null when invalid; zero only when allowed. */
export function parseMoney(input: string, allowZero = false): number | null {
  const s = input.trim();
  if (!/^(\d{1,3}(,\d{2,3})+|\d+)(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && (allowZero ? n >= 0 : n > 0) && n < 1e11 ? n : null;
}

/** Price after a percentage discount, rounded to paise. Out-of-range discounts are clamped to 0–100. */
export function netPrice(price: number, discountPercent: number): number {
  const d = Math.min(100, Math.max(0, discountPercent));
  return Math.round((Math.round(price * 100) * (100 - d)) / 100) / 100;
}

export type RangePreset = "this_month" | "last_month" | "this_quarter" | "this_year";
export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "this_year", label: "This year" },
];

const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** Calendar ranges as local-date ISO strings (no UTC conversion, so no off-by-one near midnight). */
export function presetRange(preset: RangePreset, today: Date): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (preset) {
    case "this_month":
      return { from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)) };
    case "last_month": {
      const py = m === 0 ? y - 1 : y;
      const pm = m === 0 ? 11 : m - 1;
      return { from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)) };
    }
    case "this_quarter": {
      const qs = Math.floor(m / 3) * 3;
      return { from: iso(y, qs, 1), to: iso(y, qs + 2, lastDay(y, qs + 2)) };
    }
    case "this_year":
      return { from: iso(y, 0, 1), to: iso(y, 11, 31) };
  }
}

export const thisMonth = () => presetRange("this_month", new Date());

/** Walk a paginated source (inclusive from/to offsets) until a short page; bounded so a bad filter cannot exhaust memory. */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => Promise<T[]>,
  size = 1000,
  maxPages = 50,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < maxPages; i++) {
    const rows = await page(i * size, i * size + size - 1);
    out.push(...rows);
    if (rows.length < size) return out;
  }
  throw new Error("Export too large — narrow the date range.");
}

export const REPORT_TABS = [
  "sales",
  "collections",
  "outstanding",
  "payroll",
  "expenses",
  "cashflow",
] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

export const statusLabel = (s: string) =>
  s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
