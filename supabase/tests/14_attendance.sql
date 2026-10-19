-- Attendance: authorisation (RLS + RPC), server-side transitions, and the work-hour/status calculations.
-- Fixture days are in the past (2025-03; Mon 03-03 … Sun 03-09 … Mon 03-10) in Asia/Kolkata, policy defaults:
-- 10:00–18:00, lunch 13:00–14:00, grace 10 min, half-day <360 net, absent <240 net, Sunday off.
\set a  '''00000000-0000-0000-0000-0000000000a1'''
\set b1 '''00000000-0000-0000-0000-0000000000b1'''
\set b2 '''00000000-0000-0000-0000-0000000000b2'''
\set e1 '''00000000-0000-0000-0000-0000000000e1'''
\set e2 '''00000000-0000-0000-0000-0000000000e2'''
\set e3 '''00000000-0000-0000-0000-0000000000e3'''

\echo === 14.0 fixtures (superuser)
insert into public.attendance_records (user_id, work_date, check_in_at, check_out_at) values
 (:e1, '2025-03-03', '2025-03-03 10:00+05:30', '2025-03-03 18:00+05:30'),   -- full day
 (:e1, '2025-03-04', '2025-03-04 10:30+05:30', '2025-03-04 18:00+05:30'),   -- 30 min late
 (:e1, '2025-03-05', '2025-03-05 10:05+05:30', '2025-03-05 18:00+05:30'),   -- inside grace
 (:e1, '2025-03-06', '2025-03-06 10:00+05:30', '2025-03-06 15:00+05:30'),   -- left early, net 240 => half day
 (:e1, '2025-03-10', '2025-03-10 10:00+05:30', null),                       -- never checked out
 (:e2, '2025-03-03', '2025-03-03 10:00+05:30', '2025-03-03 18:00+05:30'),
 (:e3, '2025-03-03', '2025-03-03 11:00+05:30', '2025-03-03 18:00+05:30'),
 (:b1, '2025-03-03', '2025-03-03 10:00+05:30', '2025-03-03 18:00+05:30'),
 (:b2, '2025-03-03', '2025-03-03 10:00+05:30', '2025-03-03 18:00+05:30');

\echo === 14.1 calculations (employee views own rows)
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.eq(t.val($q$select net_minutes||'/'||break_minutes||'/'||late_minutes||'/'||status from public.attendance_report('2025-03-03','2025-03-03')$q$), '420/60/0/present', 'full day: 8h elapsed - 1h lunch = 7h net');
  perform t.eq(t.val($q$select net_minutes||'/'||late_minutes||'/'||status from public.attendance_report('2025-03-04','2025-03-04')$q$), '390/30/late', 'late arrival: 30 late minutes, 6.5h net');
  perform t.eq(t.val($q$select late_minutes||'/'||status from public.attendance_report('2025-03-05','2025-03-05')$q$), '5/present', 'late within grace stays present');
  perform t.eq(t.val($q$select net_minutes||'/'||early_minutes||'/'||status from public.attendance_report('2025-03-06','2025-03-06')$q$), '240/180/half_day', 'early departure: 3h early, 4h net => half day');
  perform t.eq(t.val($q$select status from public.attendance_report('2025-03-07','2025-03-07')$q$), 'absent', 'working day without record is absent');
  perform t.eq(t.val($q$select status from public.attendance_report('2025-03-09','2025-03-09')$q$), 'weekly_off', 'Sunday is a weekly off');
  perform t.eq(t.val($q$select status||'/'||coalesce(net_minutes::text,'null') from public.attendance_report('2025-03-10','2025-03-10')$q$), 'incomplete/null', 'missing check-out is incomplete with no net hours');
  perform t.eq(t.val($q$select count(*) from public.attendance_report('2025-03-03','2025-03-10')$q$), '8', 'range returns one row per day');
  perform t.denied($q$select * from public.attendance_report('2025-03-10','2025-03-03')$q$, 'inverted range rejected');
  perform t.denied($q$select * from public.attendance_report('2025-01-01','2025-12-31')$q$, 'range over 93 days rejected');
end $$;

