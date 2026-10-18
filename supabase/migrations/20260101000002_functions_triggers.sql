-- BlezeX Connect — 0002: authorization helpers, numbering, integrity, audit and notification triggers.
-- All helpers are SECURITY DEFINER with an empty search_path and read trusted rows (profiles,
-- team_memberships) — never JWT claims or user metadata — so a user cannot influence their own role.

-- ───────── identity helpers (private `app` schema, not exposed through the API) ─────────
create function app.me() returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where p.id = auth.uid() and p.is_active
$$;
create function app.my_role() returns text language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;
create function app.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'admin' from public.profiles p where p.id = auth.uid() and p.is_active), false)
$$;
create function app.is_mentor() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'mentor' from public.profiles p where p.id = auth.uid() and p.is_active), false)
$$;
-- True when the caller is an active mentor who actively mentors `target` through a shared active team.
create function app.mentors_user(target uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select target is not null and app.is_mentor() and exists (
    select 1
    from public.team_memberships mm
    join public.team_memberships tm on tm.team_id = mm.team_id and tm.is_active
    join public.teams t on t.id = mm.team_id and t.status = 'active'
    where mm.user_id = auth.uid() and mm.membership_role = 'mentor' and mm.is_active
      and tm.user_id = target and tm.user_id <> mm.user_id)
$$;
create function app.can_see_user(target uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select target is not null and (target = app.me() or app.is_admin() or app.mentors_user(target))
$$;
create function app.can_access_lead(p_lead uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.leads l where l.id = p_lead
    and (app.is_admin() or l.owner_id = app.me() or app.mentors_user(l.owner_id)))
$$;
create function app.can_access_client(p_client uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clients c where c.id = p_client
    and (app.is_admin() or c.relationship_owner_id = app.me() or app.mentors_user(c.relationship_owner_id)
         or (c.source_lead_id is not null and app.can_access_lead(c.source_lead_id))))
$$;
create function app.can_access_task(p_task uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tasks t where t.id = p_task
    and (app.is_admin() or t.assigned_to = app.me() or t.created_by = app.me()
         or app.mentors_user(t.assigned_to)))
$$;
create function app.setting(p_key text) returns jsonb language sql stable security definer set search_path = '' as $$
  select value from public.app_settings where key = p_key
$$;

create function app.notify(p_recipient uuid, p_type text, p_title text, p_message text default null,
                           p_entity_type text default null, p_entity_id text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (recipient_id, type, title, message, entity_type, entity_id)
  select p_recipient, p_type, p_title, p_message, p_entity_type, p_entity_id
  where p_recipient is not null and exists (select 1 from public.profiles where id = p_recipient and is_active)
$$;

-- ───────── generic triggers ─────────
create function app.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Business numbers come from sequences (atomic under concurrency). A pre-set value (legacy import) is preserved.
create function app.assign_number() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_col text := tg_argv[2];
begin
  if coalesce(to_jsonb(new) ->> v_col, '') = '' then
    new := jsonb_populate_record(new, jsonb_build_object(
      v_col, tg_argv[0] || '-' || lpad(nextval(tg_argv[1]::regclass)::text, 6, '0')));
  end if;
  return new;
end $$;

create trigger leads_number     before insert on public.leads     for each row execute function app.assign_number('LD','app.lead_seq','lead_number');
create trigger clients_number   before insert on public.clients   for each row execute function app.assign_number('CL','app.client_seq','client_number');
create trigger projects_number  before insert on public.projects   for each row execute function app.assign_number('PR','app.project_seq','project_number');
create trigger proposals_number before insert on public.proposals  for each row execute function app.assign_number('PP','app.proposal_seq','proposal_number');
create trigger invoices_number  before insert on public.invoices   for each row execute function app.assign_number('INV','app.invoice_seq','invoice_number');

create trigger profiles_updated  before update on public.profiles  for each row execute function app.set_updated_at();
create trigger teams_updated     before update on public.teams     for each row execute function app.set_updated_at();
create trigger targets_updated   before update on public.user_targets for each row execute function app.set_updated_at();
create trigger clients_updated   before update on public.clients   for each row execute function app.set_updated_at();
create trigger projects_updated  before update on public.projects  for each row execute function app.set_updated_at();
create trigger proposals_updated before update on public.proposals for each row execute function app.set_updated_at();
create trigger invoices_updated  before update on public.invoices  for each row execute function app.set_updated_at();
create trigger tasks_updated     before update on public.tasks     for each row execute function app.set_updated_at();
create trigger comments_updated  before update on public.task_comments for each row execute function app.set_updated_at();
create trigger reports_updated   before update on public.daily_reports for each row execute function app.set_updated_at();

-- ───────── profile provisioning ─────────
-- New auth users get an INACTIVE employee profile. Role/activation happen only through an admin path.
-- Nothing is read from user-editable metadata except a display name.
create function app.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, role, is_active)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'bds_employee', false)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function app.handle_new_user();

create function app.sync_profile_email() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = coalesce(new.email, email) where id = new.id and email is distinct from new.email;
  return new;
end $$;
create trigger on_auth_user_email after update of email on auth.users for each row execute function app.sync_profile_email();

-- Never leave the system without an active admin.
create function app.protect_last_admin() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.is_active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.is_active)
     and not exists (select 1 from public.profiles where role = 'admin' and is_active and id <> old.id) then
    raise exception 'cannot remove or deactivate the last active admin' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger profiles_last_admin before update or delete on public.profiles for each row execute function app.protect_last_admin();

