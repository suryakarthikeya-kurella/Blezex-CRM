-- BlezeX Connect — 0008: leave requests, integrated with attendance.
-- Additive, except that public.attendance_report() is dropped and recreated with one extra column
-- (leave_type) and the 'on_leave' status; its grants are re-issued below. 0007 is already applied remotely,
-- so this is a new migration rather than an edit of 0007.
--
-- Routing (decided in SQL, never in the browser):
--   employee  → the employee's active mentor(s) (mentor of an active team the employee belongs to);
--               if the employee has no active mentor, any active admin (so a request is never orphaned)
--   mentor    → any active admin
--   admin     → no leave (admins have no attendance)
-- Approved leave is NOT copied into attendance: the report derives 'on_leave' from approved requests, so
-- cancelling or changing a request can never leave stale attendance rows behind.

create table public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id),
  leave_type    text not null check (leave_type in ('casual','sick','earned','unpaid','other')),
  start_date    date not null,
  end_date      date not null,
  reason        text not null check (length(btrim(reason)) > 0),
  status        text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by    uuid references public.profiles(id),
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date <= 59)
);
create index leave_requests_user_idx    on public.leave_requests (user_id, start_date desc);
create index leave_requests_status_idx  on public.leave_requests (status, created_at desc);
create index leave_requests_approved_idx on public.leave_requests (user_id, start_date, end_date) where status = 'approved';
create trigger leave_requests_updated before update on public.leave_requests for each row execute function app.set_updated_at();

-- ───────── routing & authorisation helpers ─────────
-- Active mentors of an employee: mentor membership of an active team the employee actively belongs to.
create function app.user_mentors(p_user uuid) returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct mm.user_id
  from public.team_memberships mm
  join public.teams t on t.id = mm.team_id and t.status = 'active'
  join public.team_memberships tm on tm.team_id = mm.team_id and tm.is_active
  join public.profiles a on a.id = mm.user_id and a.is_active and a.role = 'mentor'
  where mm.membership_role = 'mentor' and mm.is_active and tm.user_id = p_user and mm.user_id <> p_user
$$;
create function app.leave_approvers(p_user uuid) returns setof uuid language sql stable security definer set search_path = '' as $$
  select a.id
  from public.profiles u join public.profiles a on a.is_active
  where u.id = p_user and (
        (u.role = 'mentor' and a.role = 'admin')
     or (u.role = 'bds_employee' and (a.id in (select app.user_mentors(p_user))
          or (a.role = 'admin' and not exists (select 1 from app.user_mentors(p_user))))))