\echo === 14.2 visibility: employee / mentor / admin
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.eq(t.val($q$select count(distinct user_id) from public.attendance_report('2025-03-03','2025-03-03')$q$), '1', 'E1 report contains only E1');
  perform t.eq(t.val($q$select count(*) from public.attendance_report('2025-03-03','2025-03-03','00000000-0000-0000-0000-0000000000e2')$q$), '0', 'E1 cannot request E2 via p_user');
  perform t.eq(t.val('select count(*) from public.attendance_records'), '5', 'E1 reads only own raw records');
  perform t.eq(t.val($q$select count(*) from public.attendance_records where user_id <> '00000000-0000-0000-0000-0000000000e1'$q$), '0', 'E1 raw records: nobody else');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform t.eq(t.val($q$select string_agg(distinct user_id::text, ',' order by user_id::text) from public.attendance_report('2025-03-03','2025-03-03')$q$),
               '00000000-0000-0000-0000-0000000000b1,00000000-0000-0000-0000-0000000000e1,00000000-0000-0000-0000-0000000000e2', 'mentor sees self + assigned employees only');
  perform t.eq(t.val($q$select count(*) from public.attendance_report('2025-03-03','2025-03-03','00000000-0000-0000-0000-0000000000e3')$q$), '0', 'mentor cannot see another team''s employee');
  perform t.eq(t.val($q$select count(*) from public.attendance_report('2025-03-03','2025-03-03','00000000-0000-0000-0000-0000000000b2')$q$), '0', 'mentor cannot see another mentor');
  perform t.eq(t.val($q$select count(*) from public.attendance_records where user_id in ('00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-0000000000b2')$q$), '0', 'mentor raw records exclude other team/mentor');
  perform t.eq(t.val($q$select count(*) from public.attendance_report('2025-03-03','2025-03-03', null, '70000000-0000-0000-0000-000000000002')$q$), '0', 'mentor team filter cannot widen scope');
end $$;
-- two mentors sharing a team still cannot see each other
reset role;
insert into public.team_memberships (team_id, user_id, membership_role) values ('70000000-0000-0000-0000-000000000001', :b2, 'mentor');
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform t.eq(t.val($q$select count(*) from public.attendance_report('2025-03-03','2025-03-03','00000000-0000-0000-0000-0000000000b2')$q$), '0', 'co-mentor in same team stays private');
  perform t.eq(t.val($q$select count(*) from public.attendance_records where user_id = '00000000-0000-0000-0000-0000000000b2'$q$), '0', 'co-mentor raw records stay private');
end $$;
reset role;
delete from public.team_memberships where team_id = '70000000-0000-0000-0000-000000000001' and user_id = :b2;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select count(distinct user_id) from public.attendance_report('2025-03-03','2025-03-03')$q$), '5', 'admin sees every active mentor and employee');
  perform t.eq(t.val($q$select count(*) from public.attendance_report('2025-03-03','2025-03-03', null, '70000000-0000-0000-0000-000000000002')$q$), '2', 'admin team filter (mentor + employee; inactive member excluded)');
  perform t.eq(t.val($q$select count(*) from public.attendance_report('2025-03-03','2025-03-03', null, null, 'mentor')$q$), '2', 'admin role filter');
end $$;
do $$ begin perform t.act_anon();
  perform t.denied('select count(*) from public.attendance_records', 'anon cannot read records');
  perform t.denied('select * from public.attendance_report(current_date, current_date)', 'anon cannot call report');
  perform t.denied('select public.attendance_check_in()', 'anon cannot check in');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000d1');   -- deactivated
  perform t.denied('select public.attendance_check_in()', 'inactive user cannot check in', array['28000']);
end $$;

\echo === 14.3 no direct writes
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.denied($q$insert into public.attendance_records (user_id, work_date, check_in_at) values ('00000000-0000-0000-0000-0000000000e1','2025-03-20', now())$q$, 'no direct insert');
  perform t.denied($q$update public.attendance_records set check_in_at = now() where user_id = '00000000-0000-0000-0000-0000000000e1'$q$, 'no direct update');
  perform t.denied($q$delete from public.attendance_records$q$, 'no direct delete');
  perform t.denied($q$insert into public.attendance_corrections (user_id, work_date, new_check_in, reason, requested_by) values ('00000000-0000-0000-0000-0000000000e1','2025-03-20', now(), 'x', '00000000-0000-0000-0000-0000000000e1')$q$, 'no direct correction insert');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.denied($q$update public.attendance_records set check_in_at = now()$q$, 'admin cannot bypass RPC either');
  perform t.denied('select public.attendance_check_in()', 'admin has no attendance of their own', array['42501']);
end $$;

