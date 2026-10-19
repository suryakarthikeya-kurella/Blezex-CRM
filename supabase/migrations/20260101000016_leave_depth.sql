-- BlezeX Connect — 0016: leave balances (yearly quotas) and half-day leave.
--  * app_settings 'leave.quotas' = allowed days per YEAR per leave type, e.g. {"casual":12,"sick":12,"earned":15}.
--    Types not listed (unpaid, other) are unlimited. A request that would exceed the remaining balance is rejected.
--    The year of a request is the year of its start date.
--  * Half-day leave: single-day requests may be flagged is_half_day and count as 0.5 day. Attendance is unchanged
--    (a recorded check-in always wins), so a half-day-leave day with a check-in simply shows the hours worked.
--  * leave_request_details.days becomes numeric (0.5 possible); request_leave() gains p_half (default false).

alter table public.leave_requests add column is_half_day boolean not null default false;
alter table public.leave_requests add constraint leave_requests_half_day_single check (not is_half_day or start_date = end_date);

insert into public.app_settings (key, value, description) values
 ('leave.quotas', '{"casual":12,"sick":12,"earned":15}', 'Yearly leave allowance in days per type (types not listed are unlimited)');

create function app.validate_leave_quotas() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.key <> 'leave.quotas' then return new; end if;
  if jsonb_typeof(new.value) <> 'object' or exists (
       select 1 from jsonb_each_text(new.value) e
        where e.key not in ('casual','sick','earned','unpaid','other') or e.value !~ '^[0-9]+(\.5)?$' or e.value::numeric > 366) then
    raise exception 'invalid leave quotas: use an object like {"casual":12} with days in 0-366 (halves allowed)' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger settings_validate_leave_quotas before insert or update on public.app_settings
  for each row execute function app.validate_leave_quotas();

create function app.leave_days(p_from date, p_to date, p_half boolean) returns numeric language sql stable set search_path = '' as $$
  select case when p_half and p_from = p_to
              then (case when app.leave_working_days(p_from, p_to) > 0 then 0.5 else 0 end)
              else app.leave_working_days(p_from, p_to)::numeric end
$$;
grant execute on function app.leave_days(date, date, boolean) to authenticated;

drop view public.leave_request_details;
create view public.leave_request_details with (security_invoker = true) as
  select l.*, app.leave_days(l.start_date, l.end_date, l.is_half_day) as days,
         (l.status = 'pending' and app.can_decide_leave_request(l.user_id, l.created_at)) as can_decide
  from public.leave_requests l;
grant select on public.leave_request_details to authenticated;

-- the caller's balance per leave type for a year (default: current year in the company timezone)
create function public.my_leave_balance(p_year int default null)
returns table (leave_type text, quota numeric, used numeric, pending numeric, remaining numeric)
language sql stable set search_path = '' as $$
  with y as (select coalesce(p_year, extract(year from (now() at time zone app.company_tz()))::int) as y),
  t(leave_type, ord) as (values ('casual',1),('sick',2),('earned',3),('unpaid',4),('other',5)),
  q as (select coalesce(app.setting('leave.quotas'), '{}'::jsonb) as j),
  u as (select l.leave_type, l.status, app.leave_days(l.start_date, l.end_date, l.is_half_day) as d
          from public.leave_requests l, y
         where l.user_id = app.me() and l.status in ('pending','approved') and extract(year from l.start_date) = y.y)
  select t.leave_type, nullif(q.j ->> t.leave_type, '')::numeric,
         coalesce(sum(u.d) filter (where u.status = 'approved'), 0),
         coalesce(sum(u.d) filter (where u.status = 'pending'), 0),
         case when q.j ? t.leave_type then greatest(0, (q.j ->> t.leave_type)::numeric - coalesce(sum(u.d), 0)) end
    from t cross join q left join u on u.leave_type = t.leave_type
   group by t.leave_type, t.ord, q.j order by t.ord
$$;

-- request_leave: same rules as 0008 plus half-day and the yearly balance
drop function public.request_leave(text, date, date, text);
create function public.request_leave(p_type text, p_start date, p_end date, p_reason text, p_half boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.me(); v_name text; v_today date := (clock_timestamp() at time zone app.company_tz())::date;
  v_days numeric; v_id uuid; a uuid; v_quota numeric; v_used numeric;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if app.my_role() = 'admin' then raise exception 'leave applies to mentors and employees' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = '23514'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'invalid leave dates' using errcode = '22023'; end if;
  if p_half and p_start <> p_end then raise exception 'half-day leave must be a single day' using errcode = '22023'; end if;
  if p_end - p_start > 59 then raise exception 'leave cannot exceed 60 days per request' using errcode = '22023'; end if;
  if p_start < v_today - 30 then raise exception 'leave cannot start more than 30 days in the past' using errcode = '22023'; end if;
  if p_end > v_today + 365 then raise exception 'leave cannot end more than a year ahead' using errcode = '22023'; end if;
  v_days := app.leave_days(p_start, p_end, p_half);
  if v_days = 0 then raise exception 'that range has no working days (weekly offs and holidays are excluded)' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtext('leave:' || v_me::text));
  if exists (select 1 from public.leave_requests where user_id = v_me and status in ('pending','approved')
               and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'overlaps an existing pending or approved leave' using errcode = '23505';
  end if;

  v_quota := nullif(coalesce(app.setting('leave.quotas'), '{}'::jsonb) ->> p_type, '')::numeric;
  if v_quota is not null then
    select coalesce(sum(app.leave_days(start_date, end_date, is_half_day)), 0) into v_used
      from public.leave_requests
     where user_id = v_me and leave_type = p_type and status in ('pending','approved')
       and extract(year from start_date) = extract(year from p_start);
    if v_used + v_days > v_quota then
      raise exception 'not enough % leave left for %: % of % days remain', p_type, extract(year from p_start)::int,
                      greatest(0, v_quota - v_used), v_quota using errcode = '23514';
    end if;
  end if;

  insert into public.leave_requests (user_id, leave_type, start_date, end_date, reason, is_half_day)
  values (v_me, p_type, p_start, p_end, btrim(p_reason), p_half) returning id into v_id;

  select full_name into v_name from public.profiles where id = v_me;
  for a in select app.leave_approvers(v_me) loop
    perform app.notify(a, 'leave_requested', 'Leave request from ' || coalesce(nullif(v_name, ''), 'a team member'),
                       p_type || case when p_half then ' half-day' else '' end || ' leave, ' || p_start::text || ' to ' || p_end::text ||
                       ' (' || trim(trailing '.' from trim(trailing '0' from v_days::text)) || ' working day' ||
                       case when v_days = 1 then '' else 's' end || '): ' || btrim(p_reason), 'leave_requests', v_id::text);
  end loop;
  return v_id;
end $$;

do $$ declare f text; begin
  foreach f in array array['public.my_leave_balance(int)', 'public.request_leave(text,date,date,text,boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
