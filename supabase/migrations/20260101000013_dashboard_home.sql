-- BlezeX Connect — 0013: one call for everything the dashboard shows above the fold.
-- Additive. dashboard_home() composes existing, already-tested pieces (dashboard_summary, target_attainment,
-- attendance_report, leave_request_details) so no metric is defined twice. SECURITY INVOKER like the rest of the
-- reporting layer: RLS scopes every number to what the caller may see (admin = company, mentor = own team,
-- employee = self). Attendance and decision counts are only computed for the team/company view (p_scope='visible').
--
-- Returns:
--   summary     = dashboard_summary(...) unchanged
--   targets     = {count, avg_pct}   average attainment (each capped at 100) of in-scope targets overlapping the period
--   attendance  = null for p_scope='mine', otherwise today's counts for the people the caller can see (excluding
--                 the caller) plus items waiting for the caller's decision:
--                 {people, present, late, absent, on_leave, checked_in, missing_checkout, pending_leave, pending_corrections}

create function public.dashboard_home(p_from timestamptz default now() - interval '30 days',
                                      p_to timestamptz default now(), p_scope text default 'visible')
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_me uuid := app.me(); v_mine boolean := (p_scope = 'mine'); v_today date;
  v_tgt jsonb; v_att jsonb;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_scope not in ('visible','mine') then raise exception 'invalid scope' using errcode = '22023'; end if;
  v_today := public.attendance_today();

  select jsonb_build_object('count', count(*), 'avg_pct', round(avg(least(coalesce(t.pct, 0), 100)))::int)
    into v_tgt
    from public.target_attainment(p_from::date, p_to::date) t
   where not v_mine or t.user_id = v_me;

  if not v_mine then
    select jsonb_build_object(
             'people',           count(*),
             'present',          count(*) filter (where r.check_in_at is not null),
             'late',             count(*) filter (where r.status = 'late'),
             'absent',           count(*) filter (where r.status = 'absent' and r.check_in_at is null),
             'on_leave',         count(*) filter (where r.status = 'on_leave'),
             'checked_in',       count(*) filter (where r.check_in_at is not null and r.check_out_at is null and r.status <> 'incomplete'),
             'missing_checkout', count(*) filter (where r.status = 'incomplete'),
             'pending_leave',    (select count(*) from public.leave_request_details d where d.can_decide),
             'pending_corrections', case when app.is_admin()
                                      then (select count(*) from public.attendance_corrections c where c.status = 'pending') else 0 end)
      into v_att
      from public.attendance_report(v_today, v_today) r
     where r.user_id <> v_me;
  end if;

  return jsonb_build_object('summary', public.dashboard_summary(p_from, p_to, p_scope),
                            'targets', v_tgt, 'attendance', v_att);
end $$;

revoke all on function public.dashboard_home(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.dashboard_home(timestamptz, timestamptz, text) to authenticated;
