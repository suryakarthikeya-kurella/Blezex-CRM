# BlezeX Connect — CRM & Sales Operations

React 19 · TanStack Start · Tailwind 4 · shadcn/ui · Supabase (Postgres, Auth, RLS) · Netlify.
Three workspaces from one codebase: **Admin**, **Mentor**, **BDS Employee** — authorised by the database, not the UI.

```bash
cp .env.example .env.local      # fill Supabase values
npm install
npm run dev
npm run check                   # typecheck + lint + unit tests + production build
npm run test:db                 # builds a throwaway Postgres from supabase/migrations and runs 270+ SQL security/integrity tests
```
`test:db` needs a local PostgreSQL server (set `PSQL_AS_POSTGRES=1` if you reach it via `su postgres`); it uses `supabase/tests/00_supabase_shim.sql` to emulate Supabase roles/`auth.uid()`.

Docs: `docs/architecture-audit.md` · `architecture.md` · `permissions-matrix.md` · `database-schema.md` · `security.md` · `data-migration.md` · `deployment.md` · `operations-runbook.md` · `status-report.md`.
Google Sheets is no longer used by the app; `scripts/migrate-sheets.mjs` is a one-off importer, `scripts/legacy/` holds the old column definitions for reference.
