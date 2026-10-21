-- Finance & Accounts module (migration 0018). All fixture money sits in 2020 so flow metrics are isolated from other test files;
-- stock metrics (outstanding / overdue / payable) are asserted as deltas against a baseline captured before the fixtures.
\set a1 '''00000000-0000-0000-0000-0000000000a1'''
\set e1 '''00000000-0000-0000-0000-0000000000e1'''
\set e2 '''00000000-0000-0000-0000-0000000000e2'''
\set e3 '''00000000-0000-0000-0000-0000000000e3'''
\set b1 '''00000000-0000-0000-0000-0000000000b1'''

create function t.ov(k text, f date, u date) returns text language sql as $$
  select round((public.finance_overview(f, u) ->> k)::numeric, 2)::text $$;
create function t.n(q text) returns text language plpgsql as $$
declare v text; begin execute 'select round((' || q || ')::numeric, 2)::text' into v; return v; end $$;
grant execute on function t.ov(text, date, date), t.n(text) to authenticated;

\echo === 22.0 baseline (stock metrics before fixtures)
begin;
select t.act(:a1);
select t.ov('outstanding_receivables', date '2020-01-01', date '2020-12-31') as b_out,
       t.ov('overdue_payments',        date '2020-01-01', date '2020-12-31') as b_due,
       t.ov('salaries_payable',        date '2020-01-01', date '2020-12-31') as b_pay \gset
rollback;
select set_config('t.b_out', :'b_out', false), set_config('t.b_due', :'b_due', false), set_config('t.b_pay', :'b_pay', false);

\echo === 22.1 fixtures (superuser)
insert into public.services (id, name, standard_price, discount_percent, description)
  values ('51000000-0000-0000-0000-000000000001', 'FinSvc', 50000, 10, 'finance test service');
insert into public.leads (id, company_name, owner_id, converted_at) values
  ('52000000-0000-0000-0000-000000000001', 'FinLead A', :e1, '2020-01-10 10:00+00'),
  ('52000000-0000-0000-0000-000000000002', 'FinLead B', null, '2020-01-20 10:00+00');
insert into public.clients (id, company_name, source_lead_id, relationship_owner_id) values
  ('53000000-0000-0000-0000-00000000000a', 'FinClient A', '52000000-0000-0000-0000-000000000001', :e2),
  ('53000000-0000-0000-0000-00000000000b', 'FinClient B', '52000000-0000-0000-0000-000000000002', :e3),
  ('53000000-0000-0000-0000-00000000000c', 'FinClient C', null, :e2);
insert into public.projects (id, client_id, project_name, service_id, agreed_value, created_at) values
  ('54000000-0000-0000-0000-00000000000a', '53000000-0000-0000-0000-00000000000a', 'PA',  '51000000-0000-0000-0000-000000000001', 50000, '2026-01-01'),
  ('54000000-0000-0000-0000-0000000000a2', '53000000-0000-0000-0000-00000000000a', 'PA2', null, 10000, '2026-01-01'),
  ('54000000-0000-0000-0000-00000000000b', '53000000-0000-0000-0000-00000000000b', 'PB',  null, 30000, '2026-01-01'),
  ('54000000-0000-0000-0000-00000000000c', '53000000-0000-0000-0000-00000000000c', 'PC',  null, 20000, '2020-02-05 10:00+00');
insert into public.invoices (id, client_id, project_id, issue_date, due_date, total, status) values
  ('55000000-0000-0000-0000-00000000000a', '53000000-0000-0000-0000-00000000000a', '54000000-0000-0000-0000-00000000000a', '2020-01-12', '2020-02-11', 50000, 'issued'),
  ('55000000-0000-0000-0000-00000000000b', '53000000-0000-0000-0000-00000000000b', '54000000-0000-0000-0000-00000000000b', '2020-01-25', '2020-02-24', 30000, 'issued'),
  ('55000000-0000-0000-0000-00000000000c', '53000000-0000-0000-0000-00000000000c', null,                                   '2020-02-06', current_date + 30, 20000, 'issued'),
  ('55000000-0000-0000-0000-00000000000e', '53000000-0000-0000-0000-00000000000a', null,                                   '2020-02-01', '2020-02-15', 4000, 'issued');
