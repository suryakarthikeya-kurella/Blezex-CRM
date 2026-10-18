# Implementation status report

## Verified results (commands actually run in this environment)
| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npx eslint .` | ✅ 0 errors, 13 warnings (react-refresh warnings in untouched shadcn files + `auth.tsx` hook export) |
| `npx vitest run` | ✅ 16/16 (permissions map, CSV escaping/formula safety, search sanitiser, error mapping, migration mapping) |
| `npm run build` | ✅ client → `dist/client`; SSR/server fns → `.netlify/v1/functions/server.mjs` (Netlify plugin) |
| `scripts/db-test.sh` (PostgreSQL 16, migrations 0001–0006 applied from scratch) | ✅ **273 assertions passed, 0 failed** + 5 parallel-session concurrency tests |
| Migration dry-run on fixtures | ✅ reconciles (5 leads → 3 valid + 2 rejected; every exception listed) |

DB tests cover: anon denied; employee isolation; no self-promotion; protected lead fields (owner/stage/converted/archived/number); mentor scope & cross-team denial; mentor cannot touch settings/targets/memberships; financial tables admin-only; audit log immutable (even superuser, incl. TRUNCATE); deactivated users/mentors lose access with a live JWT; forged JWT claims don't escalate; RLS on all tables; anon has no grants; stage gates + qualification score; optimistic concurrency; atomic conversion with **rollback proof**, idempotent replay, scoped handover; tasks (no cross-assign, idempotent retry, completed_at); daily-report metrics derived; approvals/coaching; duplicate detection; reports scoped by role; targets; last-admin protection; invoices/payments (partial, refund, duplicate ref, overpay, failed/cancelled, immutability); proposals (24h follow-up); concurrent: 200 inserts → 200 distinct numbers, 4 simultaneous conversions → 1 client, 3 concurrent payments → 1 accepted, stale writer rejected, concurrent reassignment → 1 open assignment.
**Caveat:** these ran on plain Postgres with a shim emulating Supabase roles/`auth.uid()`. They have **not** been run on a real Supabase project; re-run the RLS suite there before go-live.

## Features
**Completed (code + evidence above):** Supabase Auth integration (no signup, sign-in/out, recovery, invite flow, deactivation, role change via verified server functions); full schema/RLS/RPC layer; role-aware shell, three dashboards on real DB aggregates; leads table (search, filters, sort, pagination, CSV, bulk assign, quick stage) + Kanban (drag-drop, optimistic rollback, keyboard-accessible selector); lead detail (timeline, qualification, activities, tasks, proposals, ownership history, follow-up presets 1/3/7/14/21); atomic Won conversion + client handover; activities; tasks + comments; clients; team admin (users, teams, memberships, targets) & mentor team view + coaching notes; daily reports; reports (employee, team, source, lost reasons, monthly, targets, revenue); invoices & payments; approvals/escalations; audit log viewer; notifications (bell + page, realtime); settings (stages, sources, services, lost reasons, rules); access-denied; Netlify config; migration utility; docs.
**Partially completed:** UI tests — only logic unit tests; no browser/e2e or accessibility audit run. Typed DB definitions are hand-written (`db-types.ts`), not generated. Audit/permission docs OK but `docs` not exhaustively reviewed by a human. Proposals/projects have no standalone list pages (accessible from lead/client pages). Stage-transition rules are "no skipping rules except Won/Lost/qualification gate" (no per-stage transition matrix editor). Notifications are event-driven (assignment, stage, task, approval, win); follow-up/overdue reminders surface via the action centre/dashboard, not pushed notifications. Saved filters: table exists, no UI.
**Blocked (needs you):** Supabase project + running migrations there; real data migration and reconciliation (no sheet export access); Netlify deployment, domain/HTTPS, smoke tests; SMTP setup.
**Not started / deferred:** Import UI page (use the CLI); invoice PDF; attachments/storage; scheduled reminder emails; 2FA; cookie-based sessions; quote/discount approval automation (approval requests are recorded and notified, not auto-applied except soft-delete of leads); i18n; dark mode (intentionally excluded).

## Decisions / deviations
- Replaced `bun.lock`/stale `package-lock.json` with a regenerated `package-lock.json`.
- `vite.config.ts`: Lovable's Nitro/Cloudflare target disabled in favour of Netlify's official plugin (Lovable's in-editor preview/publish path will no longer be the deployment route).
- Old `crm-schema.ts` moved to `scripts/legacy/`; `sheets.server.ts`, `crm.functions.ts`, `crm-hooks.ts` removed (Sheets no longer in the active path).
- Employees can convert their own leads (the brief lets them view handovers for "their own converted opportunities"); change in `convert_lead_to_client` if you want mentor/admin only.
- Mentors have **no** finance access (spec default).

## Manual steps remaining
1. Create Supabase project(s); disable signups; SMTP; apply migrations; run `bootstrap-admin`. 2. Re-run `supabase/tests` against a Supabase-backed Postgres. 3. Set Netlify env vars per `docs/deployment.md`. 4. **Rotate/retire the leaked legacy credentials and Sheet access** (they live in Git history). 5. Export sheets → dry-run → staging import → reconcile → cut over. 6. Browser smoke test of each role and an accessibility pass.

## Risks
Client session tokens in localStorage (see security.md); first run against real Supabase may expose environment differences from the shim (extensions schema, grants on `auth`); Free-plan limits (no PITR, project pausing) — take manual backups; `react-refresh` warnings are cosmetic.
