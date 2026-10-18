-- BlezeX Connect — 0001: core schema (tables, constraints, indexes, reference data)
-- Conventions: uuid PKs, timestamptz, numeric money, text+CHECK for fixed vocabularies,
-- FK-backed tables for admin-configurable vocabularies (stages, sources, services, lost reasons).

create schema if not exists app;
create extension if not exists pg_trgm with schema extensions;

-- Never leave default privileges that hand new objects to API roles.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema app revoke execute on functions from public, anon;

-- ───────── identity & organisation ─────────
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  email       text not null,
  role        text not null default 'bds_employee' check (role in ('admin','mentor','bds_employee')),
  is_active   boolean not null default false,   -- provisioned inactive; an admin activates
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));
create index profiles_role_idx on public.profiles (role) where is_active;

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(btrim(name)) > 0),
  description text,
  status      text not null default 'active' check (status in ('active','archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.team_memberships (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  membership_role text not null default 'member' check (membership_role in ('mentor','member')),
  is_active       boolean not null default true,
  joined_at       timestamptz not null default now(),
  ended_at        timestamptz,
  check (is_active or ended_at is not null)
);
create unique index team_memberships_active_key on public.team_memberships (team_id, user_id) where is_active;
create index team_memberships_user_idx on public.team_memberships (user_id) where is_active;
create index team_memberships_team_idx on public.team_memberships (team_id) where is_active;

create table public.user_targets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  target_type  text not null check (target_type in
    ('new_leads','qualified_leads','outreach','meetings','proposals','conversions','won_value')),
  target_value numeric(14,2) not null check (target_value >= 0),
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (period_end >= period_start),
  unique (user_id, target_type, period_start, period_end)
);

-- ───────── configurable vocabularies ─────────
create table public.pipeline_stages (
  key        text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  label      text not null,
  position   int  not null,
  is_won     boolean not null default false,
  is_lost    boolean not null default false,
  is_active  boolean not null default true,
  check (not (is_won and is_lost))
);
create unique index pipeline_stages_one_won on public.pipeline_stages (is_won) where is_won;
create unique index pipeline_stages_one_lost on public.pipeline_stages (is_lost) where is_lost;

create table public.lost_reasons (
  id uuid primary key default gen_random_uuid(),
  label text not null unique, is_active boolean not null default true, position int not null default 0
);
create table public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, is_active boolean not null default true, position int not null default 0
);
create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, is_active boolean not null default true, position int not null default 0
);

create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now()
);

-- ───────── sales pipeline ─────────
create table public.leads (
  id                   uuid primary key default gen_random_uuid(),
  lead_number          text not null unique,
  legacy_id            text unique,                         -- Google Sheets "Lead ID"
  request_id           uuid,                                -- client idempotency token
  company_name         text not null check (length(btrim(company_name)) > 0),
  contact_name         text,
  email                text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone                text,
  website              text,
  industry             text,
  company_size         text,
  lead_source_id       uuid references public.lead_sources(id),
  lead_source_details  text,
  service_id           uuid references public.services(id),
  stage                text not null default 'new' references public.pipeline_stages(key),
  priority             text not null default 'medium' check (priority in ('low','medium','high')),
  estimated_value      numeric(14,2) check (estimated_value is null or estimated_value >= 0),
  currency             char(3) not null default 'INR',
  probability          smallint check (probability between 0 and 100),
  expected_close_date  date,
  owner_id             uuid references public.profiles(id),
  created_by           uuid references public.profiles(id),
  next_follow_up_at    timestamptz,
  last_contacted_at    timestamptz,
  qualification_notes  text,
  decision_maker       text,
  notes                text,
  lost_reason_id       uuid references public.lost_reasons(id),
  lost_reason_note     text,
  converted_client_id  uuid,                                -- FK added after clients
  converted_at         timestamptz,
  archived_at          timestamptz,
  row_version          integer not null default 1,          -- optimistic concurrency
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint leads_lost_needs_reason check (stage <> 'lost' or lost_reason_id is not null),
  constraint leads_won_needs_client  check (stage <> 'won'  or converted_client_id is not null)
);
create unique index leads_request_key on public.leads (created_by, request_id) where request_id is not null;
create index leads_owner_stage_idx   on public.leads (owner_id, stage) where archived_at is null;
create index leads_stage_idx         on public.leads (stage) where archived_at is null;
create index leads_follow_up_idx     on public.leads (next_follow_up_at) where archived_at is null and next_follow_up_at is not null;
create index leads_created_idx       on public.leads (created_at desc);
create index leads_source_idx        on public.leads (lead_source_id);
create index leads_email_norm_idx    on public.leads (lower(email)) where email is not null;
create index leads_phone_idx         on public.leads (regexp_replace(phone, '\D', '', 'g')) where phone is not null;
create index leads_company_trgm_idx  on public.leads using gin (company_name extensions.gin_trgm_ops);