insert into public.payments (invoice_id, kind, purpose, amount, paid_at, method) values
  ('55000000-0000-0000-0000-00000000000a', 'payment', 'advance', 20000, '2020-01-15', 'bank_transfer'),
  ('55000000-0000-0000-0000-00000000000a', 'payment', 'partial', 10000, '2020-02-01', 'upi'),
  ('55000000-0000-0000-0000-00000000000a', 'refund',  'partial',  2000, '2020-02-10', 'bank_transfer'),
  ('55000000-0000-0000-0000-00000000000b', 'payment', 'final',   30000, '2020-01-28', 'bank_transfer'),
  ('55000000-0000-0000-0000-00000000000c', 'payment', 'advance',  5000, '2020-02-08', 'upi'),
  ('55000000-0000-0000-0000-00000000000e', 'payment', 'partial',  1000, '2020-02-20', 'cash');
insert into public.payments (invoice_id, kind, purpose, amount, paid_at, method, status) values
  ('55000000-0000-0000-0000-00000000000a', 'payment', 'partial', 9999, '2020-01-20', 'cheque', 'failed');
insert into public.expenses (id, description, category, amount, expense_date) values
  ('56000000-0000-0000-0000-000000000001', 'Jan rent',      'office_rent', 12000, '2020-01-05'),
  ('56000000-0000-0000-0000-000000000002', 'Ad campaign',   'marketing',    8000, '2020-01-10'),
  ('56000000-0000-0000-0000-000000000003', 'Licence',       'software',      500, '2020-01-12');
insert into public.expense_payments (expense_id, amount, paid_on, method) values
  ('56000000-0000-0000-0000-000000000001', 12000, '2020-01-06', 'bank_transfer'),
  ('56000000-0000-0000-0000-000000000002',  3000, '2020-02-02', 'upi');
insert into public.expense_payments (expense_id, amount, paid_on, method, status) values
  ('56000000-0000-0000-0000-000000000002',   777, '2020-01-15', 'upi', 'cancelled');
insert into public.salary_obligations (id, employee_id, period_month, base_amount, incentive_amount, commission_amount) values
  ('57000000-0000-0000-0000-000000000001', :e1, '2020-01-01', 20000, 3000, 2000),
  ('57000000-0000-0000-0000-000000000002', :e2, '2020-01-01', 10000, 0, 0),
  ('57000000-0000-0000-0000-000000000003', :e3, '2020-01-01',  8000, 0, 0);
update public.salary_obligations set status = 'approved' where id in ('57000000-0000-0000-0000-000000000001','57000000-0000-0000-0000-000000000003');
insert into public.salary_payments (obligation_id, amount, paid_on, method) values
  ('57000000-0000-0000-0000-000000000001', 10000, '2020-02-01', 'bank_transfer'),
  ('57000000-0000-0000-0000-000000000001',  5000, '2020-02-05', 'bank_transfer');

\echo === 22.2 services & pricing: price snapshot, who can read/write
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select list_price::text || '/' || discount_percent::text from public.projects where project_name='PA'$q$), '50000.00/10.00', 'project snapshots service price + discount at signing');
  perform t.affects($q$update public.services set standard_price = 60000, discount_percent = 15 where name = 'FinSvc'$q$, 1, 'admin changes standard price');
  perform t.eq(t.val($q$select agreed_value::text || '/' || list_price::text || '/' || discount_percent::text from public.projects where project_name='PA'$q$), '50000.00/50000.00/10.00', 'existing deal keeps its agreed + list price after a catalogue price change');
  perform t.denied($q$update public.services set discount_percent = 150 where name = 'FinSvc'$q$, 'discount must be 0..100');
  perform t.denied($q$update public.services set standard_price = -1 where name = 'FinSvc'$q$, 'price cannot be negative');
  perform t.affects($q$update public.services set standard_price = 50000, discount_percent = 10 where name = 'FinSvc'$q$, 1, 'admin restores price');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.eq(t.val($q$select standard_price::text || '/' || discount_percent::text from public.services where name='FinSvc'$q$), '50000.00/10.00', 'employee reads catalogue price');
  perform t.affects($q$update public.services set standard_price = 1 where name = 'FinSvc'$q$, 0, 'employee cannot change price (0 rows)');
  perform t.denied($q$insert into public.services (name, standard_price) values ('Sneaky', 1)$q$, 'employee cannot add a service');
  perform t.affects($q$delete from public.services where name = 'FinSvc'$q$, 0, 'employee cannot delete a service');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000b1');
  perform t.eq(t.val($q$select standard_price::text from public.services where name='FinSvc'$q$), '50000.00', 'mentor reads catalogue price');
  perform t.affects($q$update public.services set standard_price = 1 where name = 'FinSvc'$q$, 0, 'mentor cannot change price (0 rows)');
  perform t.denied($q$insert into public.services (name, standard_price) values ('Sneaky', 1)$q$, 'mentor cannot add a service');
