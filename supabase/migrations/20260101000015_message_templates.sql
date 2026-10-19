-- BlezeX Connect — 0015: reusable email / WhatsApp message templates.
-- Everyone signed in can read active templates (to send from a lead); only admins manage them. Placeholders such as
-- {{contact_name}}, {{company_name}} and {{owner_name}} are filled in by the app. Sending itself happens in the user's own
-- mail / WhatsApp app (mailto: / wa.me), then the app logs the activity — no mail server credentials are stored here.

create table public.message_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  channel    text not null check (channel in ('email','whatsapp')),
  subject    text,                                   -- email only
  body       text not null check (length(btrim(body)) > 0),
  is_active  boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, name)
);
create trigger message_templates_updated before update on public.message_templates for each row execute function app.set_updated_at();
create trigger audit_message_templates after insert or update or delete on public.message_templates for each row execute function app.audit_row();

alter table public.message_templates enable row level security;
revoke all on public.message_templates from anon, authenticated;
grant select on public.message_templates to authenticated;
grant insert (name, channel, subject, body, is_active), update (name, subject, body, is_active), delete on public.message_templates to authenticated;
create policy message_templates_select on public.message_templates for select to authenticated
  using ((select app.me()) is not null and (is_active or (select app.is_admin())));
create policy message_templates_insert on public.message_templates for insert to authenticated with check ((select app.is_admin()));
create policy message_templates_update on public.message_templates for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy message_templates_delete on public.message_templates for delete to authenticated using ((select app.is_admin()));

insert into public.message_templates (name, channel, subject, body) values
 ('Introduction', 'email', 'Introduction from BlezeX — {{company_name}}',
  E'Hi {{contact_name}},\n\nThis is {{owner_name}} from BlezeX. I''d love to learn more about {{company_name}} and see where we can help.\n\nWould you have 15 minutes this week for a quick call?\n\nBest regards,\n{{owner_name}}'),
 ('Follow-up', 'email', 'Following up — {{company_name}}',
  E'Hi {{contact_name}},\n\nJust checking in on my earlier note. Is there anything I can clarify or share to help you decide?\n\nBest regards,\n{{owner_name}}'),
 ('Proposal sent', 'email', 'Our proposal for {{company_name}}',
  E'Hi {{contact_name}},\n\nThank you for your time. I''ve shared our proposal — please let me know if you have questions or would like to adjust anything.\n\nBest regards,\n{{owner_name}}'),
 ('Quick hello', 'whatsapp', null,
  E'Hi {{contact_name}}, this is {{owner_name}} from BlezeX. Is now a good time for a short chat about {{company_name}}?');
