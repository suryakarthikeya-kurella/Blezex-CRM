/** Escape text for the printable HTML below (every dynamic value goes through this). */
export const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export type PrintRow = [label: string, value: string];

/** Open a clean printable page (use the browser's "Save as PDF"). Content is escaped; no scripts from data run. */
export function printDocument(opts: {
  title: string;
  subtitle?: string;
  rows: PrintRow[];
  footer?: string;
}) {
  const w = window.open("", "_blank");
  if (!w) return false;
  const rows = opts.rows
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v).replace(/\n/g, "<br>")}</td></tr>`)
    .join("");
  w.document
    .write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;color:#111;margin:40px;max-width:760px}
 h1{font-size:22px;margin:0}.sub{color:#555;margin:4px 0 24px}
 table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #ddd;vertical-align:top}
 th{width:32%;color:#555;font-weight:600}.foot{margin-top:28px;color:#777;font-size:12px}
 @media print{body{margin:16mm}}
</style></head><body>
<h1>${esc(opts.title)}</h1><p class="sub">${esc(opts.subtitle ?? "BlezeX Technologies")}</p>
<table>${rows}</table>
<p class="foot">${esc(opts.footer ?? "")}</p>
<script>window.onload=function(){window.focus();window.print();}</script>
</body></html>`);
  w.document.close();
  return true;
}
