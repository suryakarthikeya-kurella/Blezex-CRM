-- BlezeX Connect — 0005: database-side aggregation for dashboards and reports.
-- All functions are SECURITY INVOKER: they run as the caller, so RLS scopes every number to what that user may see
-- (admin = company, mentor = own team, employee = self). Revenue is the exception: it raises for non-admins
-- instead of returning a misleading zero.
--
-- Metric definitions (single source of truth: app.metric_value)
--   new_leads        leads created_by the user in the period
--   qualified_leads  distinct leads owned by the user that entered stage "qualified" in the period
--   meetings         distinct leads owned by the user that entered "meeting_scheduled" in the period
--   proposals        proposals with sent_at in the period on leads owned by the user
--   conversions      leads owned by the user with converted_at in the period
--   lost             distinct leads owned by the user that entered the Lost stage in the period
--   outreach         call/email/whatsapp/follow_up/meeting/demo activities logged by the user in the period
--   won_value        SUM(projects.agreed_value) for clients converted from the user's leads in the period (NOT cash received)
--   tasks_completed  tasks assigned to the user with completed_at in the period
-- Pipeline value = SUM(estimated_value) of open leads (never counted as revenue). Cash collected = completed payments − refunds.

create function app.tz() returns text language sql stable security definer set search_path = '' as $$
  select coalesce(app.setting('company') ->> 'timezone', 'Asia/Kolkata')
$$;
grant execute on function app.tz() to authenticated;

create function app.metric_value(p_user uuid, p_type text, p_from timestamptz, p_to timestamptz) returns numeric
language sql stable set search_path = '' as $$
  select case p_type
    when 'new_leads' then (select count(*) from public.leads l where l.created_by = p_user and l.created_at >= p_from and l.created_at < p_to)
    when 'qualified_leads' then (select count(distinct h.lead_id) from public.lead_stage_history h join public.leads l on l.id = h.lead_id
        where l.owner_id = p_user and h.to_stage = 'qualified' and h.changed_at >= p_from and h.changed_at < p_to)
    when 'meetings' then (select count(distinct h.lead_id) from public.lead_stage_history h join public.leads l on l.id = h.lead_id
        where l.owner_id = p_user and h.to_stage = 'meeting_scheduled' and h.changed_at >= p_from and h.changed_at < p_to)
    when 'proposals' then (select count(*) from public.proposals p join public.leads l on l.id = p.lead_id
        where l.owner_id = p_user and p.sent_at >= p_from and p.sent_at < p_to)
    when 'conversions' then (select count(*) from public.leads l where l.owner_id = p_user and l.converted_at >= p_from and l.converted_at < p_to)
    when 'lost' then (select count(distinct h.lead_id) from public.lead_stage_history h join public.leads l on l.id = h.lead_id
        where l.owner_id = p_user and h.to_stage = 'lost' and l.stage = 'lost' and h.changed_at >= p_from and h.changed_at < p_to)
    when 'outreach' then (select count(*) from public.activities a where a.user_id = p_user and a.occurred_at >= p_from and a.occurred_at < p_to
        and a.activity_type in ('call','email','whatsapp','follow_up','meeting','demo'))
    when 'won_value' then (select coalesce(sum(pr.agreed_value), 0) from public.leads l
        join public.clients c on c.source_lead_id = l.id join public.projects pr on pr.client_id = c.id
        where l.owner_id = p_user and l.converted_at >= p_from and l.converted_at < p_to)
    when 'tasks_completed' then (select count(*) from public.tasks t where t.assigned_to = p_user and t.completed_at >= p_from and t.completed_at < p_to)
  end
$$;
grant execute on function app.metric_value(uuid, text, timestamptz, timestamptz) to authenticated;

create function public.report_by_employee(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, full_name text, role text, active_leads bigint, new_leads numeric, qualified_leads numeric, meetings numeric,
               proposals numeric, conversions numeric, lost numeric, outreach numeric, tasks_completed numeric, won_value numeric,
               conversion_rate numeric)
