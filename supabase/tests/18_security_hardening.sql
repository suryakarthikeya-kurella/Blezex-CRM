-- 0014: two-factor enforced in the database, leave escalation after 48h, offboarding.
\set a  '''00000000-0000-0000-0000-0000000000a1'''
\set e1 '''00000000-0000-0000-0000-0000000000e1'''
\set e2 '''00000000-0000-0000-0000-0000000000e2'''
\set e3 '''00000000-0000-0000-0000-0000000000e3'''

-- act with a given assurance level (what PostgREST would put in the JWT)
create function t.act_aal(p uuid, aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', aal)::text, true);
  execute 'set local role authenticated';
end $$;

\echo === 18.1 2FA: a verified factor makes a password-only (aal1) session worthless
insert into auth.mfa_factors (user_id, status) values (:e1, 'verified'), (:e2, 'unverified');
do $$ begin perform t.act_aal('00000000-0000-0000-0000-0000000000e1', 'aal1');
  perform t.eq(t.val('select count(*) from public.profiles'), '0', 'aal1 session cannot read even its own profile');
  perform t.eq(t.val('select count(*) from public.leads'), '0', 'aal1 session sees no leads');
  perform t.denied('select public.attendance_check_in()', 'aal1 session cannot use definer RPCs', array['28000']);
  perform t.denied($q$select public.request_leave('casual', current_date + 100, current_date + 100, 'x')$q$, 'aal1 cannot request leave', array['28000']);
end $$;
do $$ begin perform t.act_aal('00000000-0000-0000-0000-0000000000e1', 'aal2');
  perform t.eq(t.val('select count(*) from public.profiles'), '1', 'aal2 session works normally');
  perform t.eq(t.val('select (count(*) > 0)::text from public.leads'), 'true', 'aal2 sees its leads');
end $$;
do $$ begin perform t.act_aal('00000000-0000-0000-0000-0000000000e2', 'aal1');
  perform t.eq(t.val('select count(*) from public.profiles'), '1', 'an UNVERIFIED (half-enrolled) factor does not lock the user out');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e3');
  perform t.eq(t.val('select count(*) from public.profiles'), '1', 'users without any factor are unaffected');
end $$;
do $$ begin perform t.act_aal('00000000-0000-0000-0000-0000000000a1', 'aal1');
  perform t.eq(t.val('select (count(*) > 1)::text from public.profiles'), 'true', 'admin without a factor is unaffected');
end $$;
reset role;
delete from auth.mfa_factors where user_id = :e1;
do $$ begin perform t.act_aal('00000000-0000-0000-0000-0000000000e1', 'aal1');
  perform t.eq(t.val('select count(*) from public.profiles'), '1', 'removing the factor (admin reset) restores access');
end $$;
reset role;
delete from auth.mfa_factors;

\echo === 18.2 leave escalation: admin may decide only after 48 hours
insert into public.leave_requests (user_id, leave_type, start_date, end_date, reason, status, created_at) values
 (:e3, 'casual', current_date + 200, current_date + 200, 'fresh',  'pending', now()),
 (:e3, 'casual', current_date + 210, current_date + 210, 'stale',  'pending', now() - interval '3 days');
do $$ declare v_fresh uuid; v_stale uuid; begin
  select id into v_fresh from public.leave_requests where reason = 'fresh';
  select id into v_stale from public.leave_requests where reason = 'stale';
  perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select can_decide::text from public.leave_request_details where reason = 'fresh'$q$), 'false', 'admin cannot decide a fresh employee request');
  perform t.eq(t.val($q$select can_decide::text from public.leave_request_details where reason = 'stale'$q$), 'true', 'admin can decide one waiting > 48h');
  perform t.denied(format($q$select public.decide_leave_request(%L, true)$q$, v_fresh), 'fresh request still mentor-only', array['42501']);
  perform public.decide_leave_request(v_stale, false, 'mentor unavailable');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b2');
  perform t.eq(t.val($q$select can_decide::text from public.leave_request_details where reason = 'fresh'$q$), 'true', 'the assigned mentor still decides the fresh one');
end $$;

\echo === 18.3 offboarding
reset role;
insert into public.leads (id, company_name, owner_id) values ('10000000-0000-0000-0000-0000000000f1', 'Leaver Lead', :e2);
insert into public.tasks (title, assigned_to, created_by) values ('Leaver task', :e2, :e2);
do $$ declare r jsonb; begin
  perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.denied($q$select public.offboard_user('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1')$q$, 'employee cannot offboard anyone');
  perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform t.denied($q$select public.offboard_user('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1')$q$, 'mentor cannot offboard');
  perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.denied($q$select public.offboard_user('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1')$q$, 'admin cannot offboard self');
  perform t.denied($q$select public.offboard_user('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e2')$q$, 'cannot hand over to the leaver');
  perform t.denied($q$select public.offboard_user('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1')$q$, 'receiver must be active', array['P0002','42501','22023']);
  r := public.offboard_user('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1');
  perform t.eq(((r ->> 'leads')::int >= 1)::text, 'true', 'leads counted');
  perform t.eq(t.val($q$select owner_id::text from public.leads where id = '10000000-0000-0000-0000-0000000000f1'$q$), '00000000-0000-0000-0000-0000000000e1', 'lead moved to the receiver');
  perform t.eq(t.val($q$select count(*) from public.lead_assignments where lead_id = '10000000-0000-0000-0000-0000000000f1' and unassigned_at is null$q$), '1', 'exactly one open assignment');
  perform t.eq(t.val($q$select assigned_to::text from public.tasks where title = 'Leaver task'$q$), '00000000-0000-0000-0000-0000000000e1', 'open task moved');
  perform t.eq(t.val($q$select is_active::text from public.profiles where id = '00000000-0000-0000-0000-0000000000e2'$q$), 'false', 'leaver deactivated');
  perform t.eq(t.val($q$select count(*) from public.team_memberships where user_id = '00000000-0000-0000-0000-0000000000e2' and is_active$q$), '0', 'memberships ended');
  perform t.eq(t.val($q$select count(*) from public.audit_logs where entity_type = 'leads' and entity_id = '10000000-0000-0000-0000-0000000000f1' and action = 'update'$q$), '1', 'reassignment is in the audit log');
end $$;
