-- 0015 templates + 0016 leave balances and half-day.
\set e1 '''00000000-0000-0000-0000-0000000000e1'''

\echo === 19.1 message templates: everyone reads, only admin writes
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.eq(t.val('select (count(*) >= 4)::text from public.message_templates'), 'true', 'employee reads active templates');
  perform t.denied($q$insert into public.message_templates (name, channel, body) values ('x','email','y')$q$, 'employee cannot create templates');
  perform t.affects($q$update public.message_templates set body = 'hax'$q$, 0, 'employee cannot edit templates');
  perform t.affects($q$delete from public.message_templates$q$, 0, 'employee cannot delete templates');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.denied($q$insert into public.message_templates (name, channel, body) values ('bad','sms','y')$q$, 'unknown channel rejected');
  perform t.affects($q$insert into public.message_templates (name, channel, subject, body) values ('Custom','email','s','b')$q$, 1, 'admin creates a template');
  perform t.affects($q$update public.message_templates set is_active = false where name = 'Custom'$q$, 1, 'admin deactivates it');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.eq(t.val($q$select count(*) from public.message_templates where name = 'Custom'$q$), '0', 'inactive templates are hidden from non-admins');
end $$;
do $$ begin perform t.act_anon();
  perform t.denied('select count(*) from public.message_templates', 'anon cannot read templates');
end $$;

\echo === 19.2 leave quotas and half-day
update public.leave_requests set status = 'cancelled' where user_id = :e1 and status in ('pending','approved');
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.denied($q$update public.app_settings set value = '{"casual":"lots"}' where key = 'leave.quotas'$q$, 'invalid quota rejected');
  perform t.denied($q$update public.app_settings set value = '{"vacation":3}' where key = 'leave.quotas'$q$, 'unknown type in quotas rejected');
  perform t.affects($q$update public.app_settings set value = '{"casual":2,"sick":1}' where key = 'leave.quotas'$q$, 1, 'admin sets quotas: casual 2, sick 1');
end $$;
do $$ declare mon date := date_trunc('week', current_date)::date + 7 + 98; begin   -- a Monday ~15 weeks ahead
  perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.denied(format($q$select public.request_leave('sick', %L, %L, 'x', true)$q$, mon, mon + 1), 'half-day must be one day');
  perform public.request_leave('casual', mon, mon, 'half', true);
  perform t.eq(t.val(format($q$select days::text from public.leave_request_details where start_date = %L$q$, mon)), '0.5', 'half-day counts 0.5');
  perform t.eq(t.val($q$select remaining::text from public.my_leave_balance(extract(year from current_date + 112)::int) where leave_type = 'casual'$q$), '1.5', 'balance: 2 - 0.5 pending');
  perform public.request_leave('casual', mon + 1, mon + 1, 'full day');
  perform t.eq(t.val($q$select remaining::text from public.my_leave_balance(extract(year from current_date + 112)::int) where leave_type = 'casual'$q$), '0.5', 'balance after a full day');
  perform t.denied(format($q$select public.request_leave('casual', %L, %L, 'one too many')$q$, mon + 2, mon + 2), 'request above the remaining balance rejected');
  perform public.request_leave('sick', mon + 3, mon + 3, 'sick day');
  perform t.denied(format($q$select public.request_leave('sick', %L, %L, 'second sick')$q$, mon + 4, mon + 4), 'sick quota of 1 enforced');
  perform public.request_leave('unpaid', mon + 7, mon + 11, 'unlimited type');
  perform t.eq(t.val($q$select (quota is null)::text from public.my_leave_balance(extract(year from current_date + 112)::int) where leave_type = 'unpaid'$q$), 'true', 'types without a quota are unlimited');
  perform t.eq(t.val($q$select pending::text from public.my_leave_balance(extract(year from current_date + 112)::int) where leave_type = 'casual'$q$), '1.5', 'pending days reported');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.affects($q$update public.app_settings set value = '{"casual":12,"sick":12,"earned":15}' where key = 'leave.quotas'$q$, 1, 'quotas restored');
end $$;