language sql stable set search_path = '' as $$
  select p.id, p.full_name, p.role,
    (select count(*) from public.leads l where l.owner_id = p.id and l.archived_at is null
        and not exists (select 1 from public.pipeline_stages s where s.key = l.stage and (s.is_won or s.is_lost))),
    app.metric_value(p.id, 'new_leads', p_from, p_to), app.metric_value(p.id, 'qualified_leads', p_from, p_to),
    app.metric_value(p.id, 'meetings', p_from, p_to), app.metric_value(p.id, 'proposals', p_from, p_to),
    app.metric_value(p.id, 'conversions', p_from, p_to), app.metric_value(p.id, 'lost', p_from, p_to),
    app.metric_value(p.id, 'outreach', p_from, p_to), app.metric_value(p.id, 'tasks_completed', p_from, p_to),
    app.metric_value(p.id, 'won_value', p_from, p_to),
    round(100.0 * app.metric_value(p.id, 'conversions', p_from, p_to)
          / nullif(app.metric_value(p.id, 'conversions', p_from, p_to) + app.metric_value(p.id, 'lost', p_from, p_to), 0), 1)
  from public.profiles p where p.is_active and p.role in ('bds_employee','mentor')
  order by p.full_name
$$;

create function public.report_by_team(p_from timestamptz, p_to timestamptz)
returns table (team_id uuid, team_name text, members bigint, new_leads numeric, qualified_leads numeric, meetings numeric,
               proposals numeric, conversions numeric, lost numeric, outreach numeric, tasks_completed numeric, won_value numeric,
               conversion_rate numeric)
language sql stable set search_path = '' as $$
  with m as (
    select t.id as team_id, t.name, tm.user_id from public.teams t
    join public.team_memberships tm on tm.team_id = t.id and tm.is_active and tm.membership_role = 'member' where t.status = 'active')
  select m.team_id, m.name, count(*),
    sum(app.metric_value(m.user_id,'new_leads',p_from,p_to)), sum(app.metric_value(m.user_id,'qualified_leads',p_from,p_to)),
    sum(app.metric_value(m.user_id,'meetings',p_from,p_to)), sum(app.metric_value(m.user_id,'proposals',p_from,p_to)),
    sum(app.metric_value(m.user_id,'conversions',p_from,p_to)), sum(app.metric_value(m.user_id,'lost',p_from,p_to)),
    sum(app.metric_value(m.user_id,'outreach',p_from,p_to)), sum(app.metric_value(m.user_id,'tasks_completed',p_from,p_to)),
    sum(app.metric_value(m.user_id,'won_value',p_from,p_to)),
    round(100.0 * sum(app.metric_value(m.user_id,'conversions',p_from,p_to))
      / nullif(sum(app.metric_value(m.user_id,'conversions',p_from,p_to)) + sum(app.metric_value(m.user_id,'lost',p_from,p_to)), 0), 1)
  from m group by m.team_id, m.name order by m.name
$$;

create function public.report_lead_sources(p_from timestamptz, p_to timestamptz)
returns table (source text, leads bigint, won bigint, lost bigint, open_pipeline_value numeric, win_rate numeric)
language sql stable set search_path = '' as $$
  select coalesce(s.name, 'Unspecified'), count(*), count(*) filter (where l.stage = 'won'), count(*) filter (where l.stage = 'lost'),
         coalesce(sum(l.estimated_value) filter (where l.stage not in ('won','lost')), 0),
         round(100.0 * count(*) filter (where l.stage = 'won') / nullif(count(*) filter (where l.stage in ('won','lost')), 0), 1)
  from public.leads l left join public.lead_sources s on s.id = l.lead_source_id
  where l.archived_at is null and l.created_at >= p_from and l.created_at < p_to
  group by s.name order by count(*) desc
$$;

create function public.report_lost_reasons(p_from timestamptz, p_to timestamptz)
returns table (reason text, leads bigint, lost_value numeric) language sql stable set search_path = '' as $$
  select r.label, count(*), coalesce(sum(l.estimated_value), 0)
  from public.leads l join public.lost_reasons r on r.id = l.lost_reason_id
  where l.stage = 'lost' and l.archived_at is null and l.updated_at >= p_from and l.updated_at < p_to
  group by r.label order by count(*) desc
$$;

