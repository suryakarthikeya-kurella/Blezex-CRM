-- Leave: routing (employee→mentor, mentor→admin), RLS scope, decisions, notifications, validation,
-- and integration with attendance_report(). Request-flow tests use "next week" dates (relative to today);
-- report-integration fixtures use fixed 2025-03 days. Default policy: Sunday is the weekly off.
\set a  '''00000000-0000-0000-0000-0000000000a1'''
\set b1 '''00000000-0000-0000-0000-0000000000b1'''
\set e1 '''00000000-0000-0000-0000-0000000000e1'''
\set e3 '''00000000-0000-0000-0000-0000000000e3'''
\set e9 '''00000000-0000-0000-0000-0000000000e9'''

create function t.mon() returns date language sql stable as $$ select (date_trunc('week', current_date)::date + 7) $$;

\echo === 15.0 fixtures
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e9', 'orphan@blezex.test');   -- active employee with NO mentor
update public.profiles set is_active = true, full_name = 'Olly Orphan' where id = :e9;

\echo === 15.1 validation and access basics
do $$ begin perform t.act_anon();
  perform t.denied('select count(*) from public.leave_requests', 'anon cannot read leave');
  perform t.denied($q$select public.request_leave('casual', current_date + 1, current_date + 1, 'x')$q$, 'anon cannot request leave');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.denied($q$select public.request_leave('casual', public.attendance_today() + 7, public.attendance_today() + 8, 'x')$q$, 'admin has no leave', array['42501']);
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000d1');
  perform t.denied($q$select public.request_leave('casual', t.mon(), t.mon(), 'x')$q$, 'inactive user cannot request leave', array['28000']);
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.denied($q$select public.request_leave('casual', t.mon(), t.mon(), '  ')$q$, 'reason required');
  perform t.denied($q$select public.request_leave('casual', t.mon() + 2, t.mon(), 'x')$q$, 'end before start rejected');
  perform t.denied($q$select public.request_leave('casual', current_date - 60, current_date - 59, 'x')$q$, 'too far in the past rejected');
  perform t.denied($q$select public.request_leave('casual', t.mon(), t.mon() + 80, 'x')$q$, 'over 60 days rejected');
  perform t.denied($q$select public.request_leave('casual', t.mon() + 6, t.mon() + 6, 'sunday only')$q$, 'range without working days rejected');
  perform t.denied($q$select public.request_leave('vacation', t.mon(), t.mon(), 'x')$q$, 'unknown leave type rejected');
  perform t.denied($q$insert into public.leave_requests (user_id, leave_type, start_date, end_date, reason) values ('00000000-0000-0000-0000-0000000000e1','casual',t.mon(),t.mon(),'x')$q$, 'no direct insert');
end $$;

\echo === 15.2 employee request goes to the assigned mentor only
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform public.request_leave('casual', t.mon(), t.mon() + 2, 'family function');
  perform t.denied($q$select public.request_leave('sick', t.mon() + 2, t.mon() + 3, 'overlap')$q$, 'overlapping request rejected');
  perform t.eq(t.val($q$select days||'/'||status||'/'||can_decide from public.leave_request_details$q$), '3/pending/false', 'applicant tracks: 3 working days, pending, cannot self-decide');
  perform t.eq(t.val($q$select string_agg(full_name, ',') from public.my_leave_approvers()$q$), 'Mia Mentor1', 'applicant can see who approves');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform t.eq(t.val($q$select count(*) from public.notifications where type = 'leave_requested'$q$), '1', 'assigned mentor notified');
  perform t.eq(t.val('select count(*) from public.leave_requests'), '1', 'mentor sees the request');
  perform t.eq(t.val($q$select can_decide::text from public.leave_request_details$q$), 'true', 'mentor may decide it');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b2');
  perform t.eq(t.val($q$select count(*) from public.notifications where type = 'leave_requested'$q$), '0', 'other team mentor not notified');
  perform t.eq(t.val('select count(*) from public.leave_requests'), '0', 'other team mentor cannot see it');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select count(*) from public.notifications where type = 'leave_requested'$q$), '0', 'admin not notified while a mentor exists');
  perform t.eq(t.val('select count(*) from public.leave_requests'), '1', 'admin can see it');
  perform t.eq(t.val($q$select can_decide::text from public.leave_request_details$q$), 'false', 'admin cannot decide employee leave that has a mentor');
