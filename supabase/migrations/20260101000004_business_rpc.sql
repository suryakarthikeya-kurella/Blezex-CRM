-- BlezeX Connect — 0004: transactional business operations (RPC).
-- Each function re-derives identity from the trusted profile (app.me()), authorises explicitly, locks the
-- rows it changes, and runs in a single transaction (a raised exception rolls everything back).

create function app.lead_writable(p_owner uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_admin() or p_owner = app.me() or app.mentors_user(p_owner)
$$;
grant execute on function app.lead_writable(uuid) to authenticated;

-- Transparent qualification criteria (weights sum to 100).
create function app.qualification_score(l public.leads) returns jsonb language sql immutable set search_path = '' as $$
  with c(k, w, ok) as (values
    ('contact_name',        15, coalesce(btrim(l.contact_name), '') <> ''),
    ('email_or_phone',      20, coalesce(btrim(l.email), '') <> '' or coalesce(btrim(l.phone), '') <> ''),
    ('website',             10, coalesce(btrim(l.website), '') <> ''),
    ('industry',            10, coalesce(btrim(l.industry), '') <> ''),
    ('decision_maker',      15, coalesce(btrim(l.decision_maker), '') <> ''),
    ('estimated_value',     10, coalesce(l.estimated_value, 0) > 0),
    ('lead_source',         10, l.lead_source_id is not null),
    ('qualification_notes', 10, coalesce(btrim(l.qualification_notes), '') <> ''))
  select jsonb_build_object(
    'score',   coalesce(sum(w) filter (where ok), 0),
    'missing', coalesce(jsonb_agg(k order by w desc) filter (where not ok), '[]'::jsonb))
  from c
$$;
grant execute on function app.qualification_score(public.leads) to authenticated;

create function public.lead_qualification(p_lead uuid) returns jsonb language sql stable set search_path = '' as $$
  select app.qualification_score(l) from public.leads l where l.id = p_lead   -- invoker: RLS applies
$$;

-- ───────── assignment ─────────
create function public.assign_lead(p_lead_id uuid, p_assignee uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.me(); v_lead public.leads; v_to public.profiles;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  select * into v_to from public.profiles where id = p_assignee and is_active;
  if not found then raise exception 'assignee not found or inactive' using errcode = 'P0002'; end if;

  if app.is_admin() then null;
  elsif app.is_mentor() then
    if not coalesce((app.setting('mentor.can_assign_leads') #>> '{}')::boolean, false) then
      raise exception 'lead assignment by mentors is disabled' using errcode = '42501'; end if;
    if not (app.mentors_user(v_lead.owner_id) and (p_assignee = v_me or app.mentors_user(p_assignee))) then
      raise exception 'mentors may only reassign within their own team' using errcode = '42501'; end if;
  else
    raise exception 'only admins and mentors can assign leads' using errcode = '42501';
  end if;

  if v_lead.owner_id is not distinct from p_assignee then return; end if;      -- idempotent

  update public.lead_assignments set unassigned_at = now() where lead_id = p_lead_id and unassigned_at is null;
  insert into public.lead_assignments (lead_id, assigned_to, assigned_by, reason) values (p_lead_id, p_assignee, v_me, p_reason);
  update public.leads set owner_id = p_assignee where id = p_lead_id;
  perform app.notify(p_assignee, 'lead_assigned', 'Lead assigned to you', v_lead.company_name, 'leads', p_lead_id::text);
  if v_lead.owner_id is not null and v_lead.owner_id <> v_me then
    perform app.notify(v_lead.owner_id, 'lead_reassigned', 'Lead reassigned', v_lead.company_name, 'leads', p_lead_id::text);
  end if;
end $$;

-- ───────── stage movement ─────────
create function public.move_lead_stage(p_lead_id uuid, p_to_stage text, p_note text default null,
                                       p_lost_reason_id uuid default null, p_expected_version integer default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.me(); v_lead public.leads; v_from public.pipeline_stages; v_to public.pipeline_stages;
  v_qual_pos int; v_min numeric := coalesce((app.setting('qualification.min_score') #>> '{}')::numeric, 60);
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found or not app.lead_writable(v_lead.owner_id) then
    raise exception 'lead not found' using errcode = 'P0002'; end if;                      -- do not reveal existence
  if v_lead.archived_at is not null then raise exception 'archived leads cannot change stage' using errcode = '23514'; end if;
  if p_expected_version is not null and p_expected_version <> v_lead.row_version then
    raise exception 'lead was modified by someone else; reload and retry' using errcode = '40001'; end if;

  select * into v_from from public.pipeline_stages where key = v_lead.stage;
  select * into v_to from public.pipeline_stages where key = p_to_stage and is_active;
  if not found then raise exception 'unknown or inactive stage' using errcode = '23514'; end if;
  if v_to.key = v_from.key then return v_lead.row_version; end if;                         -- idempotent
  if v_to.is_won then raise exception 'use the conversion workflow to mark a lead as Won' using errcode = '23514'; end if;
  if v_from.is_won then raise exception 'converted leads cannot be moved' using errcode = '23514'; end if;
  if v_from.is_lost and not (app.is_admin() or app.is_mentor()) then
    raise exception 'only a mentor or admin can reopen a lost lead' using errcode = '42501'; end if;
  if v_to.is_lost and not exists (select 1 from public.lost_reasons where id = p_lost_reason_id and is_active) then
    raise exception 'a lost reason is required' using errcode = '23514'; end if;

  select position into v_qual_pos from public.pipeline_stages where key = 'qualified';
  if v_qual_pos is not null and v_to.position >= v_qual_pos and not v_to.is_lost and v_to.key <> 'nurture'
     and (app.qualification_score(v_lead) ->> 'score')::numeric < v_min then
    raise exception 'qualification incomplete (score % of % required): missing %',
      app.qualification_score(v_lead) ->> 'score', v_min, app.qualification_score(v_lead) -> 'missing' using errcode = '23514';
  end if;

  update public.leads set stage = v_to.key,
         lost_reason_id = case when v_to.is_lost then p_lost_reason_id end,
         lost_reason_note = case when v_to.is_lost then p_note end
   where id = p_lead_id returning * into v_lead;
  insert into public.lead_stage_history (lead_id, from_stage, to_stage, actor_id, note)
  values (p_lead_id, v_from.key, v_to.key, v_me, p_note);
  insert into public.activities (lead_id, user_id, activity_type, subject, description)
  values (p_lead_id, v_me, 'stage_change', v_from.label || ' → ' || v_to.label, p_note);
  if v_lead.owner_id is not null and v_lead.owner_id <> v_me then
    perform app.notify(v_lead.owner_id, 'stage_changed', 'Stage changed to ' || v_to.label, v_lead.company_name, 'leads', p_lead_id::text);
  end if;
  return v_lead.row_version;
end $$;

-- ───────── atomic, idempotent Won conversion ─────────
create function public.convert_lead_to_client(
  p_lead_id uuid, p_agreed_value numeric default null, p_project_name text default null, p_service_id uuid default null,
  p_scope text default null, p_payment_terms text default null, p_commitments text default null,
  p_next_action text default null, p_start_date date default null, p_target_end_date date default null,
  p_proposal_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.me(); v_lead public.leads; v_won public.pipeline_stages; v_client public.clients; v_project public.projects;
  v_value numeric; v_service uuid; v_service_name text; v_prev_stage text;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into v_lead from public.leads where id = p_lead_id for update;           -- serialises concurrent conversions
  if not found or not app.lead_writable(v_lead.owner_id) then
    raise exception 'lead not found' using errcode = 'P0002'; end if;

  if v_lead.converted_client_id is not null then                                    -- idempotent replay
    select * into v_client from public.clients where id = v_lead.converted_client_id;
    select * into v_project from public.projects where client_id = v_client.id order by created_at limit 1;
    return jsonb_build_object('already_converted', true, 'client_id', v_client.id, 'client_number', v_client.client_number,
                              'project_id', v_project.id, 'project_number', v_project.project_number);
  end if;

  if v_lead.archived_at is not null then raise exception 'archived leads cannot be converted' using errcode = '23514'; end if;
  if (select is_lost from public.pipeline_stages where key = v_lead.stage) then
    raise exception 'reopen the lost lead before converting it' using errcode = '23514'; end if;
  if coalesce(btrim(v_lead.contact_name), '') = '' then raise exception 'contact name is required to convert' using errcode = '23514'; end if;
  if coalesce(btrim(v_lead.email), '') = '' and coalesce(btrim(v_lead.phone), '') = '' then
    raise exception 'an email or phone is required to convert' using errcode = '23514'; end if;
  v_value := coalesce(p_agreed_value, v_lead.estimated_value);
  if v_value is null or v_value <= 0 then raise exception 'an agreed deal value greater than zero is required' using errcode = '23514'; end if;
  v_service := coalesce(p_service_id, v_lead.service_id);
  if v_service is null then raise exception 'a service is required to convert' using errcode = '23514'; end if;
  select name into v_service_name from public.services where id = v_service;
  select * into v_won from public.pipeline_stages where is_won and is_active;
  if not found then raise exception 'no active Won stage is configured' using errcode = '23514'; end if;
  if p_proposal_id is not null and not exists (select 1 from public.proposals where id = p_proposal_id and lead_id = p_lead_id) then
    raise exception 'proposal does not belong to this lead' using errcode = '23514'; end if;

  v_prev_stage := v_lead.stage;
  insert into public.clients (company_name, contact_name, email, phone, website, source_lead_id, relationship_owner_id, status)
  values (v_lead.company_name, v_lead.contact_name, v_lead.email, v_lead.phone, v_lead.website, v_lead.id,
          coalesce(v_lead.owner_id, v_me), 'onboarding') returning * into v_client;
  insert into public.projects (client_id, project_name, service_id, service_type, scope, agreed_value, currency, status,
                               start_date, target_end_date, payment_terms, commitments, next_action, proposal_id, created_by)
  values (v_client.id, coalesce(nullif(btrim(p_project_name), ''), v_lead.company_name || ' — ' || v_service_name), v_service,
          v_service_name, p_scope, v_value, v_lead.currency, 'onboarding', p_start_date, p_target_end_date,
          p_payment_terms, p_commitments, p_next_action, p_proposal_id, v_me) returning * into v_project;
  if p_proposal_id is not null then update public.proposals set status = 'accepted' where id = p_proposal_id; end if;

  update public.leads set stage = v_won.key, converted_client_id = v_client.id, converted_at = now(), probability = 100,
         lost_reason_id = null where id = p_lead_id;
  insert into public.lead_stage_history (lead_id, from_stage, to_stage, actor_id, note)
  values (p_lead_id, v_prev_stage, v_won.key, v_me, 'Converted to client ' || v_client.client_number);
  insert into public.activities (lead_id, client_id, user_id, activity_type, subject, description)
  values (p_lead_id, v_client.id, v_me, 'conversion', 'Won — converted to ' || v_client.client_number, 'Project ' || v_project.project_number);

  perform app.notify(p.id, 'lead_won', 'Lead won: ' || v_lead.company_name, v_client.client_number, 'clients', v_client.id::text)
  from public.profiles p where p.is_active and p.role = 'admin' and p.id <> v_me;
  return jsonb_build_object('already_converted', false, 'client_id', v_client.id, 'client_number', v_client.client_number,
                            'project_id', v_project.id, 'project_number', v_project.project_number);
end $$;

-- Structured handover (invoker: RLS decides who may see the client/project/proposal).
create function public.client_handover(p_client_id uuid) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'client', jsonb_build_object('client_number', c.client_number, 'company_name', c.company_name, 'contact_name', c.contact_name,
                                 'email', c.email, 'phone', c.phone, 'website', c.website, 'status', c.status),
    'relationship_owner', (select d.full_name from public.user_directory d where d.id = c.relationship_owner_id),
    'projects', coalesce((select jsonb_agg(jsonb_build_object(
        'project_number', p.project_number, 'name', p.project_name, 'service', p.service_type, 'scope', p.scope,
        'deal_value', p.agreed_value, 'currency', p.currency, 'payment_terms', p.payment_terms,
        'commitments', p.commitments, 'status', p.status, 'next_action', p.next_action,
        'start_date', p.start_date, 'target_end_date', p.target_end_date,
        'proposal', (select jsonb_build_object('proposal_number', pp.proposal_number, 'version', pp.version, 'amount', pp.amount, 'status', pp.status)
                     from public.proposals pp where pp.id = p.proposal_id)) order by p.created_at)
      from public.projects p where p.client_id = c.id), '[]'::jsonb))
  from public.clients c where c.id = p_client_id
$$;

-- ───────── archive / restore ─────────
create function public.archive_lead(p_lead_id uuid, p_restore boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.leads where id = p_lead_id for update;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not (app.is_admin() or app.mentors_user(v_owner)) then
    raise exception 'only admins and the owner''s mentor can archive leads' using errcode = '42501'; end if;
  update public.leads set archived_at = case when p_restore then null else coalesce(archived_at, now()) end where id = p_lead_id;
end $$;

-- ───────── user administration (profile role/activation) ─────────
create function public.admin_update_profile(p_user uuid, p_role text default null, p_is_active boolean default null,
                                            p_full_name text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_role is not null and p_role not in ('admin','mentor','bds_employee') then raise exception 'invalid role' using errcode = '23514'; end if;
  if p_user = app.me() and (p_role is not null or p_is_active is not null) then
    raise exception 'admins cannot change their own role or activation' using errcode = '42501'; end if;
  update public.profiles set role = coalesce(p_role, role), is_active = coalesce(p_is_active, is_active),
         full_name = coalesce(nullif(btrim(p_full_name), ''), full_name) where id = p_user;
  if not found then raise exception 'user not found' using errcode = 'P0002'; end if;
end $$;

-- ───────── approvals ─────────
create function public.decide_approval(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.me(); r public.approval_requests;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into r from public.approval_requests where id = p_id for update;
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'request already %', r.status using errcode = '23514'; end if;
  if not (app.is_admin() or (app.mentors_user(r.requested_by) and r.request_type in ('mentor_support','escalation'))) then
    raise exception 'not authorized to decide this request' using errcode = '42501'; end if;
  update public.approval_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_me, decided_at = now(), decision_note = p_note where id = p_id;
  if p_approve and r.request_type = 'deletion' and r.entity_type = 'leads' and app.is_admin() then
    update public.leads set archived_at = coalesce(archived_at, now()) where id = r.entity_id::uuid;   -- soft delete only
  end if;
  perform app.notify(r.requested_by, 'approval_decided', 'Your request was ' || case when p_approve then 'approved' else 'rejected' end,
                     p_note, 'approval_requests', p_id::text);
end $$;

-- ───────── duplicate detection (reveals only number/company/owner name — no contact details) ─────────
create function public.find_duplicate_leads(p_email text default null, p_phone text default null, p_company text default null,
                                            p_website text default null, p_exclude uuid default null)
returns table (lead_number text, company_name text, owner_name text, match_reason text)
language sql stable security definer set search_path = '' as $$
  with q as (select
      nullif(lower(btrim(p_email)), '') as email,
      nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '') as phone,
      nullif(lower(btrim(p_company)), '') as company,
      nullif(regexp_replace(lower(coalesce(p_website, '')), '^(https?://)?(www\.)?|/.*$', '', 'g'), '') as site)
  select l.lead_number, l.company_name, (select d.full_name from public.user_directory d where d.id = l.owner_id),
         case when q.email is not null and lower(l.email) = q.email then 'same email'
              when q.phone is not null and length(q.phone) >= 7 and regexp_replace(coalesce(l.phone, ''), '\D', '', 'g') = q.phone then 'same phone'
              when q.site is not null and regexp_replace(lower(coalesce(l.website, '')), '^(https?://)?(www\.)?|/.*$', '', 'g') = q.site then 'same website'
              else 'similar company name' end
  from public.leads l, q
  where app.me() is not null and l.archived_at is null and l.id is distinct from p_exclude and (
        (q.email is not null and lower(l.email) = q.email)
     or (q.phone is not null and length(q.phone) >= 7 and regexp_replace(coalesce(l.phone, ''), '\D', '', 'g') = q.phone)
     or (q.site is not null and regexp_replace(lower(coalesce(l.website, '')), '^(https?://)?(www\.)?|/.*$', '', 'g') = q.site)
     or (q.company is not null and (lower(l.company_name) = q.company or extensions.similarity(lower(l.company_name), q.company) > 0.8)))
  limit 5
$$;

do $$ declare f text; begin
  foreach f in array array[
    'public.lead_qualification(uuid)','public.assign_lead(uuid,uuid,text)',
    'public.move_lead_stage(uuid,text,text,uuid,integer)',
    'public.convert_lead_to_client(uuid,numeric,text,uuid,text,text,text,text,date,date,uuid)',
    'public.client_handover(uuid)','public.archive_lead(uuid,boolean)',
    'public.admin_update_profile(uuid,text,boolean,text)','public.decide_approval(uuid,boolean,text)',
    'public.find_duplicate_leads(text,text,text,text,uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
