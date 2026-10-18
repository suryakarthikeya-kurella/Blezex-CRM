-- BlezeX Connect — 0003: grants and Row Level Security.
-- Defence in depth: (1) table/column GRANTs remove whole capabilities (e.g. nobody but trusted functions can
-- change leads.owner_id/stage or touch audit_logs); (2) RLS policies scope every remaining row.
-- anon gets NOTHING on the CRM. Policies use app.me() which is NULL for deactivated users, so a deactivated
-- account loses access immediately even while its JWT is still valid.

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon;

grant usage on schema app to authenticated;
grant execute on function app.me(), app.my_role(), app.is_admin(), app.is_mentor(), app.mentors_user(uuid),
  app.can_see_user(uuid), app.can_access_lead(uuid), app.can_access_client(uuid), app.can_access_task(uuid),
  app.setting(text) to authenticated;

-- ───────── enable RLS everywhere ─────────
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ───────── grants ─────────
grant select on public.profiles, public.teams, public.team_memberships, public.user_targets,
  public.pipeline_stages, public.lost_reasons, public.lead_sources, public.services, public.app_settings,
  public.leads, public.lead_assignments, public.lead_stage_history, public.clients, public.projects,
  public.proposals, public.invoices, public.payments, public.activities, public.tasks, public.task_comments,
  public.daily_reports, public.coaching_notes, public.notifications, public.audit_logs,
  public.approval_requests, public.import_jobs, public.saved_filters to authenticated;

grant update (full_name) on public.profiles to authenticated;                    -- role/is_active/email: NOT grantable
grant insert, update, delete on public.teams, public.team_memberships, public.user_targets,
  public.pipeline_stages, public.lost_reasons, public.lead_sources, public.services, public.app_settings,
  public.import_jobs to authenticated;                                          -- all admin-only via policy

grant insert (request_id, company_name, contact_name, email, phone, website, industry, company_size,
  lead_source_id, lead_source_details, service_id, priority, estimated_value, currency, probability,
  expected_close_date, owner_id, next_follow_up_at, qualification_notes, decision_maker, notes)
  on public.leads to authenticated;
grant update (company_name, contact_name, email, phone, website, industry, company_size, lead_source_id,
  lead_source_details, service_id, priority, estimated_value, currency, probability, expected_close_date,
  next_follow_up_at, last_contacted_at, qualification_notes, decision_maker, notes)
  on public.leads to authenticated;                                             -- no owner_id / stage / converted_* / archived_at
grant delete on public.leads to authenticated;                                  -- admin-only via policy

grant insert, update, delete on public.clients, public.projects to authenticated;       -- admin-only via policy
grant insert (lead_id, client_id, title, amount, currency, status, sent_at, valid_until, notes, version, created_by)
  on public.proposals to authenticated;
grant update (title, amount, currency, status, sent_at, valid_until, notes) on public.proposals to authenticated;
grant delete on public.proposals to authenticated;

grant insert, update on public.invoices to authenticated;                       -- admin-only via policy
grant delete on public.invoices to authenticated;                               -- admin, draft only
grant insert (invoice_id, kind, amount, paid_at, method, transaction_reference, status, request_id, notes) on public.payments to authenticated;
grant update (status, notes) on public.payments to authenticated;               -- admin-only; amounts immutable, no DELETE

grant insert (request_id, lead_id, client_id, user_id, activity_type, subject, description, outcome,
  next_action, next_follow_up_at, occurred_at) on public.activities to authenticated;
grant delete on public.activities to authenticated;                             -- admin-only via policy

grant insert (request_id, title, description, status, priority, assigned_to, lead_id, client_id, due_at) on public.tasks to authenticated;
grant update (title, description, status, priority, assigned_to, due_at) on public.tasks to authenticated;
grant delete on public.tasks to authenticated;
grant insert (task_id, author_id, content) on public.task_comments to authenticated;
grant delete on public.task_comments to authenticated;                          -- admin-only

grant insert (user_id, report_date, summary, wins, blockers, next_day_plan) on public.daily_reports to authenticated;
grant update (summary, wins, blockers, next_day_plan) on public.daily_reports to authenticated;
grant insert (employee_id, mentor_id, lead_id, note) on public.coaching_notes to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant insert (request_type, entity_type, entity_id, payload, reason, requested_by) on public.approval_requests to authenticated;
grant update (status) on public.approval_requests to authenticated;            -- requester may only cancel (policy)
grant insert, update, delete on public.saved_filters to authenticated;
-- audit_logs / lead_assignments / lead_stage_history: SELECT only. Writers are trusted functions.

-- ───────── policies ─────────
-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select app.me()) or (select app.is_admin()) or app.mentors_user(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select app.me())) with check (id = (select app.me()));

-- teams & memberships & targets
create policy teams_select on public.teams for select to authenticated
  using ((select app.is_admin()) or id in (select team_id from public.team_memberships where user_id = (select app.me()) and is_active));
