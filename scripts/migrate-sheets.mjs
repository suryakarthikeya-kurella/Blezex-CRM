#!/usr/bin/env node
/**
 * Google Sheets (CSV export) -> Supabase migration. DRY-RUN BY DEFAULT.
 *   node scripts/migrate-sheets.mjs --dir ./exports                 # validate + reconcile, writes nothing
 *   node scripts/migrate-sheets.mjs --dir ./exports --apply         # perform the import (idempotent upserts on legacy_id)
 * Env (never hard-code): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Offline dry-run: --lookups lookups.json
 * Input: Leads.csv, Clients.csv, Activities.csv, Tasks.csv exported from the original workbook (keep the originals read-only).
 * Order: leads -> clients -> link won leads -> activities -> tasks. Re-running is safe.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import {
  makeLookups,
  mapActivity,
  mapClient,
  mapLead,
  mapTask,
  parseCsv,
} from "./migrate/mapping.mjs";

const { values: a } = parseArgs({
  options: {
    dir: { type: "string" },
    apply: { type: "boolean", default: false },
    lookups: { type: "string" },
    report: { type: "string", default: "migration-report.json" },
  },
});
if (!a.dir) {
  console.error("--dir <folder with CSVs> is required");
  process.exit(2);
}
const read = (n) =>
  existsSync(join(a.dir, `${n}.csv`))
    ? parseCsv(readFileSync(join(a.dir, `${n}.csv`), "utf8"))
    : [];
const sb =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;
if (a.apply && !sb) {
  console.error("--apply needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

async function loadLookups() {
  if (a.lookups) return makeLookups(JSON.parse(readFileSync(a.lookups, "utf8")));
  if (!sb) {
    console.error("No DB credentials and no --lookups file: user/source mapping would be empty.");
    process.exit(2);
  }
  const [p, s, v, l] = await Promise.all(
    [
      "profiles:id,email,full_name",
      "lead_sources:id,name",
      "services:id,name",
      "lost_reasons:id,label",
    ].map(async (t) => {
      const [tb, cols] = t.split(":");
      const r = await sb.from(tb).select(cols);
      if (r.error) throw r.error;
      return r.data;
    }),
  );
  return makeLookups({ profiles: p, sources: s, services: v, lostReasons: l });
}

const report = {
  mode: a.apply ? "APPLY" : "DRY-RUN",
  started: new Date().toISOString(),
  entities: {},
  exceptions: [],
};
const stat = (e) =>
  (report.entities[e] ??= { source_rows: 0, valid: 0, imported: 0, skipped: 0, warnings: 0 });
const firstSeen = {};
function triage(entity, key, mapped) {
  const s = stat(entity);
  s.source_rows++;
  const errs = mapped.issues.filter((i) => i.level === "error");
  s.warnings += mapped.issues.length - errs.length;
  mapped.issues.forEach((i) => report.exceptions.push({ entity, key, ...i }));
  const seenSet = (firstSeen[entity] ??= new Set());
  if (key && seenSet.has(key)) {
    errs.push({ level: "error", msg: "duplicate" });
    report.exceptions.push({
      entity,
      key,
      level: "error",
      msg: "duplicate legacy ID in source (first occurrence kept, this row skipped)",
    });
  } else if (key) seenSet.add(key);
  if (errs.length) {
    s.skipped++;
    return false;
  }
  s.valid++;
  return true;
}
async function upsert(table, rows, entity) {
  if (!a.apply || !rows.length) return new Map();
  const out = new Map();
  for (let i = 0; i < rows.length; i += 200) {
    const r = await sb
      .from(table)
      .upsert(rows.slice(i, i + 200), { onConflict: "legacy_id" })
      .select("id,legacy_id");
    if (r.error) {
      report.exceptions.push({ entity, level: "error", msg: `batch ${i}: ${r.error.message}` });
      stat(entity).skipped += Math.min(200, rows.length - i);
      continue;
    }
    r.data.forEach((x) => out.set(x.legacy_id, x.id));
    stat(entity).imported += r.data.length;
  }
  return out;
}

const lk = await loadLookups();
const Leads = read("Leads"),
  Clients = read("Clients"),
  Acts = read("Activities"),
  Tasks = read("Tasks");
const leadMaps = Leads.map((r) => ({ r, m: mapLead(r, lk) })).filter(({ r, m }) =>
  triage("leads", r["Lead ID"], m),
);
const lostReason = lk.lost.get("other") ?? null;
const leadRows = leadMaps.map(({ m }) => ({
  ...m.row,
  stage: m.targetStage === "won" ? "negotiation" : m.targetStage,
  ...(m.targetStage === "lost" ? { lost_reason_id: lostReason } : {}),
}));
const leadIds = await upsert("leads", leadRows, "leads");
const leadByCompany = new Map(
  leadMaps.map(({ m }) => [m.row.company_name.toLowerCase(), m.row.legacy_id]),
);

const clientMaps = Clients.map((r) => ({ r, m: mapClient(r, lk) })).filter(({ r, m }) =>
  triage("clients", r["Client ID"], m),
);
const clientRows = clientMaps.map(({ m }) => {
  const srcLegacy = leadByCompany.get(m.row.company_name.toLowerCase());
  return { ...m.row, source_lead_id: srcLegacy ? (leadIds.get(srcLegacy) ?? null) : null };
});
// one client per source lead: later duplicates by company lose the link rather than violate the unique constraint
const used = new Set();
clientRows.forEach((c) => {
  if (c.source_lead_id) {
    if (used.has(c.source_lead_id)) {
      report.exceptions.push({
        entity: "clients",
        key: c.legacy_id,
        level: "warn",
        msg: "another client already linked to this lead; link dropped",
      });
      c.source_lead_id = null;
    } else used.add(c.source_lead_id);
  }
});
const clientIds = await upsert("clients", clientRows, "clients");
if (a.apply) {
  // projects for imported clients (value/dates from the sheet) and Won linking
  const projects = clientMaps
    .filter(({ m }) => clientIds.has(m.row.legacy_id))
    .map(({ m }) => ({
      legacy_id: m.row.legacy_id,
      client_id: clientIds.get(m.row.legacy_id),
      project_name: `${m.row.company_name} — ${m.project.service ?? "Legacy project"}`,
      service_type: m.project.service,
      agreed_value: m.project.value,
      status: "in_progress",
      start_date: m.project.start,
      target_end_date:
        m.project.end && m.project.start && m.project.end < m.project.start ? null : m.project.end,
    }));
  await upsert("projects", projects, "projects");
  for (const { m } of leadMaps.filter(({ m }) => m.targetStage === "won")) {
    const cid = clientRows.find(
      (c) => c.source_lead_id && c.source_lead_id === leadIds.get(m.row.legacy_id),
    )?.legacy_id;
    if (!cid || !clientIds.get(cid)) {
      report.exceptions.push({
        entity: "leads",
        key: m.row.legacy_id,
        level: "warn",
        msg: "Converted Client lead has no matching client row; left at Negotiation for manual review",
      });
      continue;
    }
    const u = await sb
      .from("leads")
      .update({
        stage: "won",
        converted_client_id: clientIds.get(cid),
        converted_at: m.row.last_contacted_at ?? new Date().toISOString(),
      })
      .eq("legacy_id", m.row.legacy_id);
    if (u.error)
      report.exceptions.push({
        entity: "leads",
        key: m.row.legacy_id,
        level: "error",
        msg: u.error.message,
      });
  }
}

const actRows = [];
for (const r of Acts) {
  const m = mapActivity(r, lk);
  if (!triage("activities", r["Activity ID"], m)) continue;
  const legacyLead = leadByCompany.get(String(m.company ?? "").toLowerCase());
  const leadId = legacyLead ? leadIds.get(legacyLead) : null;
  if (!legacyLead) {
    report.exceptions.push({
      entity: "activities",
      key: r["Activity ID"],
      level: "error",
      msg: `no lead matches company "${m.company}"`,
    });
    stat("activities").valid--;
    stat("activities").skipped++;
    continue;
  }
  if (a.apply && !leadId) continue;
  actRows.push({ ...m.row, lead_id: leadId });
}
await upsert("activities", actRows, "activities");

const taskRows = Tasks.map((r) => ({ r, m: mapTask(r, lk) }))
  .filter(({ r, m }) => triage("tasks", r["Task ID"], m))
  .map(({ m }) => m.row);
await upsert("tasks", taskRows, "tasks");

report.finished = new Date().toISOString();
report.reconciliation = Object.fromEntries(
  Object.entries(report.entities).map(([k, s]) => [
    k,
    {
      ...s,
      unaccounted: a.apply
        ? s.source_rows - s.imported - s.skipped
        : s.source_rows - s.valid - s.skipped,
    },
  ]),
);
if (a.apply) {
  const s = report.entities;
  await sb.from("import_jobs").insert({
    source: "google_sheets_csv",
    entity: "all",
    status: "completed",
    dry_run: false,
    total_rows: Object.values(s).reduce((x, y) => x + y.source_rows, 0),
    imported: Object.values(s).reduce((x, y) => x + y.imported, 0),
    skipped: Object.values(s).reduce((x, y) => x + y.skipped, 0),
    failed: report.exceptions.filter((e) => e.level === "error").length,
    errors: report.exceptions.slice(0, 500),
    summary: report.reconciliation,
    finished_at: new Date().toISOString(),
  });
}
writeFileSync(a.report, JSON.stringify(report, null, 2));
console.log(`${report.mode} complete. Report: ${a.report}`);
console.table(report.reconciliation);
console.log(
  `${report.exceptions.length} exceptions (${report.exceptions.filter((e) => e.level === "error").length} errors) — review before cut-over.`,
);