create table public.lead_assignments (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  assigned_to   uuid not null references public.profiles(id),
  assigned_by   uuid references public.profiles(id),
  assigned_at   timestamptz not null default now(),
  unassigned_at timestamptz,
  reason        text
);
create unique index lead_assignments_open_key on public.lead_assignments (lead_id) where unassigned_at is null;
create index lead_assignments_user_idx on public.lead_assignments (assigned_to);

create table public.lead_stage_history (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  from_stage text references public.pipeline_stages(key),
  to_stage   text not null references public.pipeline_stages(key),
  actor_id   uuid references public.profiles(id),
  changed_at timestamptz not null default now(),
  note       text
);
create index lead_stage_history_lead_idx on public.lead_stage_history (lead_id, changed_at desc);

-- ───────── clients, projects, proposals, billing ─────────
create table public.clients (
  id                    uuid primary key default gen_random_uuid(),
  client_number         text not null unique,
  legacy_id             text unique,
  company_name          text not null check (length(btrim(company_name)) > 0),
  contact_name          text, email text, phone text, website text,
  source_lead_id        uuid unique references public.leads(id) on delete restrict,  -- one client per lead
  relationship_owner_id uuid references public.profiles(id),
  status                text not null default 'active' check (status in ('onboarding','active','paused','churned')),
  notes                 text,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index clients_owner_idx on public.clients (relationship_owner_id);
alter table public.leads add constraint leads_converted_client_fk
  foreign key (converted_client_id) references public.clients(id) on delete restrict;
create unique index leads_converted_client_key on public.leads (converted_client_id) where converted_client_id is not null;

create table public.proposals (
  id              uuid primary key default gen_random_uuid(),
  proposal_number text not null unique,
  lead_id         uuid references public.leads(id) on delete cascade,
  client_id       uuid references public.clients(id) on delete cascade,
  version         integer not null default 1 check (version >= 1),
  title           text not null,
  amount          numeric(14,2) not null check (amount >= 0),
  currency        char(3) not null default 'INR',
  status          text not null default 'draft' check (status in ('draft','sent','accepted','rejected','expired','superseded')),
  sent_at         timestamptz,
  followup_due_at timestamptz,
  valid_until     date,
  notes           text,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (lead_id is not null or client_id is not null),
  check (status <> 'sent' or sent_at is not null)
);
create unique index proposals_version_key on public.proposals (lead_id, version) where lead_id is not null;
create index proposals_lead_idx on public.proposals (lead_id);

create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  project_number text not null unique,
  legacy_id     text unique,
  client_id     uuid not null references public.clients(id) on delete restrict,
  project_name  text not null,
  service_id    uuid references public.services(id),
  service_type  text,                       -- snapshot label (survives service renames)
  scope         text,
  agreed_value  numeric(14,2) not null default 0 check (agreed_value >= 0),
  currency      char(3) not null default 'INR',
  status        text not null default 'onboarding'
                check (status in ('onboarding','in_progress','waiting_for_client','completed','maintenance','renewal_due')),
  start_date    date, target_end_date date, completed_at timestamptz,
  payment_terms text, commitments text, next_action text,
  proposal_id   uuid references public.proposals(id),
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (target_end_date is null or start_date is null or target_end_date >= start_date)
);
create index projects_client_idx on public.projects (client_id);