end $$;

\echo === 22.3 deals: closed once, attribution lead owner → relationship owner
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select sales_user_id::text || '/' || sales_source from public.finance_deals where project_id='54000000-0000-0000-0000-00000000000a'$q$), '00000000-0000-0000-0000-0000000000e1/lead_owner', 'lead owner wins over relationship owner');
  perform t.eq(t.val($q$select sales_user_id::text || '/' || sales_source from public.finance_deals where project_id='54000000-0000-0000-0000-00000000000b'$q$), '00000000-0000-0000-0000-0000000000e3/relationship_owner', 'unowned lead falls back to relationship owner');
  perform t.eq(t.val($q$select sales_user_id::text || '/' || sales_source from public.finance_deals where project_id='54000000-0000-0000-0000-00000000000c'$q$), '00000000-0000-0000-0000-0000000000e2/relationship_owner', 'client without a lead falls back to relationship owner');
  perform t.eq(t.val($q$select count(*) from public.finance_deals where project_id='54000000-0000-0000-0000-00000000000a'$q$), '1', 'a deal appears once however many invoices/payments it has');
end $$;

\echo === 22.4 overview: every metric, three date windows
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  -- January 2020
  perform t.eq(t.ov('total_closed_sales',  '2020-01-01', '2020-01-31'), '90000.00', 'Jan closed sales = PA + PA2 + PB, each once');
  perform t.eq(t.ov('total_collected',     '2020-01-01', '2020-01-31'), '50000.00', 'Jan collected (failed payment ignored)');
  perform t.eq(t.ov('advances_received',   '2020-01-01', '2020-01-31'), '20000.00', 'Jan advances (subset of collected)');
  perform t.eq(t.ov('total_expenses_paid', '2020-01-01', '2020-01-31'), '12000.00', 'Jan expenses paid (partial + cancelled payments ignored)');
  perform t.eq(t.ov('salaries_paid',       '2020-01-01', '2020-01-31'), '0.00',     'Jan salaries paid');
  perform t.eq(t.ov('net_cash_flow',       '2020-01-01', '2020-01-31'), '38000.00', 'Jan net cash flow = collected − expenses − salaries');
  -- February 2020
  perform t.eq(t.ov('total_closed_sales',  '2020-02-01', '2020-02-29'), '20000.00', 'Feb closed sales: client with no lead dated by project creation');
  perform t.eq(t.ov('total_collected',     '2020-02-01', '2020-02-29'), '14000.00', 'Feb collected = 10000 − 2000 refund + 5000 + 1000');
  perform t.eq(t.ov('advances_received',   '2020-02-01', '2020-02-29'), '5000.00',  'Feb advances');
  perform t.eq(t.ov('total_expenses_paid', '2020-02-01', '2020-02-29'), '3000.00',  'Feb expenses paid');
  perform t.eq(t.ov('salaries_paid',       '2020-02-01', '2020-02-29'), '15000.00', 'Feb salaries paid (two partial payments)');
  perform t.eq(t.ov('net_cash_flow',       '2020-02-01', '2020-02-29'), '-4000.00', 'Feb net cash flow can be negative');
  -- whole year
  perform t.eq(t.ov('total_closed_sales',  '2020-01-01', '2020-12-31'), '110000.00', 'year closed sales');
  perform t.eq(t.ov('total_collected',     '2020-01-01', '2020-12-31'), '64000.00', 'year collected = Jan + Feb');
  perform t.eq(t.ov('advances_received',   '2020-01-01', '2020-12-31'), '25000.00', 'year advances');
  perform t.eq(t.ov('net_cash_flow',       '2020-01-01', '2020-12-31'), '34000.00', 'year net cash flow');
  -- stock metrics (as of today) as deltas
  perform t.eq(t.n(format($f$%s - %L::numeric$f$, t.val($q$select t.ov('outstanding_receivables','2020-01-01','2020-12-31')$q$), current_setting('t.b_out'))), '40000.00', 'outstanding receivables delta = 22000 + 15000 + 3000');
  perform t.eq(t.n(format($f$%s - %L::numeric$f$, t.val($q$select t.ov('overdue_payments','2020-01-01','2020-12-31')$q$), current_setting('t.b_due'))), '25000.00', 'overdue delta = 22000 + 3000 (invoice C is not yet due)');
  perform t.eq(t.n(format($f$%s - %L::numeric$f$, t.val($q$select t.ov('salaries_payable','2020-01-01','2020-12-31')$q$), current_setting('t.b_pay'))), '18000.00', 'salaries payable delta = (25000−15000) + 8000; draft ignored');
  perform t.eq(t.val($q$select public.finance_overview('2020-01-01','2020-12-31') ->> 'net_profit'$q$), null, 'net profit is not computed');
  perform t.eq(t.val($q$select public.finance_overview('2020-01-01','2020-12-31') ->> 'net_profit_status'$q$), 'not_available', 'net profit flagged not available');
  perform t.denied($q$select public.finance_overview('2020-12-31','2020-01-01')$q$, 'inverted range rejected');
