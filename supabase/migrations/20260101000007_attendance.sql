-- BlezeX Connect — 0007: attendance & work hours.
-- Purely additive: new tables/functions plus one new app_settings row. Nothing existing is altered.
-- Design: raw facts (check-in/out, breaks) are stored; every derived value (net hours, late minutes, status)
-- is computed in ONE place, public.attendance_report(), from the configurable 'attendance.policy' setting,
-- so the UI, CSV export and tests can never disagree. Timestamps are written only by trusted functions
-- using the server clock. Attendance is kept out of audit_logs (no triggers) so check-in noise never mixes
-- with security history; corrections have their own append-only ledger (attendance_corrections).

-- ───────── policy (admin-editable through app_settings) ─────────
create function app.attendance_policy_default() returns jsonb language sql immutable set search_path = '' as $$
  select '{"work_start":"10:00","work_end":"18:00","lunch_start":"13:00","lunch_end":"14:00",
           "grace_minutes":10,"early_departure_grace_minutes":0,
           "half_day_min_net_minutes":240,"full_day_min_net_minutes":360,
           "weekly_offs":[0],"holidays":[],"track_breaks":false,"overtime_enabled":false}'::jsonb
$$;
create function app.attendance_policy() returns jsonb language sql stable security definer set search_path = '' as $$
  select app.attendance_policy_default() || coalesce((select value from public.app_settings where key = 'attendance.policy'), '{}'::jsonb)
$$;
create function app.company_tz() returns text language sql stable security definer set search_path = '' as $$
  select coalesce(app.setting('company') ->> 'timezone', 'Asia/Kolkata')
$$;

insert into public.app_settings (key, value, description) values
 ('attendance.policy', app.attendance_policy_default(),
  'Work schedule and attendance rules (times in the company timezone; weekly_offs 0=Sunday..6=Saturday)');

create function app.validate_attendance_policy() returns trigger language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  if new.key <> 'attendance.policy' then return new; end if;
  v := app.attendance_policy_default() || new.value;
  begin
    if (v->>'work_start')::time >= (v->>'work_end')::time then raise exception 'work_start must be before work_end'; end if;
    if (v->>'lunch_start')::time >= (v->>'lunch_end')::time then raise exception 'lunch_start must be before lunch_end'; end if;
    if (v->>'lunch_start')::time < (v->>'work_start')::time or (v->>'lunch_end')::time > (v->>'work_end')::time then
      raise exception 'lunch must fall inside working hours'; end if;
    if (v->>'grace_minutes')::int not between 0 and 240 or (v->>'early_departure_grace_minutes')::int not between 0 and 240 then
      raise exception 'grace periods must be 0-240 minutes'; end if;
    if (v->>'half_day_min_net_minutes')::int < 0 or (v->>'half_day_min_net_minutes')::int > (v->>'full_day_min_net_minutes')::int
       or (v->>'full_day_min_net_minutes')::int > 1440 then
      raise exception 'need 0 <= half_day_min_net_minutes <= full_day_min_net_minutes <= 1440'; end if;
    if jsonb_typeof(v->'weekly_offs') <> 'array' or exists (
         select 1 from jsonb_array_elements_text(v->'weekly_offs') e where e !~ '^[0-6]$') then
      raise exception 'weekly_offs must be an array of 0-6'; end if;
    if jsonb_typeof(v->'holidays') <> 'array' then raise exception 'holidays must be an array of dates'; end if;
    perform e::date from jsonb_array_elements_text(v->'holidays') e;
    if jsonb_typeof(v->'track_breaks') <> 'boolean' or jsonb_typeof(v->'overtime_enabled') <> 'boolean' then
      raise exception 'track_breaks and overtime_enabled must be true/false'; end if;
  exception when others then
    raise exception 'invalid attendance policy: %', sqlerrm using errcode = '23514';
  end;
  return new;
end $$;
create trigger settings_validate_attendance before insert or update on public.app_settings
  for each row execute function app.validate_attendance_policy();

-- ───────── tables ─────────
create table public.attendance_records (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id),
  work_date    date not null,                       -- calendar day in the company timezone
  check_in_at  timestamptz not null,
  check_out_at timestamptz,
  is_corrected boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, work_date),
  check (check_out_at is null or check_out_at > check_in_at)
);
create index attendance_records_date_idx on public.attendance_records (work_date, user_id);
create trigger attendance_records_updated before update on public.attendance_records for each row execute function app.set_updated_at();

