-- Authorization tests. Every DO block is its own transaction; identity is switched with t.act().
\set a  '''00000000-0000-0000-0000-0000000000a1'''
\set m1 '''00000000-0000-0000-0000-0000000000b1'''
\set m2 '''00000000-0000-0000-0000-0000000000b2'''
\set e1 '''00000000-0000-0000-0000-0000000000e1'''
\set e2 '''00000000-0000-0000-0000-0000000000e2'''
\set e3 '''00000000-0000-0000-0000-0000000000e3'''
\set d1 '''00000000-0000-0000-0000-0000000000d1'''
\set f1 '''00000000-0000-0000-0000-0000000000f1'''

\echo === 1. unauthenticated / anon access
do $$ begin perform t.act_anon();
  perform t.denied('select count(*) from public.leads', 'anon cannot read leads');
  perform t.denied('select count(*) from public.profiles', 'anon cannot read profiles');
  perform t.denied('select count(*) from public.audit_logs', 'anon cannot read audit logs');
  perform t.denied($q$insert into public.leads (company_name) values ('x')$q$, 'anon cannot insert leads');
  perform t.denied('select * from public.dashboard_summary()', 'anon cannot call dashboard RPC');
  perform t.denied('select * from public.user_directory', 'anon cannot read user directory');
end $$;
-- authenticated JWT whose user has no profile / is not provisioned yet behaves like nobody
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000f1');
  perform t.eq(t.val('select count(*) from public.leads'), '0', 'unprovisioned (inactive) user sees no leads');
  perform t.denied($q$insert into public.leads (company_name, owner_id) values ('x','00000000-0000-0000-0000-0000000000f1')$q$, 'inactive user cannot insert');
end $$;