end $$;

\echo === 22.5 series shares the overview definitions
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.n($q$(select collected from public.finance_series('2020-01-01','2020-12-31','month') where bucket = '2020-01-01')$q$), '50000.00', 'monthly series: Jan collected');
  perform t.eq(t.n($q$(select net_cash_flow from public.finance_series('2020-01-01','2020-12-31','month') where bucket = '2020-02-01')$q$), '-4000.00', 'monthly series: Feb cash flow');
  perform t.eq(t.n($q$(select sum(collected) from public.finance_series('2020-01-01','2020-12-31','month'))$q$), t.ov('total_collected','2020-01-01','2020-12-31'), 'monthly buckets add up to the overview');
  perform t.eq(t.n($q$(select sum(closed_sales) from public.finance_series('2020-01-01','2020-12-31','month'))$q$), t.ov('total_closed_sales','2020-01-01','2020-12-31'), 'closed sales buckets add up');
  perform t.eq(t.n($q$(select closed_sales from public.finance_series('2020-01-01','2020-12-31','year'))$q$), '110000.00', 'yearly series: one bucket for the year');
  perform t.eq(t.val($q$select count(*) from public.finance_series('2020-01-15','2020-02-10','month')$q$), '2', 'partial months clipped to the requested range');
  perform t.denied($q$select * from public.finance_series('2020-01-01','2020-12-31','week')$q$, 'unknown bucket rejected');
end $$;

\echo === 22.6 employee sales
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select deals_closed || '/' || closed_value || '/' || collected || '/' || outstanding from public.finance_employee_sales('2020-01-01','2020-12-31') where user_id = '00000000-0000-0000-0000-0000000000e1'$q$), '2/60000.00/28000.00/22000.00', 'E1: PA + PA2 closed, collected net of refund, outstanding on PA');
  perform t.eq(t.val($q$select deals_closed || '/' || closed_value || '/' || collected || '/' || outstanding from public.finance_employee_sales('2020-01-01','2020-12-31') where user_id = '00000000-0000-0000-0000-0000000000e3'$q$), '1/30000.00/30000.00/0.00', 'E3 (fallback owner): fully paid deal');
  perform t.eq(t.val($q$select deals_closed || '/' || closed_value || '/' || collected || '/' || outstanding from public.finance_employee_sales('2020-01-01','2020-12-31') where user_id = '00000000-0000-0000-0000-0000000000e2'$q$), '1/20000.00/5000.00/15000.00', 'E2: invoice with no project resolves to the client''s only deal');
  perform t.eq(t.val($q$select collected from public.finance_employee_sales('2020-01-01','2020-12-31') where user_id is null$q$), '1000.00', 'invoice on an ambiguous client is unattributed, not guessed');
  perform t.eq(t.n($q$(select sum(closed_value) from public.finance_employee_sales('2020-01-01','2020-12-31'))$q$), t.ov('total_closed_sales','2020-01-01','2020-12-31'), 'per-employee closed value adds up to company closed sales');
  perform t.eq(t.n($q$(select sum(collected) from public.finance_employee_sales('2020-01-01','2020-12-31'))$q$), t.ov('total_collected','2020-01-01','2020-12-31'), 'per-employee collections add up to company collected');
