-- BlezeX Connect — 0018: Finance & Accounts module.
-- Additive only. Reuses clients / projects (= deals) / invoices / payments / audit_logs.
--   1. Services & pricing  : services gain description, standard_price, discount_percent. Deals snapshot price + discount
--                            when created, so a later catalogue change never rewrites an agreed contract price.
--   2. Payments            : `purpose` (advance | partial | final).
--   3. Invoice adjustments : append-only credit/debit rows, reversed by a mirror row, never edited or deleted.
--   4. Expenses, expense payments, salary obligations, salary payments (all ADMIN ONLY).
--   5. Read model          : admin-gated views + RPCs so the dashboard, reports and detail pages share ONE definition.
-- Money is numeric(14,2). Single currency (INR) is assumed by the aggregates.

-- ───────── 1. services & pricing ─────────
alter table public.services
  add column description      text,
  add column standard_price   numeric(14,2) not null default 0 check (standard_price >= 0),
  add column discount_percent numeric(5,2)  not null default 0 check (discount_percent between 0 and 100);

alter table public.projects
  add column list_price       numeric(14,2) check (list_price is null or list_price >= 0),   -- catalogue price when the deal was created
  add column discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100);

create function app.projects_snapshot_price() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.service_id is not null and new.list_price is null then
    select s.standard_price, s.discount_percent into new.list_price, new.discount_percent
    from public.services s where s.id = new.service_id;
  end if;
  return new;
end $$;
create trigger projects_snapshot_price before insert on public.projects for each row execute function app.projects_snapshot_price();

-- ───────── 2. payments: purpose ─────────
alter table public.payments
  add column purpose text not null default 'partial' check (purpose in ('advance','partial','final'));
grant insert (purpose) on public.payments to authenticated;
create index payments_paid_at_idx on public.payments (paid_at) where status = 'completed';
create index invoices_issue_idx on public.invoices (issue_date);

-- ───────── 3. invoice adjustments (append-only) ─────────
create table public.invoice_adjustments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete restrict,
  kind        text not null check (kind in ('credit','debit')),     -- credit lowers the amount due, debit raises it
  amount      numeric(14,2) not null check (amount > 0),
  reason      text not null check (length(btrim(reason)) > 0),
  reverses_id uuid unique references public.invoice_adjustments(id) on delete restrict,   -- one reversal per adjustment
  request_id  uuid,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index invoice_adjustments_invoice_idx on public.invoice_adjustments (invoice_id);
create unique index invoice_adjustments_request_key on public.invoice_adjustments (created_by, request_id) where request_id is not null;

create function app.block_mutation() returns trigger language plpgsql as $$
begin raise exception '% rows are append-only; add a reversal instead', tg_table_name using errcode = '42501'; end $$;
create trigger invoice_adjustments_append_only before update or delete on public.invoice_adjustments
  for each row execute function app.block_mutation();

-- Signed net of an invoice's adjustments (debit +, credit −). A reversal is an opposite row, so it cancels out.
create function app.invoice_adjustment_net(p_invoice uuid) returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when kind = 'debit' then amount else -amount end), 0)
  from public.invoice_adjustments where invoice_id = p_invoice
$$;