\echo === 2. employee isolation
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.eq(t.val('select count(*) from public.leads'), '1', 'E1 sees exactly their own lead');
  perform t.eq(t.val($q$select count(*) from public.leads where id = '10000000-0000-0000-0000-000000000002'$q$), '0', 'E1 cannot read E2 lead');
  perform t.affects($q$update public.leads set notes = 'hax' where id = '10000000-0000-0000-0000-000000000002'$q$, 0, 'E1 update of E2 lead affects 0 rows');
  perform t.affects($q$delete from public.leads where id = '10000000-0000-0000-0000-000000000001'$q$, 0, 'E1 cannot delete even own lead');
  perform t.eq(t.val('select count(*) from public.activities'), '1', 'E1 sees only own activities');
  perform t.eq(t.val('select count(*) from public.tasks'), '1', 'E1 sees only own tasks');
  perform t.denied($q$insert into public.activities (lead_id, user_id, activity_type) values ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000e1','call')$q$, 'E1 cannot log activity on E2 lead');
  perform t.denied($q$insert into public.activities (lead_id, user_id, activity_type) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2','call')$q$, 'E1 cannot log activity as E2');
  perform t.eq(t.val('select count(*) from public.profiles'), '1', 'E1 sees only own profile row');
  perform t.eq(t.val('select count(*) from public.team_memberships'), '1', 'E1 sees only own membership');
  perform t.eq(t.val('select count(*) from public.teams'), '1', 'E1 sees only own team');
  perform t.eq(t.val('select count(*) from public.coaching_notes'), '0', 'E1 sees no coaching notes (none)');
  perform t.eq(t.val($q$select count(*) from public.user_directory where id = '00000000-0000-0000-0000-0000000000e2'$q$), '1', 'E1 can resolve colleague NAMES via directory');
  perform t.denied('select email from public.user_directory', 'directory exposes no email column', array['42703']);
end $$;

\echo === 3. no self-promotion / protected profile fields
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.denied($q$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000e1'$q$, 'E1 cannot change own role');
  perform t.denied($q$update public.profiles set is_active = true where id = '00000000-0000-0000-0000-0000000000e1'$q$, 'E1 cannot change own activation');
  perform t.denied($q$update public.profiles set email = 'x@y.z' where id = '00000000-0000-0000-0000-0000000000e1'$q$, 'E1 cannot change own email');
  perform t.affects($q$update public.profiles set full_name = 'Eve Renamed' where id = '00000000-0000-0000-0000-0000000000e1'$q$, 1, 'E1 may change own display name');
  perform t.affects($q$update public.profiles set full_name = 'hax' where id = '00000000-0000-0000-0000-0000000000e2'$q$, 0, 'E1 cannot rename E2');
  perform t.denied($q$select public.admin_update_profile('00000000-0000-0000-0000-0000000000e1', 'admin')$q$, 'E1 cannot call admin_update_profile');
  perform t.denied($q$insert into public.profiles (id, email, role, is_active) values (gen_random_uuid(), 'new@x.test', 'admin', true)$q$, 'no direct profile insert');
  perform t.denied($q$insert into public.team_memberships (team_id, user_id, membership_role) values ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','mentor')$q$, 'E1 cannot make self mentor');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform t.denied($q$select public.admin_update_profile('00000000-0000-0000-0000-0000000000e1', 'admin')$q$, 'mentor cannot call admin_update_profile');
  perform t.denied($q$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b1'$q$, 'mentor cannot self-promote');
end $$;

\echo === 4. protected lead fields & arbitrary assignment
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.denied($q$update public.leads set owner_id = '00000000-0000-0000-0000-0000000000e2' where id = '10000000-0000-0000-0000-000000000001'$q$, 'E1 cannot reassign via direct update');
  perform t.denied($q$update public.leads set stage = 'won' where id = '10000000-0000-0000-0000-000000000001'$q$, 'E1 cannot set stage directly');
  perform t.denied($q$update public.leads set converted_client_id = gen_random_uuid() where id = '10000000-0000-0000-0000-000000000001'$q$, 'E1 cannot forge conversion');
  perform t.denied($q$update public.leads set archived_at = now() where id = '10000000-0000-0000-0000-000000000001'$q$, 'E1 cannot archive directly');
  perform t.denied($q$update public.leads set lead_number = 'LD-HACK' where id = '10000000-0000-0000-0000-000000000001'$q$, 'E1 cannot rewrite lead_number');
  perform t.denied($q$update public.leads set created_by = '00000000-0000-0000-0000-0000000000e2' where id = '10000000-0000-0000-0000-000000000001'$q$, 'E1 cannot rewrite created_by');
  perform t.denied($q$insert into public.leads (company_name, owner_id) values ('Stolen','00000000-0000-0000-0000-0000000000e2')$q$, 'E1 cannot create a lead owned by E2');
  perform t.denied($q$insert into public.leads (company_name, owner_id) values ('Unowned', null)$q$, 'E1 cannot create an unowned lead');
  perform t.denied($q$insert into public.leads (company_name, owner_id, stage) values ('Pre-won','00000000-0000-0000-0000-0000000000e1','won')$q$, 'E1 cannot insert with stage=won');
  perform t.denied($q$select public.assign_lead('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2')$q$, 'E1 cannot assign own lead to E2');
  perform t.denied($q$select public.assign_lead('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1')$q$, 'E1 cannot assign even to self');
  perform t.denied($q$select public.archive_lead('10000000-0000-0000-0000-000000000001')$q$, 'E1 cannot archive');
  perform t.denied($q$select public.move_lead_stage('10000000-0000-0000-0000-000000000002','contacted')$q$, 'E1 cannot move E2 lead');
  perform t.denied($q$update public.leads set email = 'not-an-email' where id = '10000000-0000-0000-0000-000000000001'$q$, 'invalid email rejected by constraint');
end $$;

\echo === 5. mentor scope
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform t.eq(t.val('select count(*) from public.leads'), '2', 'M1 sees own-team leads only (E1,E2)');
  perform t.eq(t.val($q$select count(*) from public.leads where id in ('10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000004')$q$), '0', 'M1 cannot see Team Two or unassigned leads');
  perform t.eq(t.val('select count(*) from public.profiles'), '3', 'M1 sees self + 2 team members only');
  perform t.eq(t.val($q$select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000e3'$q$), '0', 'M1 cannot see unrelated team member profile');
  perform t.eq(t.val('select count(*) from public.tasks'), '1', 'M1 sees only team tasks');
  perform t.eq(t.val('select count(*) from public.activities'), '1', 'M1 sees only team activities');
  perform t.affects($q$update public.leads set notes = 'x' where id = '10000000-0000-0000-0000-000000000003'$q$, 0, 'M1 cannot edit Team Two lead');
  perform t.denied($q$select public.assign_lead('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000e1')$q$, 'M1 cannot reassign Team Two lead');
  perform t.denied($q$select public.assign_lead('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000e1')$q$, 'M1 cannot grab unassigned lead');
  perform t.denied($q$select public.assign_lead('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e3')$q$, 'M1 cannot assign to someone outside the team');
  perform t.denied($q$insert into public.leads (company_name, owner_id) values ('x','00000000-0000-0000-0000-0000000000e3')$q$, 'M1 cannot create a lead for another team');
  perform t.denied($q$insert into public.tasks (title, assigned_to) values ('x','00000000-0000-0000-0000-0000000000e3')$q$, 'M1 cannot assign task to another team');
  perform t.eq(t.val('select count(*) from public.teams'), '1', 'M1 sees only own team');
  -- system settings & vocabularies
  perform t.affects($q$update public.app_settings set value = 'false' where key = 'mentor.can_assign_leads'$q$, 0, 'M1 cannot change settings');
  perform t.denied($q$insert into public.pipeline_stages (key,label,position) values ('hax','Hax',999)$q$, 'M1 cannot add pipeline stage');
  perform t.denied($q$insert into public.lead_sources (name) values ('Hax')$q$, 'M1 cannot add lead source');
  perform t.denied($q$insert into public.user_targets (user_id, period_start, period_end, target_type, target_value) values ('00000000-0000-0000-0000-0000000000e1', current_date, current_date, 'outreach', 5)$q$, 'M1 cannot set targets');
  perform t.denied($q$insert into public.team_memberships (team_id, user_id) values ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e3')$q$, 'M1 cannot manage team membership');
  -- positive: team reassignment within the team
  perform public.assign_lead('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2','balance load');
  perform t.eq(t.val($q$select owner_id::text from public.leads where id = '10000000-0000-0000-0000-000000000001'$q$), '00000000-0000-0000-0000-0000000000e2', 'M1 reassigns within own team');
  perform public.assign_lead('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','restore');
  perform t.eq(t.val($q$select count(*) from public.lead_assignments where lead_id = '10000000-0000-0000-0000-000000000001' and unassigned_at is null$q$), '1', 'exactly one open assignment');
  perform t.eq(t.val($q$select count(*) from public.lead_assignments where lead_id = '10000000-0000-0000-0000-000000000001'$q$), '3', 'assignment history preserved');
end $$;

\echo === 6. admin capabilities
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val('select count(*) from public.leads'), '5', 'admin sees all leads');
  perform public.assign_lead('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000e3','route');
  perform t.eq(t.val($q$select owner_id::text from public.leads where id='10000000-0000-0000-0000-000000000004'$q$), '00000000-0000-0000-0000-0000000000e3', 'admin assigns unassigned lead');
  perform t.denied($q$select public.admin_update_profile('00000000-0000-0000-0000-0000000000a1', 'bds_employee')$q$, 'admin cannot demote self');
  perform t.denied($q$select public.admin_update_profile('00000000-0000-0000-0000-0000000000a1', null, false)$q$, 'admin cannot deactivate self');
  perform t.denied($q$select public.admin_update_profile('00000000-0000-0000-0000-0000000000e1', 'superuser')$q$, 'invalid role rejected');
  perform t.affects($q$update public.app_settings set value = '30' where key = 'lead.stale_days'$q$, 1, 'admin may change settings');
  perform t.affects($q$update public.app_settings set value = '14' where key = 'lead.stale_days'$q$, 1, 'admin restores setting');
  perform t.eq(t.val($q$select updated_by::text from public.app_settings where key='lead.stale_days'$q$), '00000000-0000-0000-0000-0000000000a1', 'settings change stamped with actor');
end $$;
-- mentor assignment can be disabled by admin
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  update public.app_settings set value = 'false' where key = 'mentor.can_assign_leads';
  perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform t.denied($q$select public.assign_lead('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2')$q$, 'mentor assignment disabled by setting');
end $$;
update public.app_settings set value = 'true' where key = 'mentor.can_assign_leads';

\echo === 7. financial records
insert into public.clients (id, company_name) values ('30000000-0000-0000-0000-000000000001', 'Fin Client');
insert into public.invoices (id, client_id, due_date, total, status) values ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001', current_date + 7, 1000, 'issued');
insert into public.payments (invoice_id, amount, method) values ('40000000-0000-0000-0000-000000000001', 100, 'upi');
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.eq(t.val('select count(*) from public.invoices'), '0', 'E1 cannot read invoices');
  perform t.eq(t.val('select count(*) from public.payments'), '0', 'E1 cannot read payments');
  perform t.eq(t.val('select count(*) from public.invoice_balances'), '0', 'E1 cannot read balances');
  perform t.denied($q$insert into public.invoices (client_id, due_date, total) values ('30000000-0000-0000-0000-000000000001', current_date, 5)$q$, 'E1 cannot create invoice');
  perform t.denied($q$insert into public.payments (invoice_id, amount, method) values ('40000000-0000-0000-0000-000000000001', 1, 'cash')$q$, 'E1 cannot record payment');
  perform t.affects($q$update public.payments set status = 'cancelled'$q$, 0, 'E1 cannot alter payments');
  perform t.affects($q$update public.invoices set total = 1$q$, 0, 'E1 cannot alter invoices');
  perform t.denied($q$delete from public.payments$q$, 'nobody can delete payments');
  perform t.denied($q$select public.report_revenue(current_date - 30, current_date)$q$, 'E1 cannot run revenue report');
  perform t.denied($q$insert into public.clients (company_name) values ('x')$q$, 'E1 cannot create clients directly');
  perform t.eq(t.val('select count(*) from public.clients'), '0', 'E1 sees no unrelated client');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform t.eq(t.val('select count(*) from public.invoices'), '0', 'mentor cannot read invoices (no policy grants it by default)');
  perform t.eq(t.val('select count(*) from public.payments'), '0', 'mentor cannot read payments');
  perform t.denied($q$select public.report_revenue(current_date - 30, current_date)$q$, 'mentor cannot run revenue report');
  perform t.denied($q$insert into public.payments (invoice_id, amount, method) values ('40000000-0000-0000-0000-000000000001', 1, 'cash')$q$, 'mentor cannot record payment');
end $$;

\echo === 8. audit log integrity
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.denied('delete from public.audit_logs', 'E1 cannot delete audit logs');
  perform t.denied($q$update public.audit_logs set action = 'x'$q$, 'E1 cannot update audit logs');
  perform t.denied($q$insert into public.audit_logs (action, entity_type) values ('fake','leads')$q$, 'E1 cannot forge audit logs');
  perform t.eq(t.val($q$select count(*) from public.audit_logs where entity_type not in ('leads','tasks','lead_assignments','coaching_notes')$q$), '0', 'E1 sees only work-related audit entries');
  perform t.eq(t.val($q$select count(*) from public.audit_logs where actor_id is distinct from '00000000-0000-0000-0000-0000000000e1'$q$), '0', 'E1 sees only own audit entries');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.denied('delete from public.audit_logs', 'admin cannot delete audit logs through the API');
  perform t.denied($q$update public.audit_logs set action = 'x'$q$, 'admin cannot edit audit logs through the API');
  perform t.eq((select (count(*) > 0)::text from public.audit_logs), 'true', 'admin can read audit logs');
  perform t.eq((select (count(*) filter (where entity_type = 'profiles') > 0)::text from public.audit_logs), 'true', 'profile changes are audited');
end $$;
do $$ begin  -- even the table owner / service role cannot rewrite history
  perform t.denied($q$update public.audit_logs set action = 'tampered'$q$, 'superuser UPDATE blocked by trigger');
  perform t.denied('delete from public.audit_logs', 'superuser DELETE blocked by trigger');
  perform t.denied('truncate public.audit_logs', 'superuser TRUNCATE blocked by trigger');
end $$;
do $$ begin
  perform t.eq((select count(*) from public.audit_logs where after_data ? 'password')::text, '0', 'no secrets in audit data');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e3');
  perform t.eq(t.val($q$select count(*) from public.audit_logs where actor_id = '00000000-0000-0000-0000-0000000000e1'$q$), '0', 'E3 cannot see E1 audit entries');
end $$;

\echo === 9. deactivated accounts lose access immediately
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000d1');
  perform t.eq(t.val('select count(*) from public.leads'), '1', 'precondition: D1 sees own lead while active');
end $$;
update public.profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000d1';
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000d1');
  perform t.eq(t.val('select count(*) from public.leads'), '0', 'deactivated D1 sees no leads (JWT still valid)');
  perform t.eq(t.val('select count(*) from public.profiles'), '0', 'deactivated D1 cannot read profile');
  perform t.eq(t.val('select count(*) from public.tasks'), '0', 'deactivated D1 sees no tasks');
  perform t.eq(t.val('select count(*) from public.user_directory'), '0', 'deactivated D1 sees no directory');
  perform t.denied($q$insert into public.leads (company_name, owner_id) values ('x','00000000-0000-0000-0000-0000000000d1')$q$, 'deactivated D1 cannot create leads');
  perform t.denied($q$select public.move_lead_stage('10000000-0000-0000-0000-000000000005','contacted')$q$, 'deactivated D1 cannot move stage');
  perform t.denied($q$select * from public.dashboard_summary()$q$, 'deactivated D1 cannot load dashboard');
  perform t.eq(t.val('select count(*) from public.my_action_items()'), '0', 'deactivated D1 has no action items');
end $$;
-- a deactivated mentor stops supervising
update public.profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000b2';
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b2');
  perform t.eq(t.val('select count(*) from public.leads'), '0', 'deactivated mentor sees no team leads');
end $$;
update public.profiles set is_active = true where id = '00000000-0000-0000-0000-0000000000b2';
-- demoting a mentor removes supervisory access (role comes from profiles, memberships alone are not enough)
update public.profiles set role = 'bds_employee' where id = '00000000-0000-0000-0000-0000000000b1';
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform t.eq(t.val('select count(*) from public.leads'), '0', 'demoted mentor no longer sees team leads');
end $$;
update public.profiles set role = 'mentor' where id = '00000000-0000-0000-0000-0000000000b1';

\echo === 10. direct API requests cannot bypass the UI (PostgREST-equivalent paths)
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  -- forged JWT claims cannot escalate: role is read from profiles, never from claims
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e1','role','authenticated','app_role','admin','user_role','admin','user_metadata',json_build_object('role','admin'))::text, true);
  perform t.eq(t.val('select count(*) from public.leads'), '1', 'forged role claims do not widen access');
  perform t.denied($q$select public.admin_update_profile('00000000-0000-0000-0000-0000000000e1', 'admin')$q$, 'forged admin claim cannot call admin RPC');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.denied('select count(*) from app.lead_seq', 'sequences in app schema are not readable by API roles');
  perform t.denied($q$select nextval('app.lead_seq')$q$, 'API roles cannot advance business-number sequences');
  perform t.denied('select * from auth.users', 'auth.users not readable by authenticated');
end $$;
do $$ declare c int; begin
  select count(*) into c from pg_tables t where schemaname = 'public' and not rowsecurity;
  perform t.eq(c::text, '0', 'RLS enabled on every public table');
  select count(*) into c from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public';
  perform t.eq(c::text, '0', 'anon has zero table grants in public');
  select count(*) into c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute');
  perform t.eq(c::text, '0', 'anon cannot execute any public function');
  select count(*) into c from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = 'public' and cl.relkind = 'r' and not exists (select 1 from pg_policy p where p.polrelid = cl.oid);
  perform t.eq(c::text, '0', 'every public table has at least one policy');
end $$;
