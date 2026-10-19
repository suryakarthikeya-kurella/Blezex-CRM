-- BlezeX Connect — 0014: security hardening.
--  1. Two-factor authentication enforced IN THE DATABASE. A user with a verified TOTP factor is only "someone"
--     (app.me()/my_role()/is_admin()/is_mentor() resolve) when their JWT is aal2, i.e. the second factor was
--     proven. Every RLS policy and every SECURITY DEFINER function is built on those helpers, so an aal1 token
--     (password only) gets exactly what a deactivated user gets: nothing. Users without a verified factor are
--     unaffected. Enrolment is optional per user; admins can reset a lost factor.
--  2. Leave escalation: an admin may decide an employee's leave that has waited more than 48 hours (the mentor
--     may be away); before that only the assigned mentor can.
--  3. offboard_user(): move a leaver's open work to someone else and deactivate them in one transaction.

-- ───────── 1. MFA ─────────
create function app.mfa_ok() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
$$;
grant execute on function app.mfa_ok() to authenticated;

create or replace function app.me() returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where p.id = auth.uid() and p.is_active and app.mfa_ok()
$$;
create or replace function app.my_role() returns text language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active and app.mfa_ok()
$$;
create or replace function app.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'admin' from public.profiles p where p.id = auth.uid() and p.is_active and app.mfa_ok()), false)
$$;
create or replace function app.is_mentor() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'mentor' from public.profiles p where p.id = auth.uid() and p.is_active and app.mfa_ok()), false)
$$;

-- ───────── 2. leave escalation ─────────
create function app.can_decide_leave_request(p_applicant uuid, p_created timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can_decide_leave(p_applicant)
      or (app.is_admin() and p_applicant is distinct from app.me() and p_created < now() - interval '48 hours')
$$;
grant execute on function app.can_decide_leave_request(uuid, timestamptz) to authenticated;

create or replace view public.leave_request_details with (security_invoker = true) as
  select l.*, app.leave_working_days(l.start_date, l.end_date) as days,
         (l.status = 'pending' and app.can_decide_leave_request(l.user_id, l.created_at)) as can_decide
  from public.leave_requests l;

create or replace function public.decide_leave_request(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.me(); l public.leave_requests;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into l from public.leave_requests where id = p_id for update;
  if not found then raise exception 'leave request not found' using errcode = 'P0002'; end if;
  if not app.can_decide_leave_request(l.user_id, l.created_at) then
    raise exception 'you are not an approver for this request' using errcode = '42501'; end if;
  if l.status <> 'pending' then raise exception 'request already %', l.status using errcode = '23514'; end if;
  update public.leave_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_me, decided_at = now(), decision_note = nullif(btrim(p_note), '') where id = p_id;
  perform app.notify(l.user_id, 'leave_decided', 'Leave ' || case when p_approve then 'approved' else 'rejected' end,
                     l.start_date::text || ' to ' || l.end_date::text || coalesce(': ' || nullif(btrim(p_note), ''), ''),
                     'leave_requests', p_id::text);
end $$;

-- ───────── 3. offboarding ─────────
-- Reassigns: open (not won/lost, not archived) leads, open tasks, client relationships; ends team memberships;
-- deactivates the profile. Everything lands in the audit log under the admin's identity (triggers). The caller
-- must also ban the auth user (the server function does) so existing sessions can't refresh.
create function public.offboard_user(p_user uuid, p_to uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.me(); v_ids uuid[]; v_leads int := 0; v_tasks int := 0; v_clients int := 0; v_members int := 0;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not app.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_user = v_me then raise exception 'you cannot offboard yourself' using errcode = '42501'; end if;
  if p_to is null or p_to = p_user then raise exception 'choose someone else to take over' using errcode = '22023'; end if;
  perform 1 from public.profiles where id = p_user for update;
  if not found then raise exception 'user not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.profiles where id = p_to and is_active) then
    raise exception 'the receiving user must be active' using errcode = 'P0002'; end if;

  select coalesce(array_agg(x.id), '{}') into v_ids from (
    select l.id from public.leads l
     where l.owner_id = p_user and l.archived_at is null
       and not exists (select 1 from public.pipeline_stages s where s.key = l.stage and (s.is_won or s.is_lost))
     for update) x;
  v_leads := cardinality(v_ids);
  update public.lead_assignments set unassigned_at = now() where unassigned_at is null and lead_id = any (v_ids);
  insert into public.lead_assignments (lead_id, assigned_to, assigned_by, reason)
    select unnest(v_ids), p_to, v_me, 'Offboarding';
  update public.leads set owner_id = p_to where id = any (v_ids);

  update public.tasks set assigned_to = p_to where assigned_to = p_user and status in ('todo','in_progress');
  get diagnostics v_tasks = row_count;
  update public.clients set relationship_owner_id = p_to where relationship_owner_id = p_user;
  get diagnostics v_clients = row_count;
  update public.team_memberships set is_active = false, ended_at = now() where user_id = p_user and is_active;
  get diagnostics v_members = row_count;
  update public.leave_requests set status = 'cancelled' where user_id = p_user and status = 'pending';
  update public.profiles set is_active = false where id = p_user;

  perform app.notify(p_to, 'offboarding', 'Work handed over to you',
                     v_leads || ' lead(s), ' || v_tasks || ' task(s), ' || v_clients || ' client(s)', 'profiles', p_user::text);
  return jsonb_build_object('leads', v_leads, 'tasks', v_tasks, 'clients', v_clients, 'memberships', v_members);
end $$;

do $$ declare f text; begin
  foreach f in array array['public.decide_leave_request(uuid,boolean,text)', 'public.offboard_user(uuid,uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