\echo === 14.4 check-in / check-out transitions (server clock)
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e2');
  perform t.denied('select public.attendance_check_out()', 'cannot check out before checking in');
  perform t.denied('select public.attendance_break_start()', 'break tracking is off by default');
  perform public.attendance_check_in();
  perform t.denied('select public.attendance_check_in()', 'duplicate check-in rejected');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e2');
  perform t.eq(t.val($q$select (check_in_at <= clock_timestamp() and check_in_at > clock_timestamp() - interval '1 minute')::text from public.attendance_records where work_date = public.attendance_today() and user_id = '00000000-0000-0000-0000-0000000000e2'$q$), 'true', 'check-in time comes from the server clock');
  perform public.attendance_check_out();
  perform t.denied('select public.attendance_check_out()', 'duplicate check-out rejected');
end $$;
-- checking in again after a check-out resumes the same day (several in/out sessions per day)
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e2');
  perform public.attendance_check_in();
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e2');
  perform t.denied('select public.attendance_check_in()', 'cannot check in twice while already in');
  perform t.eq(t.val($q$select (check_out_at is null)::text from public.attendance_records where work_date = public.attendance_today() and user_id = '00000000-0000-0000-0000-0000000000e2'$q$), 'true', 'resuming re-opens the same day record');
  perform t.eq(t.val($q$select count(*) from public.attendance_records where user_id = '00000000-0000-0000-0000-0000000000e2' and work_date = public.attendance_today()$q$), '1', 'still exactly one record for the day');
  perform t.eq(t.val($q$select count(*) from public.attendance_breaks b join public.attendance_records r on r.id = b.record_id where r.user_id = '00000000-0000-0000-0000-0000000000e2' and r.work_date = public.attendance_today() and b.is_gap$q$), '1', 'the time away is stored as one gap');
  perform public.attendance_check_out();
  perform t.denied('select public.attendance_check_out()', 'duplicate check-out still rejected');
end $$;

\echo === 14.5 break tracking: lunch never deducted twice
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.affects($q$update public.app_settings set value = value || '{"track_breaks": true}' where key = 'attendance.policy'$q$, 1, 'admin enables break tracking');
  perform t.eq(t.val($q$select net_minutes||'/'||break_minutes from public.attendance_report('2025-03-03','2025-03-03', '00000000-0000-0000-0000-0000000000e1')$q$), '480/0', 'tracking on, no break recorded => no lunch deduction');
end $$;
reset role;
insert into public.attendance_breaks (record_id, started_at, ended_at)
  select id, '2025-03-03 13:00+05:30', '2025-03-03 13:30+05:30' from public.attendance_records where user_id = :e1 and work_date = '2025-03-03';
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.eq(t.val($q$select net_minutes||'/'||break_minutes from public.attendance_report('2025-03-03','2025-03-03')$q$), '450/30', 'tracking on: only the actual 30 min break is deducted');
  perform t.denied('select public.attendance_break_end()', 'cannot end a break that is not running');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e3');
  perform public.attendance_check_in();
  perform public.attendance_break_start();
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e3');
  perform t.denied('select public.attendance_break_start()', 'second break while one is running rejected');
  perform t.denied('select public.attendance_check_out()', 'cannot check out during a break');
  perform t.eq(t.val($q$select on_break::text from public.attendance_report(public.attendance_today(), public.attendance_today(), '00000000-0000-0000-0000-0000000000e3')$q$), 'true', 'report flags a break in progress');
  perform public.attendance_break_end();
  perform public.attendance_check_out();
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.affects($q$update public.app_settings set value = value || '{"track_breaks": false}' where key = 'attendance.policy'$q$, 1, 'admin disables break tracking again');
end $$;

