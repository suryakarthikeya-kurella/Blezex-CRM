-- BlezeX Connect — 0009: attendance gate on the CRM workspace.
-- SUPERSEDED: this feature was removed again by 0010. This file is kept only because 0009 was applied to the
-- hosted project, and the Supabase CLI requires every applied migration to exist locally. Do not edit it.
-- A mentor or employee could use CRM data only while they had an OPEN check-in today (checked in, not yet
-- checked out, company-timezone day); admins were never gated. Enforced with RESTRICTIVE policies on the CRM
-- tables plus a guard line injected into the SECURITY DEFINER RPCs that touch CRM data.

create function app.workspace_open() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(case app.my_role()
    when 'admin' then true
    else exists (select 1 from public.attendance_records r
                  where r.user_id = app.me() and r.check_out_at is null
                    and r.work_date = (now() at time zone app.company_tz())::date)
  end, false)
$$;
create function app.require_workspace() returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.workspace_open() then
    raise exception 'check in on the Attendance page to open your workspace' using errcode = '42501';
  end if;
end $$;
grant execute on function app.workspace_open() to authenticated;

create function public.workspace_status() returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('role', app.my_role(), 'open', app.workspace_open())
$$;
revoke all on function public.workspace_status() from public, anon;
grant execute on function public.workspace_status() to authenticated;

do $$ declare t text; begin
  foreach t in array array[
    'leads','lead_assignments','lead_stage_history','clients','projects','proposals','invoices','payments',
    'activities','tasks','task_comments','daily_reports','coaching_notes','user_targets',
    'pipeline_stages','lost_reasons','lead_sources','services','approval_requests','import_jobs',
    'saved_filters','audit_logs']
  loop
    execute format('create policy workspace_gate on public.%I as restrictive for all to authenticated
                    using ((select app.workspace_open())) with check ((select app.workspace_open()))', t);
  end loop;
end $$;

create policy workspace_gate on public.notifications as restrictive for select to authenticated
  using ((select app.workspace_open())
         or type in ('leave_requested','leave_decided','leave_cancelled','attendance_correction'));

do $$
declare
  f text; v_def text; v_new text;
begin
  foreach f in array array[
    'public.assign_lead(uuid,uuid,text)', 'public.move_lead_stage(uuid,text,text,uuid,integer)',
    'public.convert_lead_to_client(uuid,numeric,text,uuid,text,text,text,text,date,date,uuid)',
    'public.archive_lead(uuid,boolean)', 'public.decide_approval(uuid,boolean,text)']
  loop
    v_def := pg_get_functiondef(f::regprocedure);
    v_new := regexp_replace(v_def, E'(\\nbegin[ \\t]*\\n)', E'\\1  perform app.require_workspace();\n', 'i');
    if v_new = v_def then raise exception 'could not add the workspace guard to %', f; end if;
    execute v_new;
  end loop;

  f := 'public.find_duplicate_leads(text,text,text,text,uuid)';
  v_def := pg_get_functiondef(f::regprocedure);
  v_new := replace(v_def, 'where app.me() is not null and', 'where app.me() is not null and app.workspace_open() and');
  if v_new = v_def then raise exception 'could not add the workspace guard to %', f; end if;
  execute v_new;
end $$;