create function public.report_monthly_growth(p_months integer default 12)
returns table (month date, new_leads bigint, won bigint, lost bigint, won_value numeric) language sql stable set search_path = '' as $$
  with tz as (select app.tz() as z),
  months as (select (date_trunc('month', now() at time zone tz.z) - make_interval(months => g))::date as m
             from tz, generate_series(0, greatest(least(p_months, 36), 1) - 1) g)
  select months.m,
    (select count(*) from public.leads l where l.archived_at is null and (l.created_at at time zone tz.z) >= months.m and (l.created_at at time zone tz.z) < months.m + interval '1 month'),
    (select count(*) from public.leads l where l.converted_at is not null and (l.converted_at at time zone tz.z) >= months.m and (l.converted_at at time zone tz.z) < months.m + interval '1 month'),
    (select count(*) from public.lead_stage_history h join public.leads l on l.id = h.lead_id where h.to_stage = 'lost' and l.stage = 'lost'
        and (h.changed_at at time zone tz.z) >= months.m and (h.changed_at at time zone tz.z) < months.m + interval '1 month'),
    (select coalesce(sum(pr.agreed_value), 0) from public.leads l join public.clients c on c.source_lead_id = l.id join public.projects pr on pr.client_id = c.id
        where (l.converted_at at time zone tz.z) >= months.m and (l.converted_at at time zone tz.z) < months.m + interval '1 month')
  from months, tz order by months.m
$$;

-- Admin-only. Invoiced ≠ collected ≠ won value.
create function public.report_revenue(p_from date, p_to date) returns jsonb language plpgsql stable set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'financial reports are restricted to admins' using errcode = '42501'; end if;
  return (select jsonb_build_object(
    'invoiced',    coalesce((select sum(total) from public.invoices where status not in ('draft','cancelled') and issue_date between p_from and p_to), 0),
    'collected',   coalesce((select sum(case when kind = 'payment' then amount else -amount end) from public.payments
                              where status = 'completed' and paid_at between p_from and p_to), 0),
    'outstanding', coalesce((select sum(balance) from public.invoice_balances where status in ('issued','partially_paid')), 0),
    'overdue',     coalesce((select sum(balance) from public.invoice_balances where is_overdue), 0),
    'won_value',   coalesce((select sum(pr.agreed_value) from public.leads l join public.clients c on c.source_lead_id = l.id
                              join public.projects pr on pr.client_id = c.id
                              where l.converted_at::date between p_from and p_to), 0)));
end $$;

create function public.target_attainment(p_from date, p_to date)
returns table (user_id uuid, full_name text, target_type text, period_start date, period_end date, target_value numeric, actual numeric, pct numeric)
language sql stable set search_path = '' as $$
  select ut.user_id, p.full_name, ut.target_type, ut.period_start, ut.period_end, ut.target_value, a.actual,
         round(100.0 * a.actual / nullif(ut.target_value, 0), 1)
  from public.user_targets ut
  join public.profiles p on p.id = ut.user_id
  cross join lateral (select coalesce(app.metric_value(ut.user_id,
      case ut.target_type when 'qualified_leads' then 'qualified_leads' when 'outreach' then 'outreach' when 'meetings' then 'meetings'
                          when 'proposals' then 'proposals' when 'conversions' then 'conversions' when 'won_value' then 'won_value' else 'new_leads' end,
      ut.period_start::timestamp at time zone app.tz(), (ut.period_end + 1)::timestamp at time zone app.tz()), 0) as actual) a
  where ut.period_end >= p_from and ut.period_start <= p_to
  order by p.full_name, ut.target_type
$$;