-- One place that derives an invoice's status from adjusted total vs. net received.
create function app.invoice_recompute_status(p_invoice uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_status text; v_total numeric; v_net numeric; v_new text;
begin
  select status, total + app.invoice_adjustment_net(id) into v_status, v_total from public.invoices where id = p_invoice;
  if v_status in ('issued','partially_paid','paid') then
    v_net := app.invoice_net_received(p_invoice);
    v_new := case when v_net >= v_total then 'paid' when v_net > 0 then 'partially_paid' else 'issued' end;
    if v_new <> v_status then update public.invoices set status = v_new where id = p_invoice; end if;
  end if;
end $$;

create or replace function app.payments_before() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_inv public.invoices%rowtype; v_net numeric; v_adjusted numeric;
begin
  select * into v_inv from public.invoices where id = new.invoice_id for update;   -- serialises concurrent payments
  if not found then raise exception 'invoice not found' using errcode = '23503'; end if;
  if tg_op = 'INSERT' and new.recorded_by is null then new.recorded_by := app.me(); end if;
  if v_inv.status in ('draft','cancelled') and new.status in ('pending','completed') then
    raise exception 'cannot record a payment against a % invoice', v_inv.status using errcode = '23514';
  end if;
  if new.status = 'completed' then
    v_adjusted := v_inv.total + app.invoice_adjustment_net(v_inv.id);
    v_net := app.invoice_net_received(new.invoice_id, case when tg_op = 'UPDATE' then new.id end)
             + case when new.kind = 'payment' then new.amount else -new.amount end;
    if v_net > v_adjusted then raise exception 'payment exceeds invoice balance' using errcode = '23514'; end if;
    if v_net < 0 then raise exception 'refund exceeds amount received' using errcode = '23514'; end if;
  end if;
  return new;
end $$;

create or replace function app.payments_after() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.invoice_recompute_status(new.invoice_id);
  return new;
end $$;

create or replace function app.invoices_before() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by is null then new.created_by := app.me(); end if;
  else
    if new.total + app.invoice_adjustment_net(old.id) < app.invoice_net_received(old.id) then
      raise exception 'invoice total cannot be below amount already received' using errcode = '23514';
    end if;
    if new.status = 'cancelled' and app.invoice_net_received(old.id) > 0 then
      raise exception 'refund received payments before cancelling this invoice' using errcode = '23514';
    end if;
  end if;
  if new.project_id is not null and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id or new.client_id is distinct from old.client_id)
     and not exists (select 1 from public.projects p where p.id = new.project_id and p.client_id = new.client_id) then
    raise exception 'the deal does not belong to this client' using errcode = '23514';
  end if;
  return new;
end $$;

create function app.invoice_adjustments_before() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_inv public.invoices%rowtype; o public.invoice_adjustments%rowtype; v_total numeric;
begin
  if new.created_by is null then new.created_by := app.me(); end if;
  if new.reverses_id is not null then                       -- a reversal mirrors its original exactly
    select * into o from public.invoice_adjustments where id = new.reverses_id;
    if not found then raise exception 'adjustment to reverse not found' using errcode = '23503'; end if;
    if o.reverses_id is not null then raise exception 'a reversal cannot itself be reversed' using errcode = '23514'; end if;
    new.invoice_id := o.invoice_id;
    new.kind := case o.kind when 'credit' then 'debit' else 'credit' end;
    new.amount := o.amount;
  end if;
  select * into v_inv from public.invoices where id = new.invoice_id for update;     -- serialises with payments
  if not found then raise exception 'invoice not found' using errcode = '23503'; end if;
  if v_inv.status not in ('issued','partially_paid','paid') then
    raise exception 'cannot adjust a % invoice', v_inv.status using errcode = '23514';
  end if;
  v_total := v_inv.total + app.invoice_adjustment_net(v_inv.id) + case new.kind when 'debit' then new.amount else -new.amount end;
  if v_total <= 0 then raise exception 'adjusted invoice total must stay above zero (cancel the invoice instead)' using errcode = '23514'; end if;
  if v_total < app.invoice_net_received(v_inv.id) then
    raise exception 'adjusted total cannot be below the amount already received' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger invoice_adjustments_before before insert on public.invoice_adjustments for each row execute function app.invoice_adjustments_before();

create function app.invoice_adjustments_after() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform app.invoice_recompute_status(new.invoice_id); return new; end $$;
create trigger invoice_adjustments_after after insert on public.invoice_adjustments for each row execute function app.invoice_adjustments_after();