end $$;

\echo === 22.7 client accounts
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select list_price || '/' || discount_percent || '/' || agreed_value || '/' || invoiced || '/' || advance_paid || '/' || subsequent_paid || '/' || total_collected || '/' || contract_balance || '/' || invoice_outstanding || '/' || next_due from public.client_accounts where project_id='54000000-0000-0000-0000-00000000000a'$q$),
    '50000.00/10.00/50000.00/50000.00/20000.00/8000.00/28000.00/22000.00/22000.00/2020-02-11', 'client account for PA');
  perform t.eq(t.val($q$select invoiced || '/' || total_collected || '/' || contract_balance from public.client_accounts where project_id='54000000-0000-0000-0000-0000000000a2'$q$), '0.00/0.00/10000.00', 'second deal of the same client is its own row, no cross-counting');
end $$;

\echo === 22.8 payments: purpose + invoice/project consistency
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.denied($q$insert into public.payments (invoice_id, amount, method, purpose, transaction_reference) values ('55000000-0000-0000-0000-00000000000c', 1, 'upi', 'bogus', 'X-1')$q$, 'purpose is a closed vocabulary');
  perform t.denied($q$insert into public.invoices (client_id, project_id, due_date, total) values ('53000000-0000-0000-0000-00000000000b', '54000000-0000-0000-0000-00000000000a', current_date, 10)$q$, 'invoice project must belong to the invoice client');
  perform t.affects($q$insert into public.payments (invoice_id, amount, method, purpose, request_id) values ('55000000-0000-0000-0000-00000000000c', 100, 'upi', 'partial', '99999999-0000-0000-0000-000000000001')$q$, 1, 'admin records a partial payment');
  perform t.denied($q$insert into public.payments (invoice_id, amount, method, purpose, request_id) values ('55000000-0000-0000-0000-00000000000c', 100, 'upi', 'partial', '99999999-0000-0000-0000-000000000001')$q$, 'same request id cannot be submitted twice');
  perform t.denied($q$update public.payments set purpose = 'advance' where request_id = '99999999-0000-0000-0000-000000000001'$q$, 'purpose is immutable', array['42501']);
  perform t.affects($q$update public.payments set status = 'cancelled' where request_id = '99999999-0000-0000-0000-000000000001'$q$, 1, 'a mistaken payment is cancelled, never deleted');
  perform t.eq(t.val($q$select balance::text from public.invoice_balances where invoice_id='55000000-0000-0000-0000-00000000000c'$q$), '15000.00', 'cancelled payment no longer counts');
end $$;

\echo === 22.9 invoice adjustments: append-only credit/debit with reversal
insert into public.invoices (id, client_id, issue_date, due_date, total, status)
  values ('55000000-0000-0000-0000-0000000000f1', '30000000-0000-0000-0000-000000000001', '2020-03-01', '2020-04-01', 10000, 'issued'),
         ('55000000-0000-0000-0000-0000000000f2', '30000000-0000-0000-0000-000000000001', '2020-03-01', '2020-04-01', 500, 'draft');
