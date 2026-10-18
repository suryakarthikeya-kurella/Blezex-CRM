-- DEVELOPMENT ONLY (run by `supabase db reset`). No users, no production data, no secrets.
-- Create people through scripts/bootstrap-admin.mjs and the Team page; then create teams here or in the UI.
insert into public.teams (name, description) values ('Sales Team A', 'Dev sample team') on conflict (name) do nothing;