create function public.reverse_invoice_adjustment(p_adjustment uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o public.invoice_adjustments%rowtype; v_id uuid;
begin
  if not app.is_admin() then raise exception 'only admins can reverse adjustments' using errcode = '42501'; end if;
  select * into o from public.invoice_adjustments where id = p_adjustment;
  if not found then raise exception 'adjustment not found' using errcode = 'P0002'; end if;
  insert into public.invoice_adjustments (invoice_id, kind, amount, reason, reverses_id)
  values (o.invoice_id, o.kind, o.amount, p_reason, o.id) returning id into v_id;   -- trigger flips kind and re-validates
  return v_id;
end $$;

-- Invoice balances now include adjustments. New columns are appended (create or replace keeps existing ones).
create or replace view public.invoice_balances with (security_invoker = true) as
  select i.id as invoice_id, i.invoice_number, i.client_id, i.project_id, i.currency, i.total, i.status, i.issue_date, i.due_date,
         r.received, i.total + a.adjustment - r.received as balance,
         (i.status in ('issued','partially_paid') and i.due_date < current_date) as is_overdue,
         a.adjustment, i.total + a.adjustment as adjusted_total
  from public.invoices i
  cross join lateral (
    select coalesce(sum(case when p.kind = 'payment' then p.amount else -p.amount end), 0) as received
    from public.payments p where p.invoice_id = i.id and p.status = 'completed') r
  cross join lateral (
    select coalesce(sum(case when x.kind = 'debit' then x.amount else -x.amount end), 0) as adjustment
    from public.invoice_adjustments x where x.invoice_id = i.id) a;

-- the existing revenue report invoices the ADJUSTED amount (everything else in it already reads invoice_balances)
create or replace function public.report_revenue(p_from date, p_to date) returns jsonb language plpgsql stable set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'financial reports are restricted to admins' using errcode = '42501'; end if;
  return (select jsonb_build_object(
    'invoiced',    coalesce((select sum(adjusted_total) from public.invoice_balances where status not in ('draft','cancelled') and issue_date between p_from and p_to), 0),
    'collected',   coalesce((select sum(case when kind = 'payment' then amount else -amount end) from public.payments
                              where status = 'completed' and paid_at between p_from and p_to), 0),
    'outstanding', coalesce((select sum(balance) from public.invoice_balances where status in ('issued','partially_paid')), 0),
    'overdue',     coalesce((select sum(balance) from public.invoice_balances where is_overdue), 0),
    'won_value',   coalesce((select sum(pr.agreed_value) from public.leads l join public.clients c on c.source_lead_id = l.id
                              join public.projects pr on pr.client_id = c.id
                              where l.converted_at::date between p_from and p_to), 0)));
end $$;

-- ───────── 4. expenses & payroll (admin only) ─────────
create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  description  text not null check (length(btrim(description)) > 0),
  category     text not null check (category in ('office_rent','utilities','marketing','software','travel','equipment','other')),
  amount       numeric(14,2) not null check (amount > 0),
  currency     char(3) not null default 'INR',
  expense_date date not null default current_date,
  notes        text,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index expenses_date_idx on public.expenses (expense_date);

create table public.expense_payments (
  id                    uuid primary key default gen_random_uuid(),
  expense_id            uuid not null references public.expenses(id) on delete restrict,
  amount                numeric(14,2) not null check (amount > 0),
  paid_on               date not null default current_date,
  method                text not null check (method in ('bank_transfer','upi','cash','cheque','gateway','other')),
  transaction_reference text,
  status                text not null default 'completed' check (status in ('completed','cancelled')),
  request_id            uuid,
  notes                 text,
  recorded_by           uuid references public.profiles(id),
  created_at            timestamptz not null default now()
);
create index expense_payments_expense_idx on public.expense_payments (expense_id);
create index expense_payments_paid_idx on public.expense_payments (paid_on) where status = 'completed';
create unique index expense_payments_request_key on public.expense_payments (recorded_by, request_id) where request_id is not null;

create table public.salary_obligations (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.profiles(id) on delete restrict,
  period_month      date not null check (extract(day from period_month) = 1),
  base_amount       numeric(14,2) not null check (base_amount >= 0),
  incentive_amount  numeric(14,2) not null default 0 check (incentive_amount >= 0),
  commission_amount numeric(14,2) not null default 0 check (commission_amount >= 0),
  total_amount      numeric(14,2) generated always as (base_amount + incentive_amount + commission_amount) stored,
  status            text not null default 'draft' check (status in ('draft','approved','cancelled')),
  approved_by       uuid references public.profiles(id),
  approved_at       timestamptz,
  notes             text,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (base_amount + incentive_amount + commission_amount > 0),
  check ((status = 'approved') = (approved_at is not null) or status = 'cancelled')
);
create unique index salary_obligations_period_key on public.salary_obligations (employee_id, period_month) where status <> 'cancelled';
create index salary_obligations_month_idx on public.salary_obligations (period_month);

create table public.salary_payments (
  id                    uuid primary key default gen_random_uuid(),
  obligation_id         uuid not null references public.salary_obligations(id) on delete restrict,
  amount                numeric(14,2) not null check (amount > 0),
  paid_on               date not null default current_date,
  method                text not null check (method in ('bank_transfer','upi','cash','cheque','gateway','other')),
  transaction_reference text,
  status                text not null default 'completed' check (status in ('completed','cancelled')),
  request_id            uuid,
  notes                 text,
  recorded_by           uuid references public.profiles(id),
  created_at            timestamptz not null default now()
);
create index salary_payments_obligation_idx on public.salary_payments (obligation_id);
create index salary_payments_paid_idx on public.salary_payments (paid_on) where status = 'completed';
create unique index salary_payments_request_key on public.salary_payments (recorded_by, request_id) where request_id is not null;

create trigger expenses_updated before update on public.expenses for each row execute function app.set_updated_at();
create trigger salary_obligations_updated before update on public.salary_obligations for each row execute function app.set_updated_at();

create function app.expenses_before() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by is null then new.created_by := app.me(); end if;
  elsif new.amount < (select coalesce(sum(amount), 0) from public.expense_payments where expense_id = old.id and status = 'completed') then
    raise exception 'expense cannot be lowered below what has already been paid' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger expenses_before before insert or update on public.expenses for each row execute function app.expenses_before();

create function app.expense_payments_before() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_amount numeric; v_paid numeric;
begin
  select amount into v_amount from public.expenses where id = new.expense_id for update;   -- serialises concurrent payments
  if not found then raise exception 'expense not found' using errcode = '23503'; end if;
  if tg_op = 'INSERT' and new.recorded_by is null then new.recorded_by := app.me(); end if;
  if new.status = 'completed' then
    select coalesce(sum(amount), 0) into v_paid from public.expense_payments
    where expense_id = new.expense_id and status = 'completed' and id is distinct from new.id;
    if v_paid + new.amount > v_amount then raise exception 'payment exceeds expense amount' using errcode = '23514'; end if;
  end if;
  return new;
end $$;
create trigger expense_payments_before before insert or update on public.expense_payments for each row execute function app.expense_payments_before();

create function app.salary_obligations_before() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft'; new.approved_by := null; new.approved_at := null;
    if new.created_by is null then new.created_by := app.me(); end if;
    return new;
  end if;
  if old.status = 'cancelled' then raise exception 'cancelled obligations are read-only' using errcode = '23514'; end if;
  if old.status = 'approved' then
    if new.status = 'draft' then raise exception 'an approved obligation cannot go back to draft' using errcode = '23514'; end if;
    if (new.base_amount, new.incentive_amount, new.commission_amount) is distinct from (old.base_amount, old.incentive_amount, old.commission_amount) then
      raise exception 'approved obligation amounts are immutable: cancel and re-create' using errcode = '23514';
    end if;
    if new.status = 'cancelled' and exists (select 1 from public.salary_payments where obligation_id = old.id and status = 'completed') then
      raise exception 'cannot cancel an obligation that has payments' using errcode = '23514';
    end if;
  end if;
  new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  if old.status = 'draft' and new.status = 'approved' then new.approved_by := app.me(); new.approved_at := now(); end if;
  return new;
end $$;
create trigger salary_obligations_before before insert or update on public.salary_obligations for each row execute function app.salary_obligations_before();

create function app.salary_payments_before() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_ob public.salary_obligations%rowtype; v_paid numeric;
begin
  select * into v_ob from public.salary_obligations where id = new.obligation_id for update;
  if not found then raise exception 'salary obligation not found' using errcode = '23503'; end if;
  if tg_op = 'INSERT' and new.recorded_by is null then new.recorded_by := app.me(); end if;
  if new.status = 'completed' then
    if v_ob.status <> 'approved' then raise exception 'only approved obligations can be paid' using errcode = '23514'; end if;
    select coalesce(sum(amount), 0) into v_paid from public.salary_payments
    where obligation_id = new.obligation_id and status = 'completed' and id is distinct from new.id;
    if v_paid + new.amount > v_ob.total_amount then raise exception 'payment exceeds salary obligation' using errcode = '23514'; end if;
  end if;
  return new;
end $$;
create trigger salary_payments_before before insert or update on public.salary_payments for each row execute function app.salary_payments_before();

do $$ declare t text; begin
  foreach t in array array['invoice_adjustments','expenses','expense_payments','salary_obligations','salary_payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function app.audit_row()', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using ((select app.is_admin()))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check ((select app.is_admin()))', t);
  end loop;
  foreach t in array array['expenses','expense_payments','salary_obligations','salary_payments'] loop
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()))', t);
  end loop;