do $$ declare c uuid; d uuid; r uuid; begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  insert into public.invoice_adjustments (invoice_id, kind, amount, reason) values ('55000000-0000-0000-0000-0000000000f1', 'credit', 2000, 'goodwill') returning id into c;
  perform t.eq(t.val($q$select adjusted_total || '/' || balance from public.invoice_balances where invoice_id='55000000-0000-0000-0000-0000000000f1'$q$), '8000.00/8000.00', 'credit lowers the amount due');
  perform t.denied($q$insert into public.invoice_adjustments (invoice_id, kind, amount, reason) values ('55000000-0000-0000-0000-0000000000f1', 'credit', 8000, 'too much')$q$, 'credit cannot take the invoice to zero (cancel it instead)');
  perform t.denied($q$insert into public.invoice_adjustments (invoice_id, kind, amount, reason) values ('55000000-0000-0000-0000-0000000000f1', 'debit', 0, 'zero')$q$, 'amount must be positive');
  perform t.denied($q$insert into public.invoice_adjustments (invoice_id, kind, amount, reason) values ('55000000-0000-0000-0000-0000000000f1', 'debit', 5, '  ')$q$, 'reason is required');
  perform t.denied($q$insert into public.invoice_adjustments (invoice_id, kind, amount, reason) values ('55000000-0000-0000-0000-0000000000f2', 'debit', 5, 'draft')$q$, 'no adjustments on a draft invoice');
  insert into public.invoice_adjustments (invoice_id, kind, amount, reason) values ('55000000-0000-0000-0000-0000000000f1', 'debit', 500, 'extra scope') returning id into d;
  perform t.eq(t.val($q$select adjusted_total from public.invoice_balances where invoice_id='55000000-0000-0000-0000-0000000000f1'$q$), '8500.00', 'debit raises the amount due');
  perform t.denied(format($q$update public.invoice_adjustments set amount = 1 where id = %L$q$, c), 'adjustments are append-only (update)', array['42501']);
  perform t.denied(format($q$delete from public.invoice_adjustments where id = %L$q$, c), 'adjustments are append-only (delete)', array['42501']);
  select public.reverse_invoice_adjustment(c, 'entered in error') into r;
  perform t.eq(t.val($q$select adjusted_total from public.invoice_balances where invoice_id='55000000-0000-0000-0000-0000000000f1'$q$), '10500.00', 'reversal restores the credit (history kept)');
  perform t.eq(t.val(format($q$select kind || '/' || amount || '/' || (reverses_id = %L)::text from public.invoice_adjustments where id = %L$q$, c, r)), 'debit/2000.00/true', 'reversal row mirrors the original with the opposite kind');
  perform t.denied(format($q$select public.reverse_invoice_adjustment(%L, 'again')$q$, c), 'an adjustment can be reversed only once');
  perform t.denied(format($q$select public.reverse_invoice_adjustment(%L, 'undo the undo')$q$, r), 'a reversal cannot itself be reversed');
  perform t.eq(t.val($q$select count(*) from public.invoice_adjustments where invoice_id='55000000-0000-0000-0000-0000000000f1'$q$), '3', 'three immutable rows remain');
  perform t.denied($q$insert into public.payments (invoice_id, amount, method) values ('55000000-0000-0000-0000-0000000000f1', 10501, 'upi')$q$, 'payments are capped by the ADJUSTED total');
  perform t.affects($q$insert into public.payments (invoice_id, amount, method, transaction_reference) values ('55000000-0000-0000-0000-0000000000f1', 10500, 'upi', 'ADJ-PAID')$q$, 1, 'paying the adjusted total settles the invoice');
  perform t.eq(t.val($q$select status from public.invoices where id='55000000-0000-0000-0000-0000000000f1'$q$), 'paid', 'invoice status follows the adjusted total');
  perform t.denied(format($q$insert into public.invoice_adjustments (invoice_id, kind, amount, reason) values ('55000000-0000-0000-0000-0000000000f1', 'credit', 1, 'below received')$q$), 'credit cannot push the total below what was received');
  perform t.eq(t.val($q$select count(*) > 0 from public.audit_logs where entity_type = 'invoice_adjustments'$q$), 'true', 'adjustments are audited');
  perform t.eq(t.val($q$select (created_by = '00000000-0000-0000-0000-0000000000a1')::text from public.invoice_adjustments limit 1$q$), 'true', 'adjustment records who made it');
end $$;

