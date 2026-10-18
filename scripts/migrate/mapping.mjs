// Pure mapping/validation helpers for the Google Sheets -> Supabase migration (unit-tested, no I/O).
export const STAGE_MAP = {
  "new lead": "new",
  contacted: "contacted",
  "meeting scheduled": "meeting_scheduled",
  "proposal sent": "proposal_sent",
  negotiation: "negotiation",
  "converted client": "won",
  lost: "lost",
  "on hold": "nurture",
};
export const ACTIVITY_MAP = {
  call: "call",
  whatsapp: "whatsapp",
  email: "email",
  meeting: "meeting",
  demo: "demo",
  "proposal discussion": "proposal",
  "follow-up": "follow_up",
  "client review": "client_review",
};
export const TASK_STATUS_MAP = {
  "to do": "todo",
  "in progress": "in_progress",
  completed: "completed",
};
const norm = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase();

/** RFC-4180 CSV parser (quotes, embedded commas/newlines). Returns array of objects keyed by header. */
export function parseCsv(text) {
  const rows = [];
  let row = [],
    cell = "",
    q = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((v) => v !== "")) rows.push(row);
  }
  const [head, ...body] = rows;
  return head
    ? body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])))
    : [];
}

/** Accepts ISO, YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY. Returns ISO string or null (never throws). */
export function parseDate(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  let y,
    mo,
    d,
    h = 0,
    mi = 0;
  if (m) {
    [, y, mo, d] = m;
    h = Number(m[4] ?? 0);
    mi = Number(m[5] ?? 0);
  } else if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/))) {
    [, d, mo, y] = m;
  } else return null;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), h, mi));
  return dt.getUTCFullYear() === Number(y) &&
    dt.getUTCMonth() === Number(mo) - 1 &&
    dt.getUTCDate() === Number(d)
    ? dt.toISOString()
    : null;
}
export const parseMoney = (v) => {
  const t = String(v ?? "").replace(/[^0-9.\-]/g, "");
  const n = Number(t);
  return !/\d/.test(t) || !Number.isFinite(n) || n < 0 ? null : n;
};

export function makeLookups({ profiles = [], sources = [], services = [], lostReasons = [] }) {
  const byKey = new Map();
  for (const p of profiles) {
    byKey.set(norm(p.email), p.id);
    if (p.full_name) byKey.set(norm(p.full_name), p.id);
  }
  const idx = (rows, key) => new Map(rows.map((r) => [norm(r[key]), r.id]));
  return {
    user: (v) => byKey.get(norm(v)) ?? null,
    source: idx(sources, "name"),
    service: idx(services, "name"),
    lost: idx(lostReasons, "label"),
  };
}