$$;
create function app.can_decide_leave(p_applicant uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select app.me() is not null and p_applicant is distinct from app.me() and app.me() in (select app.leave_approvers(p_applicant))
$$;
-- Working days in [from, to]: weekly offs and holidays from the attendance policy are not counted.
create function app.leave_working_days(p_from date, p_to date) returns int language sql stable set search_path = '' as $$
  with pol as (select app.attendance_policy() as p)
  select count(*)::int
  from pol, generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  where not (extract(dow from d)::int = any (array(select e::int from jsonb_array_elements_text(pol.p -> 'weekly_offs') e)))
    and not (d::date = any (array(select e::date from jsonb_array_elements_text(pol.p -> 'holidays') e)))
$$;
grant execute on function app.can_decide_leave(uuid), app.leave_working_days(date,date) to authenticated;

-- ───────── RLS: read-only for clients, writes through RPC ─────────
revoke all on public.leave_requests from anon, authenticated;
alter table public.leave_requests enable row level security;
grant select on public.leave_requests to authenticated;
-- own requests; admin: everyone's; mentor: their assigned employees' (never another mentor's)
create policy leave_requests_select on public.leave_requests for select to authenticated
  using (app.can_see_attendance(user_id));

create view public.leave_request_details with (security_invoker = true) as
  select l.*, app.leave_working_days(l.start_date, l.end_date) as days,
         (l.status = 'pending' and app.can_decide_leave(l.user_id)) as can_decide
  from public.leave_requests l;
grant select on public.leave_request_details to authenticated;

-- ───────── RPC ─────────
create function public.my_leave_approvers() returns table (id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name from public.profiles p where p.id in (select app.leave_approvers(app.me())) order by p.full_name
$$;

create function public.request_leave(p_type text, p_start date, p_end date, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.me(); v_name text; v_today date := (clock_timestamp() at time zone app.company_tz())::date;
  v_days int; v_id uuid; a uuid;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if app.my_role() = 'admin' then raise exception 'leave applies to mentors and employees' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = '23514'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'invalid leave dates' using errcode = '22023'; end if;
  if p_end - p_start > 59 then raise exception 'leave cannot exceed 60 days per request' using errcode = '22023'; end if;
  if p_start < v_today - 30 then raise exception 'leave cannot start more than 30 days in the past' using errcode = '22023'; end if;
  if p_end > v_today + 365 then raise exception 'leave cannot end more than a year ahead' using errcode = '22023'; end if;
  v_days := app.leave_working_days(p_start, p_end);
  if v_days = 0 then raise exception 'that range has no working days (weekly offs and holidays are excluded)' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtext('leave:' || v_me::text));            -- serialise this user's requests
  if exists (select 1 from public.leave_requests where user_id = v_me and status in ('pending','approved')
               and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'overlaps an existing pending or approved leave' using errcode = '23505';
  end if;
  insert into public.leave_requests (user_id, leave_type, start_date, end_date, reason)
  values (v_me, p_type, p_start, p_end, btrim(p_reason)) returning id into v_id;     -- bad type => check violation 23514

  select full_name into v_name from public.profiles where id = v_me;
  for a in select app.leave_approvers(v_me) loop
    perform app.notify(a, 'leave_requested', 'Leave request from ' || coalesce(nullif(v_name, ''), 'a team member'),
                       p_type || ' leave, ' || p_start::text || ' to ' || p_end::text || ' (' || v_days || ' working day' ||
                       case when v_days = 1 then '' else 's' end || '): ' || btrim(p_reason), 'leave_requests', v_id::text);
  end loop;
  return v_id;
end $$;

create function public.cancel_leave(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.me(); l public.leave_requests; v_today date := (clock_timestamp() at time zone app.company_tz())::date;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into l from public.leave_requests where id = p_id and user_id = v_me for update;
  if not found then raise exception 'no leave request of yours with that id' using errcode = 'P0002'; end if;
  if not (l.status = 'pending' or (l.status = 'approved' and l.start_date > v_today)) then
    raise exception 'only pending requests, or approved leave that has not started, can be cancelled' using errcode = '23514'; end if;
  update public.leave_requests set status = 'cancelled' where id = p_id;
  if l.decided_by is not null then
    perform app.notify(l.decided_by, 'leave_cancelled', 'Leave cancelled',
                       l.start_date::text || ' to ' || l.end_date::text, 'leave_requests', p_id::text);
  end if;
end $$;

create function public.decide_leave_request(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.me(); l public.leave_requests;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into l from public.leave_requests where id = p_id for update;
  if not found then raise exception 'leave request not found' using errcode = 'P0002'; end if;
  if not app.can_decide_leave(l.user_id) then raise exception 'you are not an approver for this request' using errcode = '42501'; end if;
  if l.status <> 'pending' then raise exception 'request already %', l.status using errcode = '23514'; end if;
  update public.leave_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_me, decided_at = now(), decision_note = nullif(btrim(p_note), '') where id = p_id;
  perform app.notify(l.user_id, 'leave_decided', 'Leave ' || case when p_approve then 'approved' else 'rejected' end,
                     l.start_date::text || ' to ' || l.end_date::text || coalesce(': ' || nullif(btrim(p_note), ''), ''),
                     'leave_requests', p_id::text);
end $$;

-- ───────── attendance report, now leave-aware ─────────
-- Same rules as 0007 plus: a day with NO attendance record that is covered by approved leave is 'on_leave'
-- (a holiday / weekly off still wins; a recorded check-in always wins — they worked). Approved leave on
-- future days is listed too, so calendars show planned leave.
drop function public.attendance_report(date, date, uuid, uuid, text);
create function public.attendance_report(p_from date, p_to date, p_user uuid default null,
                                         p_team uuid default null, p_role text default null)
returns table (user_id uuid, full_name text, role text, teams text, work_date date,
               check_in_at timestamptz, check_out_at timestamptz,
               break_minutes int, net_minutes int, late_minutes int, early_minutes int, overtime_minutes int,
               on_break boolean, is_corrected boolean, status text, leave_type text)
language plpgsql stable set search_path = '' as $$
#variable_conflict use_column
declare
  pol jsonb := app.attendance_policy();
  v_tz text := app.company_tz();
  v_now timestamptz := now();
  v_today date := (now() at time zone app.company_tz())::date;
  v_start time := (pol->>'work_start')::time;      v_end time := (pol->>'work_end')::time;
  v_ls time := (pol->>'lunch_start')::time;        v_le time := (pol->>'lunch_end')::time;
  v_grace int := (pol->>'grace_minutes')::int;
  v_half int := (pol->>'half_day_min_net_minutes')::int; v_full int := (pol->>'full_day_min_net_minutes')::int;
  v_track boolean := (pol->>'track_breaks')::boolean; v_ot boolean := (pol->>'overtime_enabled')::boolean;
  v_offs int[] := array(select e::int from jsonb_array_elements_text(pol->'weekly_offs') e);
  v_hol date[] := array(select e::date from jsonb_array_elements_text(pol->'holidays') e);
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'invalid date range' using errcode = '22023'; end if;
  if p_to - p_from > 92 then raise exception 'date range too large (max 93 days)' using errcode = '22023'; end if;
  return query
  with users as (
    select p.id, p.full_name, p.role,
           (select string_agg(t.name, ', ' order by t.name) from public.team_memberships m
              join public.teams t on t.id = m.team_id where m.user_id = p.id and m.is_active) as teams
    from public.profiles p
    where p.role in ('mentor','bds_employee') and app.can_see_attendance(p.id)
      and (p_user is null or p.id = p_user) and (p_role is null or p.role = p_role)
      and (p_team is null or exists (select 1 from public.team_memberships m
             where m.user_id = p.id and m.team_id = p_team and m.is_active))
      and (p.is_active or exists (select 1 from public.attendance_records r
             where r.user_id = p.id and r.work_date between p_from and p_to))
  ),
  grid as (
    select u.id, u.full_name, u.role, u.teams, d.d::date as d, lv.leave_type,
           (d.d::date + v_start) at time zone v_tz as s_start, (d.d::date + v_end) at time zone v_tz as s_end,
           (d.d::date + v_ls) at time zone v_tz as l_start,    (d.d::date + v_le) at time zone v_tz as l_end,
           (extract(dow from d.d)::int = any (v_offs)) as is_off, (d.d::date = any (v_hol)) as is_hol
    from users u cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
    left join lateral (select lr.leave_type from public.leave_requests lr
                        where lr.user_id = u.id and lr.status = 'approved' and d.d::date between lr.start_date and lr.end_date
                        limit 1) lv on true
    where d.d::date <= v_today or lv.leave_type is not null
       or exists (select 1 from public.attendance_records r where r.user_id = u.id and r.work_date = d.d::date)
  ),
  j as (
    select g.*, r.id as rid, r.check_in_at as cin, r.check_out_at as cout, coalesce(r.is_corrected, false) as corrected,
           (r.id is not null and r.check_out_at is null and g.d = v_today and v_now <= g.s_end) as live
    from grid g left join public.attendance_records r on r.user_id = g.id and r.work_date = g.d
  ),
  m as (
    select j.*,
      case when j.rid is null or (j.cout is null and not j.live) then null
           else extract(epoch from (coalesce(j.cout, v_now) - j.cin)) / 60 end as elapsed,
      case when j.rid is null or (j.cout is null and not j.live) then null
           when v_track then coalesce((select sum(greatest(0, extract(epoch from
                  least(coalesce(b.ended_at, coalesce(j.cout, v_now)), coalesce(j.cout, v_now)) - greatest(b.started_at, j.cin)) / 60))
                  from public.attendance_breaks b where b.record_id = j.rid), 0)
           else greatest(0, extract(epoch from least(j.l_end, coalesce(j.cout, v_now)) - greatest(j.l_start, j.cin)) / 60) end as brk
    from j
  ),
  c as (
    select m.*, case when m.elapsed is null then null else greatest(0, m.elapsed - m.brk) end as net,   -- GREATEST ignores NULLs
           case when m.rid is null then 0 else greatest(0, floor(extract(epoch from (m.cin - m.s_start)) / 60))::int end as late_min,
           case when m.cout is null then 0 else greatest(0, floor(extract(epoch from (m.s_end - m.cout)) / 60))::int end as early_min,
           case when m.cout is null or not v_ot then 0 else greatest(0, floor(extract(epoch from (m.cout - m.s_end)) / 60))::int end as ot_min
    from m
  )
  select c.id, c.full_name, c.role, c.teams, c.d, c.cin, c.cout,
         round(c.brk)::int, round(c.net)::int, c.late_min, c.early_min, c.ot_min,
         exists (select 1 from public.attendance_breaks b where b.record_id = c.rid and b.ended_at is null),
         c.corrected,
         case
           when c.rid is null then case when c.is_hol then 'holiday' when c.is_off then 'weekly_off'
                  when c.leave_type is not null then 'on_leave'
                  when c.d = v_today and v_now <= c.s_end then 'not_checked_in' else 'absent' end
           when c.cout is null and not c.live then 'incomplete'
           when c.cout is not null and c.net < v_half then 'absent'
           when c.cout is not null and c.net < v_full then 'half_day'
           when c.late_min > v_grace then 'late'
           else 'present' end,
         c.leave_type
  from c
  order by c.d, c.full_name;
end $$;

-- ───────── grants ─────────
do $$ declare f text; begin
  foreach f in array array[
    'public.attendance_report(date,date,uuid,uuid,text)', 'public.my_leave_approvers()',
    'public.request_leave(text,date,date,text)', 'public.cancel_leave(uuid)',
    'public.decide_leave_request(uuid,boolean,text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