\echo === 22.10 expenses
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select payment_status || '/' || paid || '/' || balance from public.expense_balances where id='56000000-0000-0000-0000-000000000001'$q$), 'paid/12000.00/0.00', 'fully paid expense');
  perform t.eq(t.val($q$select payment_status || '/' || paid || '/' || balance || '/' || last_paid_on from public.expense_balances where id='56000000-0000-0000-0000-000000000002'$q$), 'partially_paid/3000.00/5000.00/2020-02-02', 'partially paid expense ignores the cancelled payment');
  perform t.eq(t.val($q$select payment_status from public.expense_balances where id='56000000-0000-0000-0000-000000000003'$q$), 'unpaid', 'unpaid expense');
  perform t.denied($q$insert into public.expense_payments (expense_id, amount, method) values ('56000000-0000-0000-0000-000000000002', 5001, 'upi')$q$, 'cannot pay more than the expense');
  perform t.denied($q$insert into public.expenses (description, category, amount) values ('x', 'gifts', 10)$q$, 'category is a closed vocabulary');
  perform t.denied($q$insert into public.expenses (description, category, amount) values ('x', 'travel', 0)$q$, 'amount must be positive');
  perform t.denied($q$update public.expenses set amount = 100 where id='56000000-0000-0000-0000-000000000001'$q$, 'expense cannot drop below what is already paid');
  perform t.denied($q$update public.expense_payments set amount = 1 where expense_id='56000000-0000-0000-0000-000000000001'$q$, 'expense payment amounts are immutable', array['42501']);
  perform t.denied($q$delete from public.expenses where id='56000000-0000-0000-0000-000000000001'$q$, 'an expense with payments cannot be deleted');
  perform t.affects($q$insert into public.expense_payments (expense_id, amount, method, request_id) values ('56000000-0000-0000-0000-000000000003', 500, 'cash', '99999999-0000-0000-0000-000000000002')$q$, 1, 'record the final payment');
  perform t.denied($q$insert into public.expense_payments (expense_id, amount, method, request_id) values ('56000000-0000-0000-0000-000000000003', 500, 'cash', '99999999-0000-0000-0000-000000000002')$q$, 'duplicate submission blocked');
  perform t.eq(t.val($q$select (recorded_by = '00000000-0000-0000-0000-0000000000a1')::text from public.expense_payments where request_id='99999999-0000-0000-0000-000000000002'$q$), 'true', 'expense payment records who paid');
  perform t.eq(t.val($q$select count(*) > 0 from public.audit_logs where entity_type in ('expenses','expense_payments')$q$), 'true', 'expenses are audited');
end $$;

\echo === 22.11 payroll
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select total_amount || '/' || paid || '/' || balance || '/' || payment_status from public.salary_balances where id='57000000-0000-0000-0000-000000000001'$q$), '25000.00/15000.00/10000.00/partially_paid', 'base + incentive + commission, partial payments tracked');
  perform t.eq(t.val($q$select payment_status from public.salary_balances where id='57000000-0000-0000-0000-000000000002'$q$), 'draft', 'draft obligation is not payable');
  perform t.denied($q$insert into public.salary_obligations (employee_id, period_month, base_amount) values ('00000000-0000-0000-0000-0000000000e1', '2020-01-01', 1)$q$, 'one live obligation per employee and period');
  perform t.denied($q$insert into public.salary_obligations (employee_id, period_month, base_amount) values ('00000000-0000-0000-0000-0000000000e1', '2020-02-15', 1)$q$, 'period must be a month start');
  perform t.denied($q$insert into public.salary_obligations (employee_id, period_month, base_amount, incentive_amount) values ('00000000-0000-0000-0000-0000000000e1', '2020-03-01', -1, 0)$q$, 'negative amounts rejected');
  perform t.denied($q$insert into public.salary_payments (obligation_id, amount, method) values ('57000000-0000-0000-0000-000000000002', 100, 'upi')$q$, 'no payment against a draft obligation');
  perform t.denied($q$insert into public.salary_payments (obligation_id, amount, method) values ('57000000-0000-0000-0000-000000000001', 10001, 'upi')$q$, 'cannot pay more than the obligation');
  perform t.denied($q$update public.salary_obligations set base_amount = 1 where id='57000000-0000-0000-0000-000000000001'$q$, 'approved obligation amounts are immutable');
  perform t.denied($q$update public.salary_obligations set status = 'cancelled' where id='57000000-0000-0000-0000-000000000001'$q$, 'cannot cancel an obligation that has payments');
  perform t.denied($q$update public.salary_obligations set status = 'draft' where id='57000000-0000-0000-0000-000000000001'$q$, 'approved cannot go back to draft');
  perform t.denied($q$update public.salary_payments set amount = 1$q$, 'salary payment amounts are immutable', array['42501']);
  perform t.affects($q$update public.salary_obligations set base_amount = 11000 where id='57000000-0000-0000-0000-000000000002'$q$, 1, 'draft obligation can still be edited');
  perform t.affects($q$update public.salary_obligations set status = 'approved' where id='57000000-0000-0000-0000-000000000002'$q$, 1, 'admin approves');
  perform t.eq(t.val($q$select (approved_by = '00000000-0000-0000-0000-0000000000a1' and approved_at is not null)::text from public.salary_obligations where id='57000000-0000-0000-0000-000000000002'$q$), 'true', 'approval records who and when');
  perform t.affects($q$insert into public.salary_payments (obligation_id, amount, method) values ('57000000-0000-0000-0000-000000000002', 11000, 'bank_transfer')$q$, 1, 'pay it in full');
  perform t.eq(t.val($q$select payment_status from public.salary_balances where id='57000000-0000-0000-0000-000000000002'$q$), 'paid', 'fully paid');
  perform t.affects($q$update public.salary_obligations set status = 'cancelled' where id='57000000-0000-0000-0000-000000000003'$q$, 1, 'unpaid approved obligation can be cancelled');
  perform t.affects($q$insert into public.salary_obligations (employee_id, period_month, base_amount) values ('00000000-0000-0000-0000-0000000000e3', '2020-01-01', 8500)$q$, 1, 'cancelled period can be re-created');
  perform t.eq(t.val($q$select count(*) > 0 from public.audit_logs where entity_type in ('salary_obligations','salary_payments')$q$), 'true', 'payroll is audited');
