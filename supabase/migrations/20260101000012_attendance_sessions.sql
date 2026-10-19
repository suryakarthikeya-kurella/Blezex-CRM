-- BlezeX Connect — 0012: keep every check-in / check-out of the day visible.
-- 0011 already STORES each session (first check-in, each gap, latest check-out). This exposes them: the report
-- gains a `sessions` column (JSON array of {in, out}; the open session has out = null) so the UI and CSV can list
-- them. A correction defines the day as one session, so it now clears that day's gap rows (otherwise stale gaps
-- could contradict the corrected times). attendance_report() is dropped and recreated (new column) and re-granted.

create or replace function app.attendance_apply(p_user uuid, p_date date, p_in timestamptz, p_out timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.attendance_records (user_id, work_date, check_in_at, check_out_at, is_corrected)
  values (p_user, p_date, p_in, p_out, true)
  on conflict (user_id, work_date) do update
    set check_in_at = excluded.check_in_at, check_out_at = excluded.check_out_at, is_corrected = true
  returning id into v_id;
  delete from public.attendance_breaks where record_id = v_id and is_gap;
end $$;

drop function public.attendance_report(date, date, uuid, uuid, text);
create function public.attendance_report(p_from date, p_to date, p_user uuid default null,
                                         p_team uuid default null, p_role text default null)
returns table (user_id uuid, full_name text, role text, teams text, work_date date,
               check_in_at timestamptz, check_out_at timestamptz,
               break_minutes int, net_minutes int, late_minutes int, early_minutes int, overtime_minutes int,
               on_break boolean, is_corrected boolean, status text, leave_type text, sessions jsonb)
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
           else greatest(0, extract(epoch from least(j.l_end, coalesce(j.cout, v_now)) - greatest(j.l_start, j.cin)) / 60)
                -- time between a check-out and the next check-in ("gap" rows), minus the part already deducted as lunch
                + coalesce((select sum(
                    greatest(0, extract(epoch from least(b.ended_at, coalesce(j.cout, v_now)) - greatest(b.started_at, j.cin)) / 60)
                  - greatest(0, extract(epoch from least(b.ended_at, j.l_end, coalesce(j.cout, v_now)) - greatest(b.started_at, j.l_start, j.cin)) / 60))
                  from public.attendance_breaks b where b.record_id = j.rid and b.is_gap), 0) end as brk
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
         c.leave_type,
         -- every check-in/check-out of the day, in order: the first in … gap start, gap end … latest out
         (select jsonb_agg(jsonb_build_object('in', z.t_in, 'out', z.t_out) order by z.t_in)
            from (select q.k, min(q.t) filter (where q.kind = 'in') as t_in, min(q.t) filter (where q.kind = 'out') as t_out
                    from (select ev.t, ev.kind, (row_number() over (order by ev.t, ev.kind desc) + 1) / 2 as k
                            from (select c.cin as t, 'in' as kind where c.rid is not null
                                  union all select b.started_at, 'out' from public.attendance_breaks b where b.record_id = c.rid and b.is_gap
                                  union all select b.ended_at, 'in' from public.attendance_breaks b where b.record_id = c.rid and b.is_gap
                                  union all select c.cout, 'out' where c.cout is not null) ev) q
                   group by q.k) z)
  from c
  order by c.d, c.full_name;
end $$;

revoke all on function public.attendance_report(date,date,uuid,uuid,text) from public, anon;
grant execute on function public.attendance_report(date,date,uuid,uuid,text) to authenticated;