end $$;
do $$ declare v uuid; begin select id into v from public.leave_requests;   -- captured as superuser
  perform t.act('00000000-0000-0000-0000-0000000000e2');
  perform t.eq(t.val('select count(*) from public.leave_requests'), '0', 'colleague cannot see it');
  perform t.denied(format($q$select public.decide_leave_request(%L, true)$q$, v), 'colleague cannot decide it', array['42501']);
end $$;

\echo === 15.3 decisions
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.denied($q$select public.decide_leave_request(id, true) from public.leave_requests$q$, 'applicant cannot approve own leave');
end $$;
do $$ declare v uuid; begin select id into v from public.leave_requests;
  perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.denied(format($q$select public.decide_leave_request(%L, true)$q$, v), 'admin cannot approve employee leave while a mentor exists', array['42501']);
end $$;
do $$ declare v uuid; begin select id into v from public.leave_requests;
  perform t.act('00000000-0000-0000-0000-0000000000b2');
  perform t.denied(format($q$select public.decide_leave_request(%L, true)$q$, v), 'other team mentor cannot approve', array['42501']);
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform public.decide_leave_request((select id from public.leave_requests), true, 'enjoy');
  perform t.denied($q$select public.decide_leave_request(id, false) from public.leave_requests$q$, 'cannot decide twice');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.eq(t.val($q$select status||'/'||decision_note from public.leave_request_details$q$), 'approved/enjoy', 'applicant sees approval and note');
  perform t.eq(t.val($q$select count(*) from public.notifications where type = 'leave_decided'$q$), '1', 'applicant notified of the decision');
  perform t.denied($q$select public.request_leave('sick', t.mon() + 1, t.mon() + 1, 'overlaps approved')$q$, 'overlap with approved leave rejected');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select count(*) from public.attendance_report(t.mon(), t.mon() + 2, '00000000-0000-0000-0000-0000000000e1') where status = 'on_leave' and leave_type = 'casual'$q$), '3', 'approved future leave shows as on_leave in attendance');
end $$;

\echo === 15.4 cancellation
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform public.cancel_leave((select id from public.leave_requests));
  perform t.denied($q$select public.cancel_leave(id) from public.leave_requests$q$, 'cannot cancel twice');
  perform t.eq(t.val($q$select count(*) from public.attendance_report(t.mon(), t.mon() + 2, '00000000-0000-0000-0000-0000000000e1') where status = 'on_leave'$q$), '0', 'cancelled leave leaves no trace in attendance');
  perform public.request_leave('earned', t.mon(), t.mon(), 'one day');   -- dates free again
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform t.eq(t.val($q$select count(*) from public.notifications where type = 'leave_cancelled'$q$), '1', 'approver told about the cancellation of approved leave');
  perform public.decide_leave_request((select id from public.leave_requests where status = 'pending'), false, 'team deadline');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.eq(t.val($q$select string_agg(status, ',' order by created_at) from public.leave_request_details$q$), 'cancelled,rejected', 'applicant tracks full history');
  perform t.denied($q$select public.cancel_leave(id) from public.leave_requests where status = 'rejected'$q$, 'rejected leave cannot be cancelled');
end $$;

