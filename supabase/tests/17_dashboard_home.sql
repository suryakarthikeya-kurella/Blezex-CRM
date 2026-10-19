-- dashboard_home(): one call, scoped by RLS, composed from the existing reporting pieces.
\set e1 '''00000000-0000-0000-0000-0000000000e1'''

\echo === 17.0 fixtures: E1 checked in today (late irrelevant), one target for E1 covering today
delete from public.attendance_records where work_date = public.attendance_today();
insert into public.attendance_records (user_id, work_date, check_in_at) values (:e1, public.attendance_today(), now() - interval '1 minute');
insert into public.user_targets (user_id, period_start, period_end, target_type, target_value)
values (:e1, current_date - 5, current_date + 5, 'new_leads', 1000);

\echo === 17.1 access and shape
do $$ begin perform t.act_anon();
  perform t.denied('select public.dashboard_home()', 'anon cannot call dashboard_home');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.denied($q$select public.dashboard_home(now() - interval '30 days', now(), 'bogus')$q$, 'invalid scope rejected');
  perform t.eq(t.val($q$select (public.dashboard_home(now() - interval '30 days', now(), 'mine') -> 'attendance')::text$q$), 'null', 'own view carries no team attendance');
  perform t.eq(t.val($q$select ((public.dashboard_home(now() - interval '30 days', now(), 'mine') -> 'targets' ->> 'count')::int >= 1)::text$q$), 'true', 'own targets counted');
  perform t.eq(t.val($q$select ((public.dashboard_home(now() - interval '30 days', now(), 'mine') -> 'targets' ->> 'avg_pct')::int between 0 and 100)::text$q$), 'true', 'target progress is a 0-100 percentage');
  perform t.eq(t.val($q$select (public.dashboard_home(now() - interval '30 days', now(), 'mine') -> 'summary' ->> 'active_leads')$q$),
               t.val($q$select (public.dashboard_summary(now() - interval '30 days', now(), 'mine') ->> 'active_leads')$q$), 'summary is exactly dashboard_summary');
end $$;

\echo === 17.2 team and company attendance counts respect scope
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform t.eq(t.val($q$select (public.dashboard_home() -> 'attendance' ->> 'people')$q$), '2', 'mentor: only assigned employees (not self, not other teams)');
  perform t.eq(t.val($q$select (public.dashboard_home() -> 'attendance' ->> 'present')$q$), '1', 'mentor: E1 is present');
  perform t.eq(t.val($q$select (public.dashboard_home() -> 'attendance' ->> 'checked_in')$q$), '1', 'mentor: E1 is checked in right now');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select (public.dashboard_home() -> 'attendance' ->> 'people')$q$),
               t.val($q$select count(*) from public.profiles where is_active and role in ('mentor','bds_employee')$q$), 'admin: every active mentor/employee');
  perform t.eq(t.val($q$select (public.dashboard_home() -> 'attendance' ->> 'pending_corrections')$q$),
               t.val($q$select count(*) from public.attendance_corrections where status = 'pending'$q$), 'admin: pending corrections');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e2');
  perform t.eq(t.val($q$select (public.dashboard_home(now() - interval '30 days', now(), 'visible') -> 'attendance' ->> 'people')$q$), '0', 'employee asking for the team view still sees nobody else');
end $$;