create policy teams_insert on public.teams for insert to authenticated with check ((select app.is_admin()));
create policy teams_update on public.teams for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy teams_delete on public.teams for delete to authenticated using ((select app.is_admin()));

create policy memberships_select on public.team_memberships for select to authenticated
  using (user_id = (select app.me()) or (select app.is_admin()) or app.mentors_user(user_id));
create policy memberships_insert on public.team_memberships for insert to authenticated with check ((select app.is_admin()));
create policy memberships_update on public.team_memberships for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy memberships_delete on public.team_memberships for delete to authenticated using ((select app.is_admin()));

create policy targets_select on public.user_targets for select to authenticated
  using (user_id = (select app.me()) or (select app.is_admin()) or app.mentors_user(user_id));
create policy targets_insert on public.user_targets for insert to authenticated with check ((select app.is_admin()));
create policy targets_update on public.user_targets for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy targets_delete on public.user_targets for delete to authenticated using ((select app.is_admin()));

-- configuration vocabularies: everyone active reads; only admin writes
do $$ declare t text; begin
  foreach t in array array['pipeline_stages','lost_reasons','lead_sources','services','app_settings'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using ((select app.me()) is not null)', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check ((select app.is_admin()))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using ((select app.is_admin()))', t);
  end loop;
end $$;

-- leads
create policy leads_select on public.leads for select to authenticated
  using ((select app.is_admin()) or owner_id = (select app.me()) or app.mentors_user(owner_id));
create policy leads_insert on public.leads for insert to authenticated
  with check ((select app.me()) is not null and ((select app.is_admin()) or owner_id = (select app.me()) or app.mentors_user(owner_id)));
create policy leads_update on public.leads for update to authenticated
  using ((select app.is_admin()) or owner_id = (select app.me()) or app.mentors_user(owner_id))
  with check ((select app.is_admin()) or owner_id = (select app.me()) or app.mentors_user(owner_id));
create policy leads_delete on public.leads for delete to authenticated using ((select app.is_admin()));

create policy lead_assignments_select on public.lead_assignments for select to authenticated using (app.can_access_lead(lead_id));
create policy lead_stage_history_select on public.lead_stage_history for select to authenticated using (app.can_access_lead(lead_id));

-- clients / projects: scoped read, admin write
create policy clients_select on public.clients for select to authenticated using (app.can_access_client(id));
create policy clients_insert on public.clients for insert to authenticated with check ((select app.is_admin()));
create policy clients_update on public.clients for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy clients_delete on public.clients for delete to authenticated using ((select app.is_admin()));
create policy projects_select on public.projects for select to authenticated using (app.can_access_client(client_id));
create policy projects_insert on public.projects for insert to authenticated with check ((select app.is_admin()));
create policy projects_update on public.projects for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy projects_delete on public.projects for delete to authenticated using ((select app.is_admin()));

-- proposals follow lead/client access
create policy proposals_select on public.proposals for select to authenticated
  using ((lead_id is not null and app.can_access_lead(lead_id)) or (client_id is not null and app.can_access_client(client_id)));
create policy proposals_insert on public.proposals for insert to authenticated
  with check ((created_by is null or created_by = (select app.me())) and
    ((lead_id is not null and app.can_access_lead(lead_id)) or (client_id is not null and app.can_access_client(client_id))));
create policy proposals_update on public.proposals for update to authenticated
  using ((lead_id is not null and app.can_access_lead(lead_id)) or (client_id is not null and app.can_access_client(client_id)))
  with check ((lead_id is not null and app.can_access_lead(lead_id)) or (client_id is not null and app.can_access_client(client_id)));
create policy proposals_delete on public.proposals for delete to authenticated using ((select app.is_admin()));

-- invoices / payments: ADMIN ONLY (mentors/employees see nothing). Payments are never deleted.
create policy invoices_select on public.invoices for select to authenticated using ((select app.is_admin()));
create policy invoices_insert on public.invoices for insert to authenticated with check ((select app.is_admin()));
create policy invoices_update on public.invoices for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy invoices_delete on public.invoices for delete to authenticated using ((select app.is_admin()) and status = 'draft');
create policy payments_select on public.payments for select to authenticated using ((select app.is_admin()));
create policy payments_insert on public.payments for insert to authenticated with check ((select app.is_admin()));
create policy payments_update on public.payments for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));

-- activities
create policy activities_select on public.activities for select to authenticated
  using (user_id = (select app.me()) or (select app.is_admin()) or app.mentors_user(user_id)
         or (lead_id is not null and app.can_access_lead(lead_id)) or (client_id is not null and app.can_access_client(client_id)));
create policy activities_insert on public.activities for insert to authenticated
  with check (user_id = (select app.me())
    and (lead_id is null or app.can_access_lead(lead_id)) and (client_id is null or app.can_access_client(client_id)));
create policy activities_delete on public.activities for delete to authenticated using ((select app.is_admin()));