/** Map one legacy Leads row. Returns { row, issues[] }; original values that can't be mapped are preserved in notes. */
export function mapLead(src, lk) {
  const issues = [];
  const legacy = [];
  const id = src["Lead ID"];
  if (!id) issues.push({ level: "error", msg: "missing Lead ID" });
  if (!src["Company Name"]) issues.push({ level: "error", msg: "missing Company Name" });
  const stage = STAGE_MAP[norm(src["Status"])];
  if (!stage) {
    issues.push({ level: "warn", msg: `unknown status "${src["Status"]}" -> new` });
    legacy.push(`Status: ${src["Status"]}`);
  }
  const prio = norm(src["Priority"]);
  const priority = ["high", "medium", "low"].includes(prio) ? prio : "medium";
  if (src["Priority"] && priority !== prio)
    issues.push({ level: "warn", msg: `unknown priority "${src["Priority"]}"` });
  const owner = lk.user(src["Assigned To"]);
  if (src["Assigned To"] && !owner) {
    issues.push({
      level: "warn",
      msg: `assignee "${src["Assigned To"]}" has no matching user; imported unassigned`,
    });
    legacy.push(`Assigned To: ${src["Assigned To"]}`);
  }
  const dates = {};
  for (const [col, key] of [
    ["Next Follow-up Date", "next_follow_up_at"],
    ["Last Follow-up Date", "last_contacted_at"],
    ["Created Date", "created_at"],
  ]) {
    const d = parseDate(src[col]);
    if (src[col] && !d) {
      issues.push({ level: "warn", msg: `unparseable ${col} "${src[col]}"` });
      legacy.push(`${col}: ${src[col]}`);
    }
    if (d) dates[key] = d;
  }
  const email = src["Email Address"];
  const emailOk = !email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  if (!emailOk) {
    issues.push({ level: "warn", msg: `invalid email "${email}" dropped` });
    legacy.push(`Email: ${email}`);
  }
  const prob = Number(src["Probability %"]);
  const notes = [src["Notes"], legacy.length ? `[legacy import] ${legacy.join(" | ")}` : ""]
    .filter(Boolean)
    .join("\n");
  return {
    issues,
    targetStage: stage ?? "new",
    row: {
      legacy_id: id,
      company_name: src["Company Name"],
      contact_name: src["Contact Person"] || null,
      phone: src["Phone Number"] || null,
      email: emailOk ? email || null : null,
      service_id: lk.service.get(norm(src["Service Requirement"])) ?? null,
      lead_source_id: lk.source.get(norm(src["Lead Source"])) ?? null,
      owner_id: owner,
      priority,
      estimated_value: parseMoney(src["Expected Deal Value"]),
      probability:
        Number.isFinite(prob) && prob >= 0 && prob <= 100 && src["Probability %"] !== ""
          ? Math.round(prob)
          : null,
      expected_close_date: parseDate(src["Expected Closing Date"])?.slice(0, 10) ?? null,
      notes: notes || null,
      ...dates,
    },
  };
}
export function mapClient(src, lk) {
  const issues = [];
  if (!src["Client ID"]) issues.push({ level: "error", msg: "missing Client ID" });
  if (!src["Company Name"]) issues.push({ level: "error", msg: "missing Company Name" });
  const st = norm(src["Project Status"]);
  const status = /complete|closed/.test(st)
    ? "active"
    : /hold|pause/.test(st)
      ? "paused"
      : /onboard|not started/.test(st)
        ? "onboarding"
        : "active";
  return {
    issues,
    row: {
      legacy_id: src["Client ID"],
      company_name: src["Company Name"],
      contact_name: src["Contact Person"] || null,
      phone: src["Phone Number"] || null,
      email: src["Email Address"] || null,
      relationship_owner_id: lk.user(src["Account Manager"]),
      status,
      notes: [
        src["Notes"],
        `[legacy] service=${src["Service Purchased"]}; value=${src["Project Value"]}; paid=${src["Amount Paid"]}; balance=${src["Balance Amount"]}; payment=${src["Payment Status"]}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
    project: {
      value: parseMoney(src["Project Value"]) ?? 0,
      service: src["Service Purchased"] || null,
      start: parseDate(src["Start Date"])?.slice(0, 10) ?? null,
      end: parseDate(src["Completion Date"])?.slice(0, 10) ?? null,
    },
  };
}
export function mapActivity(src, lk) {
  const issues = [];
  if (!src["Activity ID"]) issues.push({ level: "error", msg: "missing Activity ID" });
  const type = ACTIVITY_MAP[norm(src["Activity Type"])];
  if (!type)
    issues.push({ level: "warn", msg: `unknown activity type "${src["Activity Type"]}" -> other` });
  const user = lk.user(src["Owner"]) ?? lk.user(src["Created By"]);
  if (!user) issues.push({ level: "error", msg: `owner "${src["Owner"]}" has no matching user` });
  return {
    issues,
    company: src["Company"],
    row: {
      legacy_id: src["Activity ID"],
      user_id: user,
      activity_type: type ?? "other",
      subject: src["Activity Type"] || null,
      description: src["Discussion Summary"] || null,
      outcome: src["Outcome"] || null,
      next_action: src["Next Action"] || null,
      next_follow_up_at: parseDate(src["Next Follow-up Date"]),
      occurred_at:
        parseDate(src["Date"]) ?? parseDate(src["Created Date"]) ?? new Date().toISOString(),
    },
  };
}
export function mapTask(src, lk) {
  const issues = [];
  if (!src["Task ID"]) issues.push({ level: "error", msg: "missing Task ID" });
  if (!src["Task Title"]) issues.push({ level: "error", msg: "missing Task Title" });
  const status = TASK_STATUS_MAP[norm(src["Status"])] ?? "todo";
  const pr = norm(src["Priority"]);
  const assignee = lk.user(src["Assigned To"]);
  if (!assignee)
    issues.push({ level: "error", msg: `assignee "${src["Assigned To"]}" has no matching user` });
  return {
    issues,
    row: {
      legacy_id: src["Task ID"],
      title: src["Task Title"],
      description: src["Description"] || null,
      assigned_to: assignee,
      created_by: lk.user(src["Created By"]),
      priority: ["high", "medium", "low"].includes(pr) ? pr : "medium",
      status,
      due_at: parseDate(src["Due Date"]),
      completed_at:
        status === "completed"
          ? (parseDate(src["Last Updated Date"]) ?? new Date().toISOString())
          : null,
    },
  };
}
/** Detect duplicate legacy IDs within a file; returns Set of IDs that appear more than once. */
export function duplicateIds(rows, col) {
  const seen = new Set(),
    dup = new Set();
  for (const r of rows) {
    const v = r[col];
    if (!v) continue;
    (seen.has(v) ? dup : seen).add(v);
  }
  return dup;
}
