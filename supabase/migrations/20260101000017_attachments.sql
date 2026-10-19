-- BlezeX Connect — 0017: file attachments on leads and clients (private Supabase Storage bucket).
-- Access to a file is exactly access to its lead/client: the `attachments` table carries the RLS rules
-- (can_access_lead / can_access_client), and the storage policies only allow reading/uploading an object that
-- has a matching, visible attachments row. Files are limited to 10 MB. The bucket is private; the app hands out
-- short-lived signed links. (Storage policies are skipped on a plain-Postgres test database, which has no
-- storage schema; the table rules are covered by supabase/tests/20_attachments.sql.)

create table public.attachments (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid references public.leads(id) on delete cascade,
  client_id   uuid references public.clients(id) on delete cascade,
  path        text not null unique check (path ~ '^[0-9a-f-]{36}/[^/]{1,200}$'),   -- <uuid>/<file name> inside the bucket
  file_name   text not null check (length(btrim(file_name)) > 0),
  mime_type   text,
  size_bytes  bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  check ((lead_id is not null) <> (client_id is not null))
);
create index attachments_lead_idx   on public.attachments (lead_id)   where lead_id is not null;
create index attachments_client_idx on public.attachments (client_id) where client_id is not null;
create trigger audit_attachments after insert or update or delete on public.attachments for each row execute function app.audit_row();

alter table public.attachments enable row level security;
revoke all on public.attachments from anon, authenticated;
grant select on public.attachments to authenticated;
grant insert (lead_id, client_id, path, file_name, mime_type, size_bytes, uploaded_by) on public.attachments to authenticated;
grant delete on public.attachments to authenticated;

create policy attachments_select on public.attachments for select to authenticated
  using ((lead_id is not null and app.can_access_lead(lead_id)) or (client_id is not null and app.can_access_client(client_id)));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (uploaded_by = (select app.me())
    and ((lead_id is not null and app.can_access_lead(lead_id)) or (client_id is not null and app.can_access_client(client_id))));
create policy attachments_delete on public.attachments for delete to authenticated
  using (uploaded_by = (select app.me()) or (select app.is_admin()));

do $$ begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('attachments', 'attachments', false, 10485760)
    on conflict (id) do update set public = false, file_size_limit = 10485760;

    -- read: only objects whose attachments row the caller can see (that row's own RLS applies)
    create policy attachments_object_read on storage.objects for select to authenticated
      using (bucket_id = 'attachments' and exists (select 1 from public.attachments a where a.path = name));
    -- upload: only to a path the caller has just registered as their own attachment
    create policy attachments_object_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'attachments' and exists (
        select 1 from public.attachments a where a.path = name and a.uploaded_by = (select app.me())));
    -- delete: the uploader or an admin (the app removes the object first, then the row)
    create policy attachments_object_delete on storage.objects for delete to authenticated
      using (bucket_id = 'attachments' and exists (
        select 1 from public.attachments a where a.path = name and (a.uploaded_by = (select app.me()) or (select app.is_admin()))));
  end if;
end $$;
