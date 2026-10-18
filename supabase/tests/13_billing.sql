\echo === 20. invoices & payments: partial payments, refunds, duplicates, overpayment
do $$ declare inv uuid; p1 uuid; begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  insert into public.invoices (client_id, issue_date, due_date, total, status)
  values ('30000000-0000-0000-0000-000000000001', current_date - 20, current_date - 5, 1000, 'issued') returning id into inv;
  perform t.eq(t.val(format($q$select balance::text || ':' || is_overdue::text from public.invoice_balances where invoice_id=%L$q$, inv)), '1000.00:true', 'unpaid past-due invoice is overdue');
  insert into public.payments (invoice_id, amount, method, transaction_reference) values (inv, 400, 'bank_transfer', 'TXN-1') returning id into p1;
  perform t.eq(t.val(format($q$select status from public.invoices where id=%L$q$, inv)), 'partially_paid', 'partial payment recognised');
  perform t.eq(t.val(format($q$select balance::text from public.invoice_balances where invoice_id=%L$q$, inv)), '600.00', 'balance after partial payment');
  perform t.denied(format($q$insert into public.payments (invoice_id, amount, method, transaction_reference) values (%L, 100, 'upi', 'txn-1')$q$, inv), 'duplicate transaction reference (case-insensitive) rejected');
  perform t.denied(format($q$insert into public.payments (invoice_id, amount, method) values (%L, 700, 'upi')$q$, inv), 'overpayment rejected');
  insert into public.payments (invoice_id, amount, method, status) values (inv, 5000, 'cheque', 'failed');
  insert into public.payments (invoice_id, amount, method, status) values (inv, 5000, 'cheque', 'cancelled');
  perform t.eq(t.val(format($q$select balance::text from public.invoice_balances where invoice_id=%L$q$, inv)), '600.00', 'failed/cancelled payments do not count');
  insert into public.payments (invoice_id, amount, method) values (inv, 600, 'upi');
  perform t.eq(t.val(format($q$select status || ':' || balance::text || ':' || is_overdue::text from public.invoice_balances where invoice_id=%L$q$, inv)), 'paid:0.00:false', 'fully paid');
  perform t.denied(format($q$insert into public.payments (invoice_id, amount, method) values (%L, 1, 'upi')$q$, inv), 'cannot overpay a settled invoice');
  insert into public.payments (invoice_id, kind, amount, method) values (inv, 'refund', 250, 'bank_transfer');
  perform t.eq(t.val(format($q$select status || ':' || received::text from public.invoice_balances where invoice_id=%L$q$, inv)), 'partially_paid:750.00', 'refund reduces received and reopens balance');
  perform t.denied(format($q$insert into public.payments (invoice_id, kind, amount, method) values (%L,'refund', 900, 'bank_transfer')$q$, inv), 'refund cannot exceed amount received');
  perform t.denied(format($q$update public.invoices set status='cancelled' where id=%L$q$, inv), 'cannot cancel an invoice that holds money');
  perform t.denied(format($q$update public.invoices set total = 500 where id=%L$q$, inv), 'total cannot drop below received');
  perform t.denied(format($q$update public.payments set amount = 1 where id=%L$q$, p1), 'payment amounts are immutable', array['42501']);
  perform t.affects(format($q$delete from public.invoices where id=%L$q$, inv), 0, 'issued invoices cannot be deleted (0 rows)');
  perform t.eq(t.val(format($q$select (public.report_revenue(current_date-1, current_date+1)->>'collected')$q$)), '850.00', 'revenue report: collected = payments − refunds (750 here + 100 fixture)');
  perform t.eq(t.val(format($q$select (public.report_revenue(current_date-1, current_date+1)->>'won_value')$q$)), '90000.00', 'won value reported separately from cash');
  perform t.eq(t.val(format($q$select (public.report_revenue(current_date-30, current_date+1)->>'overdue')$q$)), '250.00', 'overdue sums only past-due unpaid balances (fixture invoice not yet due)');
  insert into public.invoices (client_id, due_date, total, status) values ('30000000-0000-0000-0000-000000000001', current_date + 3, 50, 'draft') returning id into inv;
  perform t.denied(format($q$insert into public.payments (invoice_id, amount, method) values (%L, 10, 'cash')$q$, inv), 'no payments against draft invoices');
  perform t.affects(format($q$delete from public.invoices where id=%L$q$, inv), 1, 'draft invoices can be deleted by admin');
  perform t.denied($q$insert into public.invoices (client_id, issue_date, due_date, total) values ('30000000-0000-0000-0000-000000000001', current_date, current_date - 1, 10)$q$, 'due date before issue date rejected');
  perform t.denied($q$insert into public.invoices (client_id, due_date, total) values ('30000000-0000-0000-0000-000000000001', current_date, -5)$q$, 'non-positive totals rejected');
end $$;
do $$ begin perform t.act('00000000-0000-0000-0000-0000000000a1');
  perform t.eq(t.val($q$select count(*) > 0 from public.audit_logs where entity_type = 'payments'$q$), 'true', 'payments are audited');
end $$;

\echo === 21. proposals
do $$ declare pid uuid; begin perform t.act('00000000-0000-0000-0000-0000000000e1');
  insert into public.proposals (lead_id, title, amount, status) values ('10000000-0000-0000-0000-000000000001','Website build', 120000, 'sent') returning id into pid;
  perform t.eq(t.val(format($q$select (sent_at is not null and followup_due_at - sent_at = interval '24 hours')::text from public.proposals where id=%L$q$, pid)), 'true', 'sent proposal gets 24h follow-up target from settings');
  perform t.eq(t.val(format($q$select proposal_number ~ '^PP-\d{6}$' from public.proposals where id=%L$q$, pid)), 'true', 'proposal number generated');
  perform t.denied($q$insert into public.proposals (lead_id, title, amount) values ('10000000-0000-0000-0000-000000000002','x', 1)$q$, 'cannot create proposal on someone else''s lead');
  perform t.denied(format($q$insert into public.proposals (lead_id, title, amount, version) values ('10000000-0000-0000-0000-000000000001','dup', 1, 1)$q$), 'one version number per lead');
  perform t.denied(format($q$update public.proposals set lead_id='10000000-0000-0000-0000-000000000002' where id=%L$q$, pid), 'proposal cannot be moved to another lead', array['42501']);
  perform t.act('00000000-0000-0000-0000-0000000000e2');
  perform t.eq(t.val(format($q$select count(*) from public.proposals where id=%L$q$, pid)), '0', 'proposal invisible to unrelated employee');
end $$;