create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  client_id      uuid not null references public.clients(id) on delete restrict,
  project_id     uuid references public.projects(id) on delete restrict,
  issue_date     date not null default current_date,
  due_date       date not null,
  total          numeric(14,2) not null check (total > 0),
  currency       char(3) not null default 'INR',
  status         text not null default 'draft'
                 check (status in ('draft','issued','partially_paid','paid','cancelled')),
  notes          text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (due_date >= issue_date)
);
create index invoices_client_idx on public.invoices (client_id);
create index invoices_due_idx on public.invoices (due_date) where status in ('issued','partially_paid');

create table public.payments (
  id                    uuid primary key default gen_random_uuid(),
  invoice_id            uuid not null references public.invoices(id) on delete restrict,
  kind                  text not null default 'payment' check (kind in ('payment','refund')),
  amount                numeric(14,2) not null check (amount > 0),
  paid_at               date not null default current_date,
  method                text not null check (method in ('bank_transfer','upi','cash','cheque','gateway','other')),
  transaction_reference text,                -- reference only; NEVER card numbers or credentials
  status                text not null default 'completed' check (status in ('pending','completed','failed','cancelled')),
  request_id            uuid,
  notes                 text,
  recorded_by           uuid references public.profiles(id),
  created_at            timestamptz not null default now()
);
create unique index payments_txn_ref_key on public.payments (lower(transaction_reference))
  where transaction_reference is not null and kind = 'payment' and status in ('pending','completed');
create unique index payments_request_key on public.payments (recorded_by, request_id) where request_id is not null;
create index payments_invoice_idx on public.payments (invoice_id);

-- ───────── activities & tasks ─────────
create table public.activities (
  id               uuid primary key default gen_random_uuid(),
  legacy_id        text unique,
  request_id       uuid,
  lead_id          uuid references public.leads(id) on delete cascade,
  client_id        uuid references public.clients(id) on delete cascade,
  user_id          uuid not null references public.profiles(id),
  activity_type    text not null check (activity_type in
    ('call','email','whatsapp','meeting','demo','proposal','follow_up','client_review','note','stage_change','conversion','coaching','other')),
  subject          text,
  description      text,
  outcome          text,
  next_action      text,
  next_follow_up_at timestamptz,
  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  check (lead_id is not null or client_id is not null)
);
create unique index activities_request_key on public.activities (user_id, request_id) where request_id is not null;
create index activities_lead_idx on public.activities (lead_id, occurred_at desc);
create index activities_user_idx on public.activities (user_id, occurred_at desc);
create index activities_client_idx on public.activities (client_id);

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  legacy_id    text unique,
  request_id   uuid,
  title        text not null check (length(btrim(title)) > 0),
  description  text,
  status       text not null default 'todo' check (status in ('todo','in_progress','completed','cancelled')),
  priority     text not null default 'medium' check (priority in ('low','medium','high')),
  assigned_to  uuid not null references public.profiles(id),
  created_by   uuid references public.profiles(id),
  lead_id      uuid references public.leads(id) on delete cascade,
  client_id    uuid references public.clients(id) on delete cascade,
  due_at       timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check ((status = 'completed') = (completed_at is not null))
);
create unique index tasks_request_key on public.tasks (created_by, request_id) where request_id is not null;
create index tasks_assignee_idx on public.tasks (assigned_to, status, due_at);
create index tasks_lead_idx on public.tasks (lead_id);

create table public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  author_id  uuid not null references public.profiles(id),
  content    text not null check (length(btrim(content)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);

create table public.daily_reports (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id),
  report_date        date not null,
  summary            text,
  leads_created      integer not null default 0,   -- derived by trigger from source rows
  outreach_completed integer not null default 0,   -- derived
  meetings_booked    integer not null default 0,   -- derived
  proposals_sent     integer not null default 0,   -- derived
  wins               text, blockers text, next_day_plan text,
  submitted_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, report_date)
);

create table public.coaching_notes (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  mentor_id   uuid not null references public.profiles(id),
  lead_id     uuid references public.leads(id) on delete set null,
  note        text not null check (length(btrim(note)) > 0),
  created_at  timestamptz not null default now()
);
create index coaching_notes_employee_idx on public.coaching_notes (employee_id, created_at desc);