\echo === 14.6 policy: validation, holidays, admin-only
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.denied($q$update public.app_settings set value = value || '{"work_start":"19:00"}' where key = 'attendance.policy'$q$, 'work start after end rejected');
  perform t.denied($q$update public.app_settings set value = value || '{"weekly_offs":[9]}' where key = 'attendance.policy'$q$, 'invalid weekday rejected');
  perform t.denied($q$update public.app_settings set value = value || '{"holidays":["not-a-date"]}' where key = 'attendance.policy'$q$, 'invalid holiday rejected');
  perform t.denied($q$update public.app_settings set value = value || '{"half_day_min_net_minutes":500}' where key = 'attendance.policy'$q$, 'half-day threshold above full-day rejected');
  perform t.affects($q$update public.app_settings set value = value || '{"holidays":["2025-03-11"],"grace_minutes":3}' where key = 'attendance.policy'$q$, 1, 'valid policy accepted');
  perform t.eq(t.val($q$select status from public.attendance_report('2025-03-11','2025-03-11','00000000-0000-0000-0000-0000000000e3')$q$), 'holiday', 'holiday without record');
  perform t.eq(t.val($q$select status from public.attendance_report('2025-03-05','2025-03-05','00000000-0000-0000-0000-0000000000e1')$q$), 'late', 'grace of 3 min makes 5 min late');
  perform t.affects($q$update public.app_settings set value = value || '{"holidays":[],"grace_minutes":10}' where key = 'attendance.policy'$q$, 1, 'policy restored');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.affects($q$update public.app_settings set value = '{"work_start":"00:00"}' where key = 'attendance.policy'$q$, 0, 'employee cannot change policy');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform t.affects($q$update public.app_settings set value = '{"work_start":"00:00"}' where key = 'attendance.policy'$q$, 0, 'mentor cannot change policy');
end $$;

\echo === 14.7 corrections
do $$ declare v uuid; begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.denied($q$select public.request_attendance_correction('2025-03-07','10:00','18:00','  ')$q$, 'reason required');
  perform t.denied($q$select public.request_attendance_correction('2099-01-01','10:00','18:00','future')$q$, 'future date rejected');
  perform t.denied($q$select public.request_attendance_correction('2025-03-07','18:00','10:00','swapped')$q$, 'check-out before check-in rejected');
  perform public.request_attendance_correction('2025-03-07','10:00','18:00','forgot to check in');
  perform t.denied($q$select public.request_attendance_correction('2025-03-07','10:00','17:00','again')$q$, 'one pending request per day');
  perform t.denied($q$select public.decide_attendance_correction(id, true) from public.attendance_corrections limit 1$q$, 'employee cannot approve own request');
  perform t.eq(t.val($q$select status from public.attendance_report('2025-03-07','2025-03-07')$q$), 'absent', 'pending request does not change attendance');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e3');
  perform public.request_attendance_correction('2025-03-04','10:00','18:00','system outage');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform t.eq(t.val('select count(*) from public.attendance_corrections'), '1', 'mentor sees own team requests only');
  perform t.denied($q$select public.decide_attendance_correction(id, true) from public.attendance_corrections limit 1$q$, 'mentor cannot decide corrections');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select count(*) from public.attendance_corrections where status = 'pending'$q$), '2', 'admin sees all pending requests');
  perform public.decide_attendance_correction((select id from public.attendance_corrections where user_id = '00000000-0000-0000-0000-0000000000e1' and status = 'pending'), true, 'ok');
  perform t.denied($q$select public.decide_attendance_correction(id, true) from public.attendance_corrections where user_id = '00000000-0000-0000-0000-0000000000e1' and status = 'approved'$q$, 'cannot decide twice');
  perform public.decide_attendance_correction((select id from public.attendance_corrections where user_id = '00000000-0000-0000-0000-0000000000e3' and status = 'pending'), false, 'no evidence');
  perform t.eq(t.val($q$select net_minutes||'/'||status||'/'||is_corrected from public.attendance_report('2025-03-07','2025-03-07','00000000-0000-0000-0000-0000000000e1')$q$), '420/present/true', 'approved correction applied');
  perform t.eq(t.val($q$select status from public.attendance_report('2025-03-04','2025-03-04','00000000-0000-0000-0000-0000000000e3')$q$), 'absent', 'rejected correction changes nothing');
  -- direct admin correction
  perform t.denied($q$select public.attendance_admin_correct('00000000-0000-0000-0000-0000000000e1','2025-03-10','10:00','18:00','')$q$, 'admin correction needs a reason');
  perform t.denied($q$select public.attendance_admin_correct('00000000-0000-0000-0000-0000000000a1','2025-03-10','10:00','18:00','x')$q$, 'admin has no attendance to correct');
  perform public.attendance_admin_correct('00000000-0000-0000-0000-0000000000e1','2025-03-10','10:00','18:00','closed missing check-out');
  perform t.eq(t.val($q$select status||'/'||is_corrected from public.attendance_report('2025-03-10','2025-03-10','00000000-0000-0000-0000-0000000000e1')$q$), 'present/true', 'admin correction closes the open day');
  perform t.eq(t.val($q$select old_check_out is null and source = 'admin' and status = 'approved' from public.attendance_corrections where work_date = '2025-03-10'$q$)::text, 'true', 'ledger keeps the original values');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.eq(t.val($q$select count(*) from public.notifications where type = 'attendance_correction'$q$), '2', 'requester notified of the decision and of the admin correction');
  perform t.denied($q$select public.attendance_admin_correct('00000000-0000-0000-0000-0000000000e1','2025-03-10','09:00','18:00','self')$q$, 'employee cannot use admin correction');
  perform t.denied($q$update public.attendance_corrections set status = 'approved'$q$, 'ledger not directly writable');
