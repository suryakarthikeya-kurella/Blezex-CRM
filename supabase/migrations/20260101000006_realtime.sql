-- BlezeX Connect — 0006: realtime for the notification bell only (one narrow, per-recipient channel).
-- Guarded so the migration also runs on plain Postgres without the Supabase publication.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