create table public.attendance_breaks (
  id         uuid primary key default gen_random_uuid(),
  record_id  uuid not null references public.attendance_records(id) on delete cascade,
  started_at timestamptz not null,
  ended_at   timestamptz,
  check (ended_at is null or ended_at > started_at)
);
create unique index attendance_breaks_open_key on public.attendance_breaks (record_id) where ended_at is null;

create table public.attendance_corrections (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id),
  work_date     date not null,
  source        text not null default 'request' check (source in ('request','admin')),
  old_check_in  timestamptz,
  old_check_out timestamptz,
  new_check_in  timestamptz not null,
  new_check_out timestamptz,
  reason        text not null check (length(btrim(reason)) > 0),
  status        text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_by  uuid not null references public.profiles(id),
  decided_by    uuid references public.profiles(id),
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  check (new_check_out is null or new_check_out > new_check_in)
);
create unique index attendance_corrections_pending_key on public.attendance_corrections (user_id, work_date) where status = 'pending';
create index attendance_corrections_status_idx on public.attendance_corrections (status, created_at desc);

-- ───────── authorisation ─────────
-- A mentor may see attendance of EMPLOYEES they mentor. Unlike mentors_user(), other mentors (even teammates
-- or co-mentors) and admins are excluded: a mentor's own attendance is private to them and admins.
create function app.mentors_member(target uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select app.mentors_user(target) and exists (select 1 from public.profiles p where p.id = target and p.role = 'bds_employee')
$$;
create function app.can_see_attendance(target uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select target is not null and (target = app.me() or app.is_admin() or app.mentors_member(target))
$$;
grant execute on function app.attendance_policy(), app.company_tz(), app.mentors_member(uuid), app.can_see_attendance(uuid) to authenticated;

revoke all on public.attendance_records, public.attendance_breaks, public.attendance_corrections from anon, authenticated;
alter table public.attendance_records enable row level security;
alter table public.attendance_breaks enable row level security;
alter table public.attendance_corrections enable row level security;
grant select on public.attendance_records, public.attendance_breaks, public.attendance_corrections to authenticated;  -- writes: RPC only

create policy attendance_records_select on public.attendance_records for select to authenticated
  using (app.can_see_attendance(user_id));
create policy attendance_breaks_select on public.attendance_breaks for select to authenticated
  using (exists (select 1 from public.attendance_records r where r.id = record_id));      -- inherits records RLS
create policy attendance_corrections_select on public.attendance_corrections for select to authenticated
  using (app.can_see_attendance(user_id));

-- ───────── check-in / check-out / breaks (server clock only) ─────────
create function public.attendance_today() returns date language sql stable set search_path = '' as $$
  select (now() at time zone app.company_tz())::date
$$;

create function public.attendance_check_in() returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.me(); v_id uuid;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if app.my_role() = 'admin' then raise exception 'attendance applies to mentors and employees' using errcode = '42501'; end if;
  begin
    insert into public.attendance_records (user_id, work_date, check_in_at)
    values (v_me, (clock_timestamp() at time zone app.company_tz())::date, clock_timestamp()) returning id into v_id;
  exception when unique_violation then
    raise exception 'already checked in today' using errcode = '23505';
  end;
  return v_id;
end $$;

create function public.attendance_check_out() returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.me(); v_id uuid;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select id into v_id from public.attendance_records
   where user_id = v_me and work_date = (clock_timestamp() at time zone app.company_tz())::date and check_out_at is null for update;
  if v_id is null then raise exception 'no open check-in for today' using errcode = '23514'; end if;
  if exists (select 1 from public.attendance_breaks where record_id = v_id and ended_at is null) then
    raise exception 'end your break before checking out' using errcode = '23514'; end if;
  update public.attendance_records set check_out_at = clock_timestamp() where id = v_id;
  return v_id;
end $$;

create function public.attendance_break_start() returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.me(); v_rec uuid; v_id uuid;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not coalesce((app.attendance_policy() ->> 'track_breaks')::boolean, false) then
    raise exception 'break tracking is disabled' using errcode = '23514'; end if;
  select id into v_rec from public.attendance_records
   where user_id = v_me and work_date = (clock_timestamp() at time zone app.company_tz())::date and check_out_at is null for update;
  if v_rec is null then raise exception 'check in before starting a break' using errcode = '23514'; end if;
  begin
    insert into public.attendance_breaks (record_id, started_at) values (v_rec, clock_timestamp()) returning id into v_id;
  exception when unique_violation then
    raise exception 'a break is already in progress' using errcode = '23505';
  end;
  return v_id;
end $$;

create function public.attendance_break_end() returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.me(); v_id uuid;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  update public.attendance_breaks b set ended_at = clock_timestamp()
    from public.attendance_records r
   where b.record_id = r.id and r.user_id = v_me and r.work_date = (clock_timestamp() at time zone app.company_tz())::date
     and b.ended_at is null
  returning b.id into v_id;
  if v_id is null then raise exception 'no break in progress' using errcode = '23514'; end if;
  return v_id;
end $$;

-- ───────── corrections ─────────
-- Shared writer: local date + local times are interpreted in the company timezone.
create function app.attendance_apply(p_user uuid, p_date date, p_in timestamptz, p_out timestamptz) returns void
language sql security definer set search_path = '' as $$
  insert into public.attendance_records (user_id, work_date, check_in_at, check_out_at, is_corrected)
  values (p_user, p_date, p_in, p_out, true)
  on conflict (user_id, work_date) do update
    set check_in_at = excluded.check_in_at, check_out_at = excluded.check_out_at, is_corrected = true
$$;

create function app.attendance_times(p_date date, p_in time, p_out time, out v_in timestamptz, out v_out timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_tz text := app.company_tz();
begin
  if p_date is null or p_in is null then raise exception 'date and check-in time are required' using errcode = '22023'; end if;
  if p_date > (now() at time zone v_tz)::date then raise exception 'cannot record attendance for a future date' using errcode = '22023'; end if;
  v_in := (p_date + p_in) at time zone v_tz;
  v_out := case when p_out is null then null else (p_date + p_out) at time zone v_tz end;
  if v_in > now() or v_out > now() then raise exception 'times cannot be in the future' using errcode = '22023'; end if;
  if v_out is not null and v_out <= v_in then raise exception 'check-out must be after check-in' using errcode = '22023'; end if;
end $$;

create function public.request_attendance_correction(p_date date, p_check_in time, p_check_out time, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.me(); t record; r public.attendance_records; v_id uuid; a uuid;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if app.my_role() = 'admin' then raise exception 'attendance applies to mentors and employees' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = '23514'; end if;
  select * into t from app.attendance_times(p_date, p_check_in, p_check_out);
  select * into r from public.attendance_records where user_id = v_me and work_date = p_date;
  begin
    insert into public.attendance_corrections (user_id, work_date, old_check_in, old_check_out, new_check_in, new_check_out, reason, requested_by)
    values (v_me, p_date, r.check_in_at, r.check_out_at, t.v_in, t.v_out, btrim(p_reason), v_me) returning id into v_id;
  exception when unique_violation then
    raise exception 'a correction for this date is already pending' using errcode = '23505';
  end;
  for a in select id from public.profiles where role = 'admin' and is_active loop
    perform app.notify(a, 'attendance_correction', 'Attendance correction requested', p_date::text || ': ' || btrim(p_reason),
                       'attendance_corrections', v_id::text);
  end loop;
  return v_id;
end $$;

create function public.cancel_attendance_correction(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.attendance_corrections set status = 'cancelled'
   where id = p_id and requested_by = app.me() and status = 'pending';
  if not found then raise exception 'no pending request of yours with that id' using errcode = 'P0002'; end if;
end $$;

create function public.decide_attendance_correction(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.me(); c public.attendance_corrections;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not app.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.attendance_corrections where id = p_id for update;
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
  if c.status <> 'pending' then raise exception 'request already %', c.status using errcode = '23514'; end if;
  update public.attendance_corrections set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_me, decided_at = now(), decision_note = nullif(btrim(p_note), '') where id = p_id;
  if p_approve then perform app.attendance_apply(c.user_id, c.work_date, c.new_check_in, c.new_check_out); end if;
  perform app.notify(c.user_id, 'attendance_correction', 'Attendance correction ' || case when p_approve then 'approved' else 'rejected' end,
                     c.work_date::text, 'attendance_corrections', c.id::text);
end $$;

-- Admin edits any mentor/employee day directly. The reason is mandatory and the change is kept in the ledger.
create function public.attendance_admin_correct(p_user uuid, p_date date, p_check_in time, p_check_out time, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.me(); t record; r public.attendance_records; v_id uuid;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not app.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = '23514'; end if;
  if not exists (select 1 from public.profiles where id = p_user and is_active and role in ('mentor','bds_employee')) then
    raise exception 'user not found or has no attendance' using errcode = 'P0002'; end if;
  select * into t from app.attendance_times(p_date, p_check_in, p_check_out);
  select * into r from public.attendance_records where user_id = p_user and work_date = p_date for update;
  update public.attendance_corrections set status = 'cancelled' where user_id = p_user and work_date = p_date and status = 'pending';
  insert into public.attendance_corrections (user_id, work_date, source, old_check_in, old_check_out, new_check_in, new_check_out,
                                             reason, status, requested_by, decided_by, decided_at)
  values (p_user, p_date, 'admin', r.check_in_at, r.check_out_at, t.v_in, t.v_out, btrim(p_reason), 'approved', v_me, v_me, now())
  returning id into v_id;
  perform app.attendance_apply(p_user, p_date, t.v_in, t.v_out);
  perform app.notify(p_user, 'attendance_correction', 'Your attendance was corrected', p_date::text || ': ' || btrim(p_reason),
                     'attendance_corrections', v_id::text);
  return v_id;
end $$;

-- ───────── the single source of derived attendance values ─────────
-- SECURITY INVOKER: table reads go through RLS, and rows are additionally gated by app.can_see_attendance().
-- One row per (visible mentor/employee, day). Future days are omitted. Statuses:
--   present | late | half_day | absent | incomplete (no check-out) | not_checked_in (today, day not over)
--   weekly_off | holiday (no record on a non-working day)
-- Lunch rule: with break tracking OFF the scheduled lunch window is deducted only where it overlaps the worked
-- span; with tracking ON only the actual recorded breaks are deducted — never both.
create function public.attendance_report(p_from date, p_to date, p_user uuid default null,
                                         p_team uuid default null, p_role text default null)
returns table (user_id uuid, full_name text, role text, teams text, work_date date,
               check_in_at timestamptz, check_out_at timestamptz,
               break_minutes int, net_minutes int, late_minutes int, early_minutes int, overtime_minutes int,
               on_break boolean, is_corrected boolean, status text)
language plpgsql stable set search_path = '' as $$
#variable_conflict use_column
declare
  pol jsonb := app.attendance_policy();
  v_tz text := app.company_tz();
  v_now timestamptz := now();
  v_today date := (now() at time zone app.company_tz())::date;
  v_start time := (pol->>'work_start')::time;      v_end time := (pol->>'work_end')::time;
  v_ls time := (pol->>'lunch_start')::time;        v_le time := (pol->>'lunch_end')::time;
  v_grace int := (pol->>'grace_minutes')::int;     v_egrace int := (pol->>'early_departure_grace_minutes')::int;
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
    select u.id, u.full_name, u.role, u.teams, d.d::date as d,
           (d.d::date + v_start) at time zone v_tz as s_start, (d.d::date + v_end) at time zone v_tz as s_end,
           (d.d::date + v_ls) at time zone v_tz as l_start,    (d.d::date + v_le) at time zone v_tz as l_end,
           (extract(dow from d.d)::int = any (v_offs)) as is_off, (d.d::date = any (v_hol)) as is_hol
    from users u cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
    where d.d::date <= v_today or exists (select 1 from public.attendance_records r where r.user_id = u.id and r.work_date = d.d::date)
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
                  when c.d = v_today and v_now <= c.s_end then 'not_checked_in' else 'absent' end
           when c.cout is null and not c.live then 'incomplete'
           when c.cout is not null and c.net < v_half then 'absent'
           when c.cout is not null and c.net < v_full then 'half_day'
           when c.late_min > v_grace then 'late'
           else 'present' end
  from c
  order by c.d, c.full_name;
end $$;

-- ───────── grants ─────────
do $$ declare f text; begin
  foreach f in array array[
    'public.attendance_today()', 'public.attendance_check_in()', 'public.attendance_check_out()',
    'public.attendance_break_start()', 'public.attendance_break_end()',
    'public.request_attendance_correction(date,time,time,text)', 'public.cancel_attendance_correction(uuid)',
    'public.decide_attendance_correction(uuid,boolean,text)', 'public.attendance_admin_correct(uuid,date,time,time,text)',
    'public.attendance_report(date,date,uuid,uuid,text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
-- app.attendance_apply / app.attendance_times are internal helpers: no grant (callable only from the definer RPCs above).