end $$;

\echo === 14.8 attendance stays out of the security audit log
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select count(*) from public.audit_logs where entity_type like 'attendance%'$q$), '0', 'no attendance rows in audit_logs');
end $$;

\echo === 14.9 time away between sessions is not worked time (tracking off)
reset role;
insert into public.attendance_records (user_id, work_date, check_in_at, check_out_at) values
 ('00000000-0000-0000-0000-0000000000e2', '2025-03-12', '2025-03-12 10:00+05:30', '2025-03-12 18:00+05:30'),
 ('00000000-0000-0000-0000-0000000000e2', '2025-03-13', '2025-03-13 10:00+05:30', '2025-03-13 18:00+05:30');
insert into public.attendance_breaks (record_id, started_at, ended_at, is_gap)
  select id, '2025-03-12 11:00+05:30', '2025-03-12 12:00+05:30', true from public.attendance_records where user_id = '00000000-0000-0000-0000-0000000000e2' and work_date = '2025-03-12';
insert into public.attendance_breaks (record_id, started_at, ended_at, is_gap)           -- overlaps lunch 13:00-14:00 by 30 min
  select id, '2025-03-13 12:30+05:30', '2025-03-13 13:30+05:30', true from public.attendance_records where user_id = '00000000-0000-0000-0000-0000000000e2' and work_date = '2025-03-13';
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select net_minutes||'/'||break_minutes||'/'||status from public.attendance_report('2025-03-12','2025-03-12','00000000-0000-0000-0000-0000000000e2')$q$), '360/120/present', '1h away + 1h lunch = 2h deducted (8h - 2h = 6h)');
  perform t.eq(t.val($q$select net_minutes||'/'||break_minutes from public.attendance_report('2025-03-13','2025-03-13','00000000-0000-0000-0000-0000000000e2')$q$), '390/90', 'gap overlapping lunch: union 12:30-14:00 = 90 min, lunch not deducted twice');
  perform t.eq(t.val($q$select late_minutes||'/'||early_minutes from public.attendance_report('2025-03-13','2025-03-13','00000000-0000-0000-0000-0000000000e2')$q$), '0/0', 'late/early still judged on first check-in / last check-out');
end $$;

\echo === 14.10 every session is listed; corrections reset them
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select jsonb_array_length(sessions)::text from public.attendance_report('2025-03-12','2025-03-12','00000000-0000-0000-0000-0000000000e2')$q$), '2', 'one gap = two sessions');
  perform t.eq(t.val($q$select (sessions -> 0 ->> 'out') is not null and (sessions -> 1 ->> 'in') is not null from public.attendance_report('2025-03-12','2025-03-12','00000000-0000-0000-0000-0000000000e2')$q$)::text, 'true', 'sessions carry both ends');
  perform t.eq(t.val($q$select jsonb_array_length(sessions)::text from public.attendance_report('2025-03-03','2025-03-03','00000000-0000-0000-0000-0000000000e1')$q$), '1', 'plain day = one session');
  perform t.eq((t.val($q$select coalesce(sessions::text, 'null') from public.attendance_report('2025-03-07','2025-03-07','00000000-0000-0000-0000-0000000000e1')$q$) <> 'null')::text, 'true', 'corrected day still has its session');
  perform t.eq(t.val($q$select jsonb_array_length(sessions)::text from public.attendance_report(public.attendance_today(), public.attendance_today(), '00000000-0000-0000-0000-0000000000e2')$q$), '2', 'today: the resumed day shows both sessions');
  perform public.attendance_admin_correct('00000000-0000-0000-0000-0000000000e2', '2025-03-12', '10:00', '18:00', 'single session');
  perform t.eq(t.val($q$select jsonb_array_length(sessions)||'/'||net_minutes from public.attendance_report('2025-03-12','2025-03-12','00000000-0000-0000-0000-0000000000e2')$q$), '1/420', 'a correction collapses the day to one session (stale gap removed)');
end $$;