end $$;

\echo === 22.12 mentors, employees and anon see nothing confidential
do $$
declare r text; obj text;
begin
  foreach r in array array['00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000b1'] loop
    perform t.act(r::uuid);
    foreach obj in array array['expenses','expense_payments','salary_obligations','salary_payments','invoice_adjustments','expense_balances','salary_balances',
                               'finance_deals','finance_collections','finance_invoice_ledger','client_accounts','invoice_balances','invoices','payments'] loop
      perform t.eq(t.val(format('select count(*) from public.%I', obj)), '0', format('%s sees no rows in %s', r, obj));
    end loop;
    perform t.denied($q$select public.finance_overview('2020-01-01','2020-12-31')$q$, 'non-admin cannot run the overview');
    perform t.denied($q$select * from public.finance_series('2020-01-01','2020-12-31','month')$q$, 'non-admin cannot run the series');
    perform t.denied($q$select * from public.finance_employee_sales('2020-01-01','2020-12-31')$q$, 'non-admin cannot see employee sales');
    perform t.denied($q$insert into public.expenses (description, category, amount) values ('x','travel',1)$q$, 'non-admin cannot add an expense');
    perform t.denied($q$insert into public.salary_obligations (employee_id, period_month, base_amount) values (auth.uid(), '2021-01-01', 1)$q$, 'non-admin cannot create payroll');
    perform t.denied($q$insert into public.invoice_adjustments (invoice_id, kind, amount, reason) values ('55000000-0000-0000-0000-00000000000c','credit',1,'x')$q$, 'non-admin cannot adjust an invoice');
    perform t.denied($q$select public.reverse_invoice_adjustment(gen_random_uuid(), 'x')$q$, 'non-admin cannot reverse an adjustment');
    perform t.reset();
  end loop;
end $$;
do $$ begin perform t.act_anon();
  perform t.denied('select count(*) from public.expenses', 'anon cannot read expenses');
  perform t.denied('select count(*) from public.salary_obligations', 'anon cannot read payroll');
  perform t.denied($q$select public.finance_overview('2020-01-01','2020-12-31')$q$, 'anon cannot run the overview');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  perform t.eq(t.val($q$select count(*) from public.audit_logs where entity_type in ('expenses','expense_payments','salary_obligations','salary_payments','invoice_adjustments')$q$), '0', 'finance audit rows are admin-only');
end $$;