\echo === 15.5 mentor leave goes to admin
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform public.request_leave('sick', t.mon() + 1, t.mon() + 2, 'fever');
  perform t.eq(t.val($q$select string_agg(full_name, ',') from public.my_leave_approvers()$q$), 'Ada Admin', 'mentor requests go to admin');
  perform t.denied($q$select public.decide_leave_request(id, true) from public.leave_requests where user_id = '00000000-0000-0000-0000-0000000000b1'$q$, 'mentor cannot approve own leave');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select count(*) from public.notifications where type = 'leave_requested'$q$), '1', 'admin notified of mentor leave');
end $$;
do $$ declare v uuid; begin select id into v from public.leave_requests where user_id = '00000000-0000-0000-0000-0000000000b1';
  perform t.act('00000000-0000-0000-0000-0000000000b2');
  perform t.eq(t.val($q$select count(*) from public.leave_requests where user_id = '00000000-0000-0000-0000-0000000000b1'$q$), '0', 'another mentor cannot see mentor leave');
  perform t.denied(format($q$select public.decide_leave_request(%L, true)$q$, v), 'another mentor cannot decide', array['42501']);
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.eq(t.val($q$select count(*) from public.leave_requests where user_id = '00000000-0000-0000-0000-0000000000b1'$q$), '0', 'employee cannot see their mentor''s leave');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select can_decide::text from public.leave_request_details where user_id = '00000000-0000-0000-0000-0000000000b1'$q$), 'true', 'admin may decide mentor leave');
  perform public.decide_leave_request((select id from public.leave_requests where user_id = '00000000-0000-0000-0000-0000000000b1'), true);
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform t.eq(t.val($q$select status from public.leave_request_details where user_id = '00000000-0000-0000-0000-0000000000b1'$q$), 'approved', 'mentor sees the approval');
  perform t.eq(t.val($q$select count(*) from public.attendance_report(t.mon() + 1, t.mon() + 2, '00000000-0000-0000-0000-0000000000b1') where status = 'on_leave'$q$), '2', 'mentor leave integrates with attendance');
end $$;

\echo === 15.6 employee with no active mentor falls back to admin
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e9');
  perform public.request_leave('casual', t.mon(), t.mon() + 1, 'personal');
  perform t.eq(t.val($q$select string_agg(full_name, ',') from public.my_leave_approvers()$q$), 'Ada Admin', 'orphan employee routed to admin');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select count(*) from public.notifications where type = 'leave_requested'$q$), '2', 'admin notified of the unassigned employee''s request');
  perform public.decide_leave_request((select id from public.leave_requests where user_id = '00000000-0000-0000-0000-0000000000e9'), true);
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform t.eq(t.val($q$select count(*) from public.leave_requests where user_id = '00000000-0000-0000-0000-0000000000e9'$q$), '0', 'mentors do not see unassigned employees');
end $$;

\echo === 15.7 attendance integration rules (fixed 2025-03 days)
reset role;
insert into public.leave_requests (user_id, leave_type, start_date, end_date, reason, status) values
 (:e3, 'sick',   '2025-03-08', '2025-03-11', 'flu',        'approved'),    -- Sat..Tue, spans the Sunday off
 (:e1, 'casual', '2025-03-03', '2025-03-03', 'was in',     'approved'),    -- but E1 has a check-in that day
 (:e3, 'casual', '2025-03-12', '2025-03-12', 'not decided', 'pending');
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select string_agg(status, ',' order by work_date) from public.attendance_report('2025-03-08','2025-03-12','00000000-0000-0000-0000-0000000000e3')$q$),
               'on_leave,weekly_off,on_leave,on_leave,absent', 'leave covers working days; weekly off wins; pending leave does not count');
  perform t.eq(t.val($q$select status from public.attendance_report('2025-03-03','2025-03-03','00000000-0000-0000-0000-0000000000e1')$q$), 'present', 'a recorded check-in beats leave');
  perform t.eq(t.val($q$select days::text from public.leave_request_details where user_id = '00000000-0000-0000-0000-0000000000e3' and status = 'approved'$q$), '3', 'weekly off not counted in leave days');
end $$;
