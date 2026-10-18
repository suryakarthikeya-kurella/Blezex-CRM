const LOCALE = "en-IN";
export const money = (v: number | string | null | undefined, cur = "INR") =>
  new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: cur,
    maximumFractionDigits: 0,
  }).format(Number(v ?? 0));
export const num = (v: number | string | null | undefined) =>
  new Intl.NumberFormat(LOCALE).format(Number(v ?? 0));
export const date = (v: string | null | undefined) =>
  v
    ? new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "short", year: "numeric" }).format(
        new Date(v),
      )
    : "—";
export const dateTime = (v: string | null | undefined) =>
  v
    ? new Intl.DateTimeFormat(LOCALE, {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(v))
    : "—";
export const pct = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);
export const toDatetimeLocal = (iso: string | null | undefined) =>
  iso
    ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
export const fromDatetimeLocal = (v: string | undefined) => (v ? new Date(v).toISOString() : null);
export const isOverdue = (iso: string | null | undefined) =>
  !!iso && new Date(iso).getTime() < new Date(new Date().toDateString()).getTime();
export const label = (s: string | null | undefined) =>
  s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—";

/** RFC-4180 CSV with formula-injection protection (cells starting = + - @ are prefixed with a quote). */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [
    columns.map(esc).join(","),
    ...rows.map((r) => columns.map((c) => esc(r[c])).join(",")),
  ].join("\r\n");
}
export function downloadCsv(filename: string, columns: string[], rows: Record<string, unknown>[]) {
  const url = URL.createObjectURL(
    new Blob([toCsv(columns, rows)], { type: "text/csv;charset=utf-8;" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
/** Strip characters that would break a PostgREST .or() filter expression. */
export const safeSearch = (s: string) =>
  s
    .replace(/[,()*%\\]/g, " ")
    .trim()
    .slice(0, 80);
