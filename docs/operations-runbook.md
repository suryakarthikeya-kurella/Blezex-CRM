# Operations runbook
**Supabase Free plan** (verify current limits at supabase.com/pricing; they change): small DB size cap, projects pause after inactivity, no point-in-time recovery, limited auth emails. Monitor: Dashboard → Reports (DB size, egress, auth). Design choices that keep usage low: paginated queries, DB-side aggregation, indexes on all filter columns, one realtime channel (own notifications), no polling, no file storage. Upgrade path: Pro plan needs no code change.
**Backups**: before each migration/import run `pg_dump` of the project (connection string from dashboard) and store encrypted. Keep original Sheets export read-only.
**Onboard/offboard**: Team → Invite / Deactivate (lock-out is immediate; records and audit stay). Lost admin: run `bootstrap-admin` only works if no admin exists; otherwise another admin resets the password.
**Incident: suspected leak** — rotate service-role + publishable keys in Supabase, redeploy, review `audit_logs` (admin) for the window.
**Stuck lead / bad data** — fix via the UI; for DB-level fixes use a migration (audit trigger records the actor as NULL/system for service-role changes).
**Tests before release**: `npm run check` and `npm run test:db` (needs local Postgres; see README).


## Backup and restore
- **Backups:** Supabase takes daily backups (Pro plan: point-in-time recovery). Before any migration that rewrites data, take a manual backup in Dashboard → Database → Backups, or `supabase db dump --linked -f backup.sql` (schema) and `--data-only` for data. Store dumps outside the repo (they contain personal data).
- **Restore drill (quarterly):** restore the latest backup into a throw-away project, point a local `.env.local` at it, sign in as an admin, and confirm leads, clients, invoices and attendance look right. Files live in Storage (bucket `attachments`); include them in the drill.
- **Migrations:** never edit an applied migration; add a new one. `supabase db push --dry-run` first. Removed features are reversed by a new migration (see 0009 → 0010).
- **Lost authenticator:** Team → Reset 2FA for the user, then they sign in and enrol again.
- **Leaver:** Team → Offboard, choose who inherits open work. Use Delete only for accounts with no records.
- **Auth settings** live in `supabase/config.toml`; preview with `supabase config diff`, apply with `supabase config push`.
