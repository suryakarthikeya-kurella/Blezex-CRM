-- Test harness + fixtures (TEST ONLY). Identity switching mimics PostgREST: role = authenticated + JWT claims.
create schema t;
grant usage on schema t to anon, authenticated;

create function t.act(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function t.act_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end $$;
create function t.reset() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;

-- passes only when stmt raises one of the expected SQLSTATEs (a typo/syntax error is NOT accepted as a denial)
create function t.denied(stmt text, label text,
  ok_states text[] default array['42501','23514','P0002','28000','40001','23505','23503','22023'])
returns void language plpgsql as $$
declare st text;
begin
  begin execute stmt;
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    if st = any(ok_states) then raise notice 'PASS  [denied %] %', st, label; return; end if;
    raise exception 'FAIL  [unexpected error % : %] %', st, sqlerrm, label;
  end;
  raise exception 'FAIL  [statement unexpectedly succeeded] %', label;
end $$;

create function t.affects(stmt text, n bigint, label text) returns void language plpgsql as $$
declare c bigint;
begin
  execute stmt; get diagnostics c = row_count;
  if c <> n then raise exception 'FAIL  [% rows affected, expected %] %', c, n, label; end if;
  raise notice 'PASS  [% rows] %', c, label;
end $$;
create function t.eq(actual text, expected text, label text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'FAIL  [got %, expected %] %', actual, expected, label; end if;
  raise notice 'PASS  % ', label;
end $$;
create function t.val(stmt text) returns text language plpgsql as $$
declare v text; begin execute stmt into v; return v; end $$;

-- Users (auth.users insert fires the provisioning trigger: inactive employee profiles) ───────────────
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@blezex.test'),
 ('00000000-0000-0000-0000-0000000000b1','mentor1@blezex.test'),
 ('00000000-0000-0000-0000-0000000000b2','mentor2@blezex.test'),
 ('00000000-0000-0000-0000-0000000000e1','emp1@blezex.test'),
 ('00000000-0000-0000-0000-0000000000e2','emp2@blezex.test'),
 ('00000000-0000-0000-0000-0000000000e3','emp3@blezex.test'),
 ('00000000-0000-0000-0000-0000000000d1','dead@blezex.test'),
 ('00000000-0000-0000-0000-0000000000f1','pending@blezex.test');
update public.profiles set is_active = true, role = 'admin',  full_name = 'Ada Admin'  where email = 'admin@blezex.test';
update public.profiles set is_active = true, role = 'mentor', full_name = 'Mia Mentor1' where email = 'mentor1@blezex.test';
update public.profiles set is_active = true, role = 'mentor', full_name = 'Max Mentor2' where email = 'mentor2@blezex.test';
update public.profiles set is_active = true, full_name = 'Eve Emp1' where email = 'emp1@blezex.test';
update public.profiles set is_active = true, full_name = 'Eli Emp2' where email = 'emp2@blezex.test';
update public.profiles set is_active = true, full_name = 'Ed Emp3'  where email = 'emp3@blezex.test';
update public.profiles set is_active = true, full_name = 'Dee Dead' where email = 'dead@blezex.test';

insert into public.teams (id, name) values ('70000000-0000-0000-0000-000000000001','Team One'), ('70000000-0000-0000-0000-000000000002','Team Two');
insert into public.team_memberships (team_id, user_id, membership_role) values
 ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','mentor'),
 ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','member'),
 ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2','member'),
 ('70000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b2','mentor'),
 ('70000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000e3','member'),
 ('70000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000d1','member');

insert into public.leads (id, company_name, contact_name, email, owner_id, estimated_value) values
 ('10000000-0000-0000-0000-000000000001','Lead One (E1)','C1','c1@x.test','00000000-0000-0000-0000-0000000000e1', 1000),
 ('10000000-0000-0000-0000-000000000002','Lead Two (E2)','C2','c2@x.test','00000000-0000-0000-0000-0000000000e2', 2000),
 ('10000000-0000-0000-0000-000000000003','Lead Three (E3)','C3','c3@x.test','00000000-0000-0000-0000-0000000000e3', 3000),
 ('10000000-0000-0000-0000-000000000004','Lead Four (unassigned)','C4','c4@x.test', null, 4000),
 ('10000000-0000-0000-0000-000000000005','Lead Five (D1)','C5','c5@x.test','00000000-0000-0000-0000-0000000000d1', 5000);
insert into public.tasks (id, title, assigned_to, created_by) values
 ('20000000-0000-0000-0000-000000000001','E1 task','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e1'),
 ('20000000-0000-0000-0000-000000000003','E3 task','00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-0000000000e3');
insert into public.activities (lead_id, user_id, activity_type, subject) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','call','E1 call'),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000e3','call','E3 call');