-- ───────── notifications, governance ─────────
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type         text not null,
  title        text not null,
  message      text,
  entity_type  text, entity_id text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id) where read_at is null;

create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,                         -- no FK: audit rows must outlive users
  action      text not null,
  entity_type text not null,
  entity_id   text,
  before_data jsonb,
  after_data  jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx  on public.audit_logs (actor_id, created_at desc);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create table public.approval_requests (
  id            uuid primary key default gen_random_uuid(),
  request_type  text not null check (request_type in
    ('mentor_support','escalation','discount_exception','deletion','restricted_change')),
  entity_type   text, entity_id text,
  payload       jsonb not null default '{}'::jsonb,
  reason        text,
  status        text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_by  uuid not null references public.profiles(id),
  decided_by    uuid references public.profiles(id),
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now()
);
create index approval_requests_status_idx on public.approval_requests (status, created_at desc);

create table public.import_jobs (
  id          uuid primary key default gen_random_uuid(),
  source      text not null, entity text not null,
  status      text not null default 'pending' check (status in ('pending','running','completed','failed')),
  dry_run     boolean not null default true,
  total_rows  integer not null default 0, imported integer not null default 0,
  skipped     integer not null default 0, failed integer not null default 0,
  errors      jsonb not null default '[]'::jsonb,
  summary     jsonb not null default '{}'::jsonb,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(), finished_at timestamptz
);

create table public.saved_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null, name text not null, filters jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, scope, name)
);

-- ───────── identifier sequences (concurrency-safe business numbers) ─────────
create sequence app.lead_seq;     create sequence app.client_seq;
create sequence app.project_seq;  create sequence app.proposal_seq;
create sequence app.invoice_seq;

-- ───────── default configuration (not test data) ─────────
insert into public.pipeline_stages (key,label,position,is_won,is_lost) values
 ('new','New',10,false,false),('researching','Researching',20,false,false),
 ('qualified','Qualified',30,false,false),('contacted','Contacted',40,false,false),
 ('interested','Interested',50,false,false),('meeting_scheduled','Meeting Scheduled',60,false,false),
 ('proposal_sent','Proposal Sent',70,false,false),('negotiation','Negotiation',80,false,false),
 ('won','Won',90,true,false),('lost','Lost',100,false,true),('nurture','Nurture',110,false,false);
insert into public.lost_reasons (label, position) values
 ('Budget constraints',10),('No response',20),('Chose a competitor',30),('Not a fit',40),('Bad timing',50),('Other',60);
insert into public.lead_sources (name, position) values
 ('Website',10),('Referral',20),('LinkedIn',30),('Cold Call',40),('Email Campaign',50),('Social Media',60),('Event',70),('Other',80);
insert into public.services (name, position)
select s, (row_number() over ())::int * 10 from unnest(array[
 'IT Solutions','Custom Software Development','Web Application Development','SaaS Development','AI Solutions',
 'Automation Solutions','CRM Development','Mobile App Development','Business Websites','Cloud Solutions','Graphic Design',
 'Logo Design','Brand Identity','Social Media Creatives','Brochures','Marketing Materials','Presentations','Digital Marketing',
 'SEO','Social Media Marketing','Lead Generation','Performance Marketing','Email Marketing','Content Creation','Website Content',
 'Social Media Content','Blog Writing','Marketing Content','Video Content Planning']) as s;
insert into public.app_settings (key, value, description) values
 ('company',                  '{"name":"BlezeX Technologies","currency":"INR","locale":"en-IN","timezone":"Asia/Kolkata"}', 'Company preferences'),
 ('followup.intervals_days',  '[1,3,7,14,21]', 'Suggested follow-up intervals (defaults, not mandatory)'),
 ('proposal.followup_hours',  '24', 'Target hours to follow up after a proposal is sent'),
 ('mentor.can_assign_leads',  'true', 'Allow mentors to reassign leads within their own team'),
 ('lead.stale_days',          '14', 'Days without contact before an open lead is flagged stale'),
 ('qualification.min_score',  '60', 'Minimum qualification completeness (0-100) to reach Qualified');