create function public.dashboard_summary(p_from timestamptz default now() - interval '30 days',
                                         p_to timestamptz default now(), p_scope text default 'visible')
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_me uuid := app.me(); v_tz text := app.tz();
  v_t0 timestamptz := date_trunc('day', now() at time zone app.tz()) at time zone app.tz();
  v_t1 timestamptz; v_stale int := coalesce((app.setting('lead.stale_days') #>> '{}')::int, 14);
  v_mine boolean := (p_scope = 'mine');
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_scope not in ('visible','mine') then raise exception 'invalid scope' using errcode = '22023'; end if;
  v_t1 := v_t0 + interval '1 day';
  return (
    with l as (select * from public.leads where archived_at is null and (not v_mine or owner_id = v_me)),
    open_l as (select l.* from l where not exists (select 1 from public.pipeline_stages s where s.key = l.stage and (s.is_won or s.is_lost))),
    h as (select h.* from public.lead_stage_history h join l on l.id = h.lead_id where h.changed_at >= p_from and h.changed_at < p_to),
    t as (select * from public.tasks where status in ('todo','in_progress') and (not v_mine or assigned_to = v_me))
    select jsonb_build_object(
      'active_leads',   (select count(*) from open_l),
      'by_stage',       (select coalesce(jsonb_agg(jsonb_build_object('stage', s.key, 'label', s.label, 'count', x.c, 'value', x.v) order by s.position), '[]'::jsonb)
                          from public.pipeline_stages s
                          cross join lateral (select count(l.id) as c, coalesce(sum(l.estimated_value), 0) as v from l where l.stage = s.key) x
                          where s.is_active),
      'new_leads',      (select count(*) from l where created_at >= p_from and created_at < p_to),
      'qualified',      (select count(distinct lead_id) from h where to_stage = 'qualified'),
      'meetings_booked',(select count(distinct lead_id) from h where to_stage = 'meeting_scheduled'),
      'proposals_sent', (select count(*) from public.proposals p join l on l.id = p.lead_id where p.sent_at >= p_from and p.sent_at < p_to),
      'won',            (select count(*) from l where converted_at >= p_from and converted_at < p_to),
      'lost',           (select count(distinct h.lead_id) from h join l on l.id = h.lead_id where h.to_stage = 'lost' and l.stage = 'lost'),
      'pipeline_value', (select coalesce(sum(estimated_value), 0) from open_l),
      'won_value',      (select coalesce(sum(pr.agreed_value), 0) from l join public.clients c on c.source_lead_id = l.id
                          join public.projects pr on pr.client_id = c.id where l.converted_at >= p_from and l.converted_at < p_to),
      'follow_ups_today', (select count(*) from open_l where next_follow_up_at >= v_t0 and next_follow_up_at < v_t1),
      'overdue_follow_ups', (select count(*) from open_l where next_follow_up_at < v_t0),
      'stale_leads',    (select count(*) from open_l where coalesce(last_contacted_at, created_at) < now() - make_interval(days => v_stale)),
      'tasks_due_today',(select count(*) from t where due_at >= v_t0 and due_at < v_t1),
      'overdue_tasks',  (select count(*) from t where due_at < v_t0),
      'pending_approvals', (select count(*) from public.approval_requests a where a.status = 'pending'
                             and case when v_mine then a.requested_by = v_me else a.requested_by <> v_me end)
    ));
end $$;

create function public.my_action_items()
returns table (kind text, id uuid, title text, due_at timestamptz, is_overdue boolean, lead_id uuid)
language sql stable set search_path = '' as $$
  with b as (select (date_trunc('day', now() at time zone app.tz()) at time zone app.tz()) as t0)
  (select 'follow_up', l.id, l.company_name, l.next_follow_up_at, l.next_follow_up_at < b.t0, l.id
     from public.leads l, b where l.owner_id = app.me() and l.archived_at is null and l.next_follow_up_at < b.t0 + interval '1 day'
       and not exists (select 1 from public.pipeline_stages s where s.key = l.stage and (s.is_won or s.is_lost))
     order by l.next_follow_up_at limit 100)
  union all
  (select 'task', t.id, t.title, t.due_at, t.due_at < b.t0, t.lead_id
     from public.tasks t, b where t.assigned_to = app.me() and t.status in ('todo','in_progress') and t.due_at < b.t0 + interval '1 day'
     order by t.due_at limit 100)
$$;

do $$ declare f text; begin
  foreach f in array array[
    'public.report_by_employee(timestamptz,timestamptz)','public.report_by_team(timestamptz,timestamptz)',
    'public.report_lead_sources(timestamptz,timestamptz)','public.report_lost_reasons(timestamptz,timestamptz)',
    'public.report_monthly_growth(integer)','public.report_revenue(date,date)','public.target_attainment(date,date)',
    'public.dashboard_summary(timestamptz,timestamptz,text)','public.my_action_items()']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