-- tasks
create policy tasks_select on public.tasks for select to authenticated
  using ((select app.is_admin()) or assigned_to = (select app.me()) or created_by = (select app.me()) or app.mentors_user(assigned_to));
create policy tasks_insert on public.tasks for insert to authenticated
  with check ((select app.me()) is not null and (created_by is null or created_by = (select app.me()))
    and (assigned_to = (select app.me()) or (select app.is_admin()) or app.mentors_user(assigned_to))
    and (lead_id is null or app.can_access_lead(lead_id)));
create policy tasks_update on public.tasks for update to authenticated
  using ((select app.is_admin()) or assigned_to = (select app.me()) or created_by = (select app.me()) or app.mentors_user(assigned_to))
  with check ((select app.is_admin()) or assigned_to = (select app.me()) or created_by = (select app.me()) or app.mentors_user(assigned_to));
create policy tasks_delete on public.tasks for delete to authenticated
  using ((select app.is_admin()) or created_by = (select app.me()) or app.mentors_user(assigned_to));
create policy task_comments_select on public.task_comments for select to authenticated using (app.can_access_task(task_id));
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (author_id = (select app.me()) and app.can_access_task(task_id));
create policy task_comments_delete on public.task_comments for delete to authenticated using ((select app.is_admin()));

-- reports, coaching, notifications
create policy daily_reports_select on public.daily_reports for select to authenticated
  using (user_id = (select app.me()) or (select app.is_admin()) or app.mentors_user(user_id));
create policy daily_reports_insert on public.daily_reports for insert to authenticated with check (user_id = (select app.me()));
create policy daily_reports_update on public.daily_reports for update to authenticated
  using (user_id = (select app.me())) with check (user_id = (select app.me()));
create policy coaching_select on public.coaching_notes for select to authenticated
  using (employee_id = (select app.me()) or mentor_id = (select app.me()) or (select app.is_admin()) or app.mentors_user(employee_id));
create policy coaching_insert on public.coaching_notes for insert to authenticated
  with check (mentor_id = (select app.me()) and ((select app.is_admin()) or app.mentors_user(employee_id)));
create policy notifications_select on public.notifications for select to authenticated using (recipient_id = (select app.me()));
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_id = (select app.me())) with check (recipient_id = (select app.me()));

-- audit: admin sees everything; others see only work-related entries by themselves / their team
create policy audit_select on public.audit_logs for select to authenticated
  using ((select app.is_admin()) or (entity_type in ('leads','tasks','lead_assignments','coaching_notes')
         and (actor_id = (select app.me()) or app.mentors_user(actor_id))));

-- approvals
create policy approvals_select on public.approval_requests for select to authenticated
  using (requested_by = (select app.me()) or (select app.is_admin()) or app.mentors_user(requested_by));
create policy approvals_insert on public.approval_requests for insert to authenticated with check (requested_by = (select app.me()));
create policy approvals_cancel on public.approval_requests for update to authenticated
  using (requested_by = (select app.me()) and status = 'pending')
  with check (requested_by = (select app.me()) and status = 'cancelled');

-- imports & saved filters
create policy import_jobs_select on public.import_jobs for select to authenticated using ((select app.is_admin()));
create policy import_jobs_insert on public.import_jobs for insert to authenticated with check ((select app.is_admin()));
create policy import_jobs_update on public.import_jobs for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy import_jobs_delete on public.import_jobs for delete to authenticated using ((select app.is_admin()));
create policy saved_filters_select on public.saved_filters for select to authenticated using (user_id = (select app.me()));
create policy saved_filters_insert on public.saved_filters for insert to authenticated with check (user_id = (select app.me()));
create policy saved_filters_update on public.saved_filters for update to authenticated using (user_id = (select app.me())) with check (user_id = (select app.me()));
create policy saved_filters_delete on public.saved_filters for delete to authenticated using (user_id = (select app.me()));

-- ───────── views ─────────
-- Minimal colleague directory (id, name, role) so assignee names render for everyone. Deliberately a
-- definer-style view (bypasses profiles RLS) exposing no email and only active users.
create view public.user_directory as
  select id, full_name, role from public.profiles where is_active and (select app.me()) is not null;
grant select on public.user_directory to authenticated;

-- Invoice balances computed from valid (completed) payments only. security_invoker => the invoices/payments
-- RLS applies, so this is admin-only. (No definer helper is exposed to API roles, so amounts cannot be probed.)
create view public.invoice_balances with (security_invoker = true) as
  select i.id as invoice_id, i.invoice_number, i.client_id, i.project_id, i.currency, i.total, i.status, i.issue_date, i.due_date,
         r.received, i.total - r.received as balance,
         (i.status in ('issued','partially_paid') and i.due_date < current_date) as is_overdue
  from public.invoices i
  cross join lateral (
    select coalesce(sum(case when p.kind = 'payment' then p.amount else -p.amount end), 0) as received
    from public.payments p where p.invoice_id = i.id and p.status = 'completed') r;
grant select on public.invoice_balances to authenticated;