end $$;
create policy expenses_delete on public.expenses for delete to authenticated using ((select app.is_admin()));

grant select on public.invoice_adjustments, public.expenses, public.expense_payments, public.salary_obligations, public.salary_payments to authenticated;
grant insert (invoice_id, kind, amount, reason, request_id) on public.invoice_adjustments to authenticated;     -- no UPDATE / DELETE, ever
grant insert (description, category, amount, expense_date, notes) on public.expenses to authenticated;
grant update (description, category, amount, expense_date, notes) on public.expenses to authenticated;
grant delete on public.expenses to authenticated;
grant insert (expense_id, amount, paid_on, method, transaction_reference, request_id, notes) on public.expense_payments to authenticated;
grant update (status, notes) on public.expense_payments to authenticated;                                      -- amounts immutable, no DELETE
grant insert (employee_id, period_month, base_amount, incentive_amount, commission_amount, notes) on public.salary_obligations to authenticated;
grant update (base_amount, incentive_amount, commission_amount, status, notes) on public.salary_obligations to authenticated;   -- no DELETE: cancel instead
grant insert (obligation_id, amount, paid_on, method, transaction_reference, request_id, notes) on public.salary_payments to authenticated;
grant update (status, notes) on public.salary_payments to authenticated;

-- ───────── 5. read model (all admin-gated; security_invoker so RLS applies on top) ─────────
grant execute on function app.company_tz() to authenticated;   -- existing helper (0007); views below run as the caller