-- ───────── leads ─────────
create function app.leads_before() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by is null then new.created_by := app.me(); end if;
  else
    new.row_version := old.row_version + 1;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger leads_before before insert or update on public.leads for each row execute function app.leads_before();

create function app.leads_after_insert() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.lead_stage_history (lead_id, from_stage, to_stage, actor_id, note)
  values (new.id, null, new.stage, coalesce(app.me(), new.created_by), 'Lead created');
  if new.owner_id is not null then
    insert into public.lead_assignments (lead_id, assigned_to, assigned_by, reason)
    values (new.id, new.owner_id, coalesce(app.me(), new.created_by), 'Initial assignment');
  end if;
  return new;
end $$;
create trigger leads_after_insert after insert on public.leads for each row execute function app.leads_after_insert();

-- ───────── activities → keep lead contact fields current ─────────
create function app.activities_after_insert() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is not null then
    update public.leads l set
      last_contacted_at = case when new.activity_type in ('call','email','whatsapp','meeting','demo','follow_up','proposal')
                               then greatest(coalesce(l.last_contacted_at, new.occurred_at), new.occurred_at)
                               else l.last_contacted_at end,
      next_follow_up_at = coalesce(new.next_follow_up_at, l.next_follow_up_at)
    where l.id = new.lead_id;
  end if;
  return new;
end $$;
create trigger activities_after_insert after insert on public.activities for each row execute function app.activities_after_insert();

-- ───────── tasks ─────────
create function app.tasks_before() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by is null then new.created_by := app.me(); end if;
  elsif new.assigned_to is distinct from old.assigned_to and auth.uid() is not null then
    -- reassignment: admin, or a mentor moving work to someone on their team
    if not (app.is_admin() or app.mentors_user(new.assigned_to)) then
      raise exception 'not authorized to reassign this task' using errcode = '42501';
    end if;
  end if;
  if new.status = 'completed' and new.completed_at is null then new.completed_at := now(); end if;
  if new.status <> 'completed' then new.completed_at := null; end if;
  return new;
end $$;
create trigger tasks_before before insert or update on public.tasks for each row execute function app.tasks_before();

create function app.tasks_after() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assigned_to is distinct from coalesce(app.me(), new.created_by)
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    perform app.notify(new.assigned_to, 'task_assigned', 'New task assigned', new.title, 'tasks', new.id::text);
  end if;
  return new;
end $$;
create trigger tasks_after after insert or update of assigned_to on public.tasks for each row execute function app.tasks_after();

-- ───────── daily reports: metrics derived from source rows, never trusted from the client ─────────
create function app.daily_reports_before() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_tz text := coalesce(app.setting('company') ->> 'timezone', 'Asia/Kolkata');
begin
  new.leads_created := (select count(*) from public.leads l
    where l.created_by = new.user_id and (l.created_at at time zone v_tz)::date = new.report_date);
  new.outreach_completed := (select count(*) from public.activities a
    where a.user_id = new.user_id and (a.occurred_at at time zone v_tz)::date = new.report_date
      and a.activity_type in ('call','email','whatsapp','follow_up','meeting','demo'));
  new.meetings_booked := (select count(*) from public.lead_stage_history h
    where h.actor_id = new.user_id and h.to_stage = 'meeting_scheduled'
      and (h.changed_at at time zone v_tz)::date = new.report_date);
  new.proposals_sent := (select count(*) from public.proposals p
    where p.created_by = new.user_id and p.sent_at is not null and (p.sent_at at time zone v_tz)::date = new.report_date);
  if tg_op = 'INSERT' then new.submitted_at := now(); end if;
  return new;
end $$;
create trigger daily_reports_before before insert or update on public.daily_reports for each row execute function app.daily_reports_before();

