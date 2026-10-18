# Deployment (Supabase + Netlify)
**Not yet deployed.** The build is verified locally; no Supabase or Netlify account was available.

1. **Supabase project** (separate projects for dev/staging/prod). Settings → Auth: *disable sign-ups*, set Site URL, add redirect `https://<domain>/reset-password`, min password 10, configure SMTP.
2. **Migrations**: `supabase link --project-ref <ref>` then `supabase db push` (review with `supabase db diff`). Never run against prod without a backup/approval. First admin: run `scripts/bootstrap-admin.mjs` once (env vars in header).
3. **Env** (Netlify → Site settings → Environment variables; scope per context):
| Var | Scope | Notes |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Builds (all contexts) | public by design |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Functions runtime | server-side |
| `SUPABASE_SERVICE_ROLE_KEY` | **Functions runtime only, production + deploy-preview use a *non-prod* project** | never `VITE_`, never in previews pointing at prod |
| `SITE_URL` | Functions | used in invite/reset links |
4. **Netlify**: connect the GitHub repo; `netlify.toml` already sets build `npm run build`, publish `dist/client`, Node 22. Branch deploys/previews → staging Supabase.
5. **Domain/HTTPS**: add custom domain in Netlify; certificate is automatic; update Supabase Site URL/redirects.
6. **Smoke tests**: sign in as each role; employee cannot open /settings or /finance; create lead → convert → client appears with handover; deactivate a test user and confirm immediate lock-out; reset-password email arrives; dashboard loads.
7. **Rollback**: Netlify → Deploys → *Publish deploy* on the last good build (instant). DB: migrations are forward-only — restore from backup/PITR (Free plan has no PITR: take manual `pg_dump` before each migration) or ship a corrective migration.
Local dev: `supabase start` (uses `supabase/config.toml`), copy `.env.example` → `.env.local`, `npm run dev`.