-- A deal = a project. Closed date: the lead's conversion date; a client with no source lead falls back to project creation.
-- Sales owner: lead owner first, then the client's relationship owner.
create view public.finance_deals with (security_invoker = true) as
  select pr.id as project_id, pr.project_number, pr.project_name, pr.client_id, c.company_name,
         pr.service_id, coalesce(s.name, pr.service_type) as service_name,
         pr.agreed_value, pr.list_price, pr.discount_percent, pr.currency,
         (coalesce(l.converted_at, pr.created_at) at time zone app.company_tz())::date as closed_on,
         coalesce(l.owner_id, c.relationship_owner_id) as sales_user_id,
         u.full_name as sales_user_name,
         case when l.owner_id is not null then 'lead_owner'
              when c.relationship_owner_id is not null then 'relationship_owner' else 'none' end as sales_source
  from public.projects pr
  join public.clients c on c.id = pr.client_id
  left join public.leads l on l.id = c.source_lead_id
  left join public.services s on s.id = pr.service_id
  left join public.profiles u on u.id = coalesce(l.owner_id, c.relationship_owner_id)
  where (select app.is_admin());

-- Invoice → deal: the invoice's own project; otherwise the client's deal, but only when the client has exactly one.
create view public.finance_invoice_ledger with (security_invoker = true) as
  select b.invoice_id, b.invoice_number, b.client_id, c.company_name, b.currency, b.total, b.adjustment, b.adjusted_total,
         b.status, b.issue_date, b.due_date, b.received, b.balance, b.is_overdue,
         coalesce(b.project_id, one.id) as deal_id
  from public.invoice_balances b
  join public.clients c on c.id = b.client_id
  left join lateral (
    select p.id from public.projects p
    where b.project_id is null and p.client_id = b.client_id
      and not exists (select 1 from public.projects q where q.client_id = b.client_id and q.id <> p.id)
  ) one on true
  where (select app.is_admin());

create view public.finance_collections with (security_invoker = true) as
  select p.id as payment_id, p.invoice_id, l.invoice_number, l.client_id, l.company_name, l.deal_id, d.sales_user_id,
         p.kind, p.purpose, p.amount, case when p.kind = 'payment' then p.amount else -p.amount end as signed_amount,
         p.paid_at, p.method, p.transaction_reference, p.status, p.recorded_by
  from public.payments p
  join public.finance_invoice_ledger l on l.invoice_id = p.invoice_id
  left join public.finance_deals d on d.project_id = l.deal_id;

