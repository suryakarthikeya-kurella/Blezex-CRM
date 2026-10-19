-- BlezeX Connect — 0010: remove the attendance gate added in 0009.
-- 0009 is already applied on the hosted project, so it is reversed here rather than edited. Afterwards the CRM
-- is exactly as it was before 0009: access depends on role/RLS only, not on checking in. Attendance (0007)
-- and leave (0008) are untouched.

-- 1. the restrictive policies (must go before the functions they call)
do $$ declare r record; begin
  for r in select schemaname, tablename from pg_policies where schemaname = 'public' and policyname = 'workspace_gate' loop
    execute format('drop policy workspace_gate on %I.%I', r.schemaname, r.tablename);
  end loop;
end $$;

-- 2. take the added guard line back out of the definer functions (their stored text is otherwise unchanged)
do $$
declare f text; v_def text; v_new text;
begin
  foreach f in array array[
    'public.assign_lead(uuid,uuid,text)', 'public.move_lead_stage(uuid,text,text,uuid,integer)',
    'public.convert_lead_to_client(uuid,numeric,text,uuid,text,text,text,text,date,date,uuid)',
    'public.archive_lead(uuid,boolean)', 'public.decide_approval(uuid,boolean,text)']
  loop
    v_def := pg_get_functiondef(f::regprocedure);
    v_new := replace(v_def, E'  perform app.require_workspace();\n', '');
    if v_new = v_def then raise exception 'workspace guard not found in %', f; end if;
    execute v_new;
  end loop;

  f := 'public.find_duplicate_leads(text,text,text,text,uuid)';
  v_def := pg_get_functiondef(f::regprocedure);
  v_new := replace(v_def, 'where app.me() is not null and app.workspace_open() and', 'where app.me() is not null and');
  if v_new = v_def then raise exception 'workspace guard not found in %', f; end if;
  execute v_new;
end $$;

-- 3. the helpers themselves
drop function public.workspace_status();
drop function app.require_workspace();
drop function app.workspace_open();