-- ───────── proposals ─────────
create function app.proposals_before() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_hours numeric := coalesce((app.setting('proposal.followup_hours') #>> '{}')::numeric, 24);
begin
  if tg_op = 'INSERT' and new.created_by is null then new.created_by := app.me(); end if;
  if new.status = 'sent' and new.sent_at is null then new.sent_at := now(); end if;
  if new.status = 'sent' and new.followup_due_at is null then
    new.followup_due_at := new.sent_at + make_interval(hours => v_hours::int);
  end if;
  return new;
end $$;
create trigger proposals_before before insert or update on public.proposals for each row execute function app.proposals_before();

-- ───────── billing integrity ─────────
-- Net received = completed payments − completed refunds. Computed in one place.
create function app.invoice_net_received(p_invoice uuid, p_exclude uuid default null) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0)
  from public.payments where invoice_id = p_invoice and status = 'completed' and id is distinct from p_exclude
$$;

create function app.payments_before() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_inv public.invoices%rowtype; v_net numeric;
begin
  select * into v_inv from public.invoices where id = new.invoice_id for update;   -- serialises concurrent payments
  if not found then raise exception 'invoice not found' using errcode = '23503'; end if;
  if tg_op = 'INSERT' and new.recorded_by is null then new.recorded_by := app.me(); end if;
  if v_inv.status in ('draft','cancelled') and new.status in ('pending','completed') then
    raise exception 'cannot record a payment against a % invoice', v_inv.status using errcode = '23514';
  end if;
  if new.status = 'completed' then
    v_net := app.invoice_net_received(new.invoice_id, case when tg_op = 'UPDATE' then new.id end)
             + case when new.kind = 'payment' then new.amount else -new.amount end;
    if v_net > v_inv.total then raise exception 'payment exceeds invoice balance' using errcode = '23514'; end if;
    if v_net < 0 then raise exception 'refund exceeds amount received' using errcode = '23514'; end if;
  end if;
  return new;
end $$;
create trigger payments_before before insert or update on public.payments for each row execute function app.payments_before();

create function app.payments_after() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_net numeric; v_total numeric; v_status text;
begin
  select total, status into v_total, v_status from public.invoices where id = new.invoice_id;
  if v_status in ('issued','partially_paid','paid') then
    v_net := app.invoice_net_received(new.invoice_id);
    update public.invoices set status = case when v_net >= v_total then 'paid' when v_net > 0 then 'partially_paid' else 'issued' end
    where id = new.invoice_id;
  end if;
  return new;
end $$;
create trigger payments_after after insert or update on public.payments for each row execute function app.payments_after();

create function app.invoices_before() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by is null then new.created_by := app.me(); end if;
  else
    if new.total < app.invoice_net_received(old.id) then
      raise exception 'invoice total cannot be below amount already received' using errcode = '23514';
    end if;
    if new.status = 'cancelled' and app.invoice_net_received(old.id) > 0 then
      raise exception 'refund received payments before cancelling this invoice' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger invoices_before before insert or update on public.invoices for each row execute function app.invoices_before();

-- ───────── approvals → notify admins and the requester's mentors ─────────
create function app.approvals_after_insert() returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select p.id from public.profiles p where p.is_active and p.id <> new.requested_by and (
      p.role = 'admin' or exists (
        select 1 from public.team_memberships mm join public.team_memberships tm on tm.team_id = mm.team_id and tm.is_active
        where mm.user_id = p.id and mm.membership_role = 'mentor' and mm.is_active
          and tm.user_id = new.requested_by and p.role = 'mentor'))
  loop
    perform app.notify(r.id, 'approval_requested', 'New ' || replace(new.request_type, '_', ' ') || ' request',
                       new.reason, 'approval_requests', new.id::text);
  end loop;
  return new;
end $$;
create trigger approvals_after_insert after insert on public.approval_requests for each row execute function app.approvals_after_insert();

create function app.settings_before() returns trigger language plpgsql security definer set search_path = '' as $$
begin new.updated_at := now(); new.updated_by := app.me(); return new; end $$;
create trigger settings_before before update on public.app_settings for each row execute function app.settings_before();

-- ───────── audit log: written only by triggers, immutable for everyone ─────────
create function app.audit_row() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb; v_new jsonb; v_id text;
  v_strip text[] := array['password','token','secret','access_token','refresh_token','api_key'];
begin
  if tg_op in ('UPDATE','DELETE') then v_old := to_jsonb(old) - v_strip; end if;
  if tg_op in ('INSERT','UPDATE') then v_new := to_jsonb(new) - v_strip; end if;
  if tg_op = 'UPDATE' and (v_old - 'updated_at' - 'row_version') = (v_new - 'updated_at' - 'row_version') then
    return new;
  end if;
  v_id := coalesce(v_new, v_old) ->> (case when tg_table_name = 'app_settings' then 'key' else 'id' end);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), lower(tg_op), tg_table_name, v_id, v_old, v_new);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','teams','team_memberships','user_targets','leads','lead_assignments','clients',
    'projects','proposals','invoices','payments','tasks','approval_requests','app_settings','pipeline_stages',
    'lost_reasons','lead_sources','services','import_jobs','coaching_notes']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function app.audit_row()', t);
  end loop;
end $$;

create function app.audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_logs is append-only' using errcode = '42501'; end $$;
create trigger audit_logs_no_update before update or delete on public.audit_logs for each row execute function app.audit_immutable();
create trigger audit_logs_no_truncate before truncate on public.audit_logs for each statement execute function app.audit_immutable();