create view public.client_accounts with (security_invoker = true) as
  select d.project_id, d.project_number, d.project_name, d.client_id, d.company_name, c.contact_name, c.email, c.phone,
         d.service_name, d.sales_user_id, d.sales_user_name, d.sales_source, d.closed_on, d.currency,
         d.list_price, d.discount_percent, d.agreed_value,
         coalesce(inv.invoiced, 0)::numeric(14,2)            as invoiced,
         coalesce(pay.advance, 0)::numeric(14,2)             as advance_paid,
         (coalesce(pay.collected, 0) - coalesce(pay.advance, 0))::numeric(14,2) as subsequent_paid,
         coalesce(pay.collected, 0)::numeric(14,2)           as total_collected,
         (d.agreed_value - coalesce(pay.collected, 0))::numeric(14,2) as contract_balance,
         coalesce(inv.outstanding, 0)::numeric(14,2)         as invoice_outstanding,
         inv.next_due
  from public.finance_deals d
  join public.clients c on c.id = d.client_id
  left join lateral (
    select sum(l.adjusted_total) filter (where l.status in ('issued','partially_paid','paid')) as invoiced,
           sum(l.balance)        filter (where l.status in ('issued','partially_paid'))        as outstanding,
           min(l.due_date)       filter (where l.status in ('issued','partially_paid'))        as next_due
    from public.finance_invoice_ledger l where l.deal_id = d.project_id) inv on true
  left join lateral (
    select sum(f.signed_amount) filter (where f.status = 'completed') as collected,
           sum(f.amount) filter (where f.status = 'completed' and f.kind = 'payment' and f.purpose = 'advance') as advance
    from public.finance_collections f where f.deal_id = d.project_id) pay on true;

create view public.expense_balances with (security_invoker = true) as
  select e.id, e.description, e.category, e.amount, e.currency, e.expense_date, e.notes, e.created_by, e.created_at,
         coalesce(s.paid, 0)::numeric(14,2) as paid,
         (e.amount - coalesce(s.paid, 0))::numeric(14,2) as balance,
         case when coalesce(s.paid, 0) = 0 then 'unpaid' when s.paid < e.amount then 'partially_paid' else 'paid' end as payment_status,
         s.last_paid_on
  from public.expenses e
  left join lateral (
    select sum(x.amount) filter (where x.status = 'completed') as paid,
           max(x.paid_on) filter (where x.status = 'completed') as last_paid_on
    from public.expense_payments x where x.expense_id = e.id) s on true;

create view public.salary_balances with (security_invoker = true) as
  select o.id, o.employee_id, p.full_name as employee_name, p.email as employee_email, o.period_month,
         o.base_amount, o.incentive_amount, o.commission_amount, o.total_amount, o.status,
         o.approved_by, o.approved_at, o.notes,
         coalesce(s.paid, 0)::numeric(14,2) as paid,
         (case when o.status = 'approved' then o.total_amount - coalesce(s.paid, 0) else 0 end)::numeric(14,2) as balance,
         case when o.status <> 'approved' then o.status
              when coalesce(s.paid, 0) = 0 then 'unpaid'
              when s.paid < o.total_amount then 'partially_paid' else 'paid' end as payment_status,
         s.last_paid_on
  from public.salary_obligations o
  join public.profiles p on p.id = o.employee_id
  left join lateral (
    select sum(x.amount) filter (where x.status = 'completed') as paid,
           max(x.paid_on) filter (where x.status = 'completed') as last_paid_on
    from public.salary_payments x where x.obligation_id = o.id) s on true;

grant select on public.finance_deals, public.finance_invoice_ledger, public.finance_collections, public.client_accounts,
  public.expense_balances, public.salary_balances to authenticated;

-- Admin + sane range guard shared by every finance RPC.
create function app.fin_guard(p_from date, p_to date) returns void language plpgsql stable set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'finance data is restricted to admins' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'invalid date range' using errcode = '22023'; end if;
end $$;

-- THE definition of every period (flow) metric. Overview, series and reports all call this.
create function app.fin_flows(p_from date, p_to date)
returns table (closed_sales numeric, collected numeric, advances numeric, expenses_paid numeric, salaries_paid numeric)
language sql stable set search_path = '' as $$
  select
    coalesce((select sum(d.agreed_value) from public.finance_deals d where d.closed_on between p_from and p_to), 0)::numeric(14,2),
    coalesce((select sum(c.signed_amount) from public.finance_collections c where c.status = 'completed' and c.paid_at between p_from and p_to), 0)::numeric(14,2),
    coalesce((select sum(c.amount) from public.finance_collections c
              where c.status = 'completed' and c.kind = 'payment' and c.purpose = 'advance' and c.paid_at between p_from and p_to), 0)::numeric(14,2),
    coalesce((select sum(x.amount) from public.expense_payments x where x.status = 'completed' and x.paid_on between p_from and p_to), 0)::numeric(14,2),
    coalesce((select sum(x.amount) from public.salary_payments x where x.status = 'completed' and x.paid_on between p_from and p_to), 0)::numeric(14,2)
