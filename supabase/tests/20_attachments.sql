-- attachments table rules (file access follows lead/client access). Storage policies mirror these and are checked on the live project.
\set e1 '''00000000-0000-0000-0000-0000000000e1'''

\echo === 20.1 who can attach and see files
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.affects($q$insert into public.attachments (lead_id, path, file_name, mime_type, size_bytes, uploaded_by)
    values ('10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111/brief.pdf', 'brief.pdf', 'application/pdf', 1234, '00000000-0000-0000-0000-0000000000e1')$q$, 1, 'owner attaches a file to their lead');
  perform t.denied($q$insert into public.attachments (lead_id, path, file_name, size_bytes, uploaded_by)
    values ('10000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222/x.pdf', 'x.pdf', 10, '00000000-0000-0000-0000-0000000000e1')$q$, 'cannot attach to a colleague''s lead');
  perform t.denied($q$insert into public.attachments (lead_id, path, file_name, size_bytes, uploaded_by)
    values ('10000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333/y.pdf', 'y.pdf', 10, '00000000-0000-0000-0000-0000000000e3')$q$, 'cannot upload in someone else''s name');
  perform t.denied($q$insert into public.attachments (lead_id, path, file_name, size_bytes, uploaded_by)
    values ('10000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444/big.bin', 'big.bin', 10485761, '00000000-0000-0000-0000-0000000000e1')$q$, 'over 10 MB rejected');
  perform t.denied($q$insert into public.attachments (lead_id, path, file_name, size_bytes, uploaded_by)
    values ('10000000-0000-0000-0000-000000000001', '../../etc/passwd', 'p', 10, '00000000-0000-0000-0000-0000000000e1')$q$, 'path traversal rejected');
  perform t.denied($q$insert into public.attachments (path, file_name, size_bytes, uploaded_by)
    values ('55555555-5555-5555-5555-555555555555/z.pdf', 'z.pdf', 10, '00000000-0000-0000-0000-0000000000e1')$q$, 'must belong to a lead or a client');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e3');
  perform t.eq(t.val('select count(*) from public.attachments'), '0', 'colleague (other team) cannot see it');
  perform t.affects($q$delete from public.attachments$q$, 0, 'colleague cannot delete it');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform t.eq(t.val('select count(*) from public.attachments'), '1', 'the mentor of that team sees it');
  perform t.affects($q$delete from public.attachments$q$, 0, 'mentor did not upload it, cannot delete');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b2');
  perform t.eq(t.val('select count(*) from public.attachments'), '0', 'another team''s mentor cannot see it');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val('select count(*) from public.attachments'), '1', 'admin sees it');
end $$;
do $$ begin perform t.act_anon();
  perform t.denied('select count(*) from public.attachments', 'anon sees nothing');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.denied($q$update public.attachments set file_name = 'renamed'$q$, 'attachments are immutable (delete and re-upload)');
  perform t.affects($q$delete from public.attachments$q$, 1, 'uploader deletes their own file');
end $$;