$$;

-- Period metrics follow the date filter; stock metrics (outstanding, overdue, payable) are as of today.
create function public.finance_overview(p_from date, p_to date) returns jsonb language plpgsql stable set search_path = '' as $$
declare f record; v_out numeric; v_due numeric; v_pay numeric; v_inv numeric;
begin
  perform app.fin_guard(p_from, p_to);
  select * into f from app.fin_flows(p_from, p_to);
  select coalesce(sum(balance) filter (where status in ('issued','partially_paid')), 0),
         coalesce(sum(balance) filter (where is_overdue), 0)
    into v_out, v_due from public.finance_invoice_ledger;
  select coalesce(sum(balance), 0) into v_pay from public.salary_balances where status = 'approved';
  select coalesce(sum(adjusted_total), 0) into v_inv from public.finance_invoice_ledger
    where status in ('issued','partially_paid','paid') and issue_date between p_from and p_to;
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'as_of', current_date,
    'total_closed_sales', f.closed_sales,
    'invoiced', v_inv,
    'total_collected', f.collected,
    'advances_received', f.advances,
    'outstanding_receivables', v_out,
    'overdue_payments', v_due,
    'total_expenses_paid', f.expenses_paid,
    'salaries_paid', f.salaries_paid,
    'salaries_payable', v_pay,
    'net_cash_flow', f.collected - f.expenses_paid - f.salaries_paid,
    'net_profit', null,
    'net_profit_status', 'not_available');
end $$;

create function public.finance_series(p_from date, p_to date, p_bucket text default 'month')
returns table (bucket date, closed_sales numeric, collected numeric, advances numeric, expenses_paid numeric, salaries_paid numeric, net_cash_flow numeric)
language plpgsql stable set search_path = '' as $$
begin
  perform app.fin_guard(p_from, p_to);
  if p_bucket not in ('month','year') then raise exception 'bucket must be month or year' using errcode = '22023'; end if;
  if p_to - p_from > 3660 then raise exception 'range too large' using errcode = '22023'; end if;
  return query
    select b.d, f.closed_sales, f.collected, f.advances, f.expenses_paid, f.salaries_paid,
           (f.collected - f.expenses_paid - f.salaries_paid)::numeric(14,2)
    from (select g::date as d from generate_series(date_trunc(p_bucket, p_from::timestamp), p_to::timestamp, ('1 ' || p_bucket)::interval) g) b
    cross join lateral app.fin_flows(greatest(b.d, p_from),
                                     least((b.d + ('1 ' || p_bucket)::interval - interval '1 day')::date, p_to)) f
    order by b.d;
end $$;

create function public.finance_employee_sales(p_from date, p_to date)
returns table (user_id uuid, full_name text, deals_closed bigint, closed_value numeric, collected numeric, outstanding numeric)
language plpgsql stable set search_path = '' as $$
begin
  perform app.fin_guard(p_from, p_to);
  return query
  with cl as (select d.sales_user_id as su, count(*) as n, sum(d.agreed_value) as v from public.finance_deals d
              where d.closed_on between p_from and p_to group by 1),
       co as (select c.sales_user_id as su, sum(c.signed_amount) as v from public.finance_collections c
              where c.status = 'completed' and c.paid_at between p_from and p_to group by 1),
       ou as (select d.sales_user_id as su, sum(l.balance) as v from public.finance_invoice_ledger l
              left join public.finance_deals d on d.project_id = l.deal_id
              where l.status in ('issued','partially_paid') group by 1),
       k as (select su from cl union select su from co union select su from ou)
  select k.su, coalesce(p.full_name, 'Unattributed'), coalesce(cl.n, 0)::bigint,
         coalesce(cl.v, 0)::numeric(14,2), coalesce(co.v, 0)::numeric(14,2), coalesce(ou.v, 0)::numeric(14,2)
  from k
  left join cl on cl.su is not distinct from k.su
  left join co on co.su is not distinct from k.su
  left join ou on ou.su is not distinct from k.su
  left join public.profiles p on p.id = k.su
  order by 4 desc, 2;
end $$;

do $$ declare f text; begin
  foreach f in array array['public.reverse_invoice_adjustment(uuid,text)','public.finance_overview(date,date)',
    'public.finance_series(date,date,text)','public.finance_employee_sales(date,date)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['app.fin_guard(date,date)','app.fin_flows(date,date)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
