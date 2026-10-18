#!/usr/bin/env bash
# Parallel-session tests against the already-built test DB. Each psql process is an independent connection.
set -uo pipefail
DB=${TEST_DB:-blezex_test}
q() { if [ -n "${PSQL_AS_POSTGRES:-}" ]; then su postgres -c "psql -X -At -d $DB -c \"$1\"" 2>&1; else psql -X -At -d "$DB" -c "$1" 2>&1; fi; }
E1=00000000-0000-0000-0000-0000000000e1
AS_E1="set role authenticated; select set_config('request.jwt.claim.sub','$E1',false);"
fail=0; ok() { echo "PASS  $1"; }; bad() { echo "FAIL  $1"; fail=1; }
tmp=$(mktemp -d)

# 1. 20 sessions x 10 lead inserts => 200 distinct, gap-tolerant, collision-free business numbers
for s in $(seq 1 20); do
  ( for i in $(seq 1 10); do q "$AS_E1 insert into public.leads (company_name, owner_id) values ('Conc $s-$i','$E1');" >/dev/null; done ) &
done; wait
total=$(q "select count(*) from public.leads where company_name like 'Conc %'")
distinct=$(q "select count(distinct lead_number) from public.leads where company_name like 'Conc %'")
[ "$total" = 200 ] && [ "$distinct" = 200 ] && ok "concurrent inserts: 200 rows, 200 distinct lead numbers" || bad "concurrent numbering ($total/$distinct)"

# 2. two sessions convert the same lead simultaneously => exactly one client/project
q "insert into public.leads (id, company_name, contact_name, email, owner_id, service_id, estimated_value) values ('10000000-0000-0000-0000-0000000000c1','Race Corp','R','r@race.test','$E1',(select id from public.services limit 1),1000)" >/dev/null
for s in 1 2 3 4; do ( q "$AS_E1 select (public.convert_lead_to_client('10000000-0000-0000-0000-0000000000c1', 1000))->>'already_converted';" > $tmp/conv$s ) & done; wait
clients=$(q "select count(*) from public.clients where source_lead_id='10000000-0000-0000-0000-0000000000c1'")
projects=$(q "select count(*) from public.projects p join public.clients c on c.id=p.client_id where c.source_lead_id='10000000-0000-0000-0000-0000000000c1'")
firsts=$(cat $tmp/conv* | grep -c '^false$')
[ "$clients" = 1 ] && [ "$projects" = 1 ] && [ "$firsts" = 1 ] && ok "4 simultaneous conversions: 1 client, 1 project, 1 worker, 3 replays" || bad "concurrent conversion (clients=$clients projects=$projects workers=$firsts; $(cat $tmp/conv* | tr '\n' ' '))"

# 3. concurrent payments cannot jointly overpay an invoice
q "insert into public.invoices (id, client_id, due_date, total, status) values ('40000000-0000-0000-0000-0000000000c1','30000000-0000-0000-0000-000000000001', current_date+5, 1000, 'issued')" >/dev/null
for s in 1 2 3; do ( q "insert into public.payments (invoice_id, amount, method) values ('40000000-0000-0000-0000-0000000000c1', 600, 'upi')" > $tmp/pay$s 2>&1 ) & done; wait
paid=$(q "select count(*) from public.payments where invoice_id='40000000-0000-0000-0000-0000000000c1'")
[ "$paid" = 1 ] && ok "3 concurrent 600 payments on a 1000 invoice: exactly 1 accepted" || bad "concurrent payments accepted=$paid"

# 4. concurrent updates: optimistic version rejects the stale writer
q "insert into public.leads (id, company_name, contact_name, email, owner_id, estimated_value) values ('10000000-0000-0000-0000-0000000000c2','Version Co','V','v@v.test','$E1',1)" >/dev/null
v=$(q "select row_version from public.leads where id='10000000-0000-0000-0000-0000000000c2'")
q "$AS_E1 select public.move_lead_stage('10000000-0000-0000-0000-0000000000c2','researching',null,null,$v);" >/dev/null
out=$(q "$AS_E1 select public.move_lead_stage('10000000-0000-0000-0000-0000000000c2','contacted',null,null,$v);")
echo "$out" | grep -q "modified by someone else" && ok "stale writer rejected with serialization error" || bad "stale write accepted: $out"

# 5. concurrent assignment: still exactly one open assignment row
for s in 1 2 3 4 5 6; do ( q "set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); select public.assign_lead('10000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e$((s%3+1))');" >/dev/null 2>&1 ) & done; wait
open=$(q "select count(*) from public.lead_assignments where lead_id='10000000-0000-0000-0000-0000000000c2' and unassigned_at is null")
total_asg=$(q "select count(*) from public.lead_assignments where lead_id='10000000-0000-0000-0000-0000000000c2'")
[ "$open" = 1 ] && [ "$total_asg" -ge 2 ] && ok "6 concurrent reassignments ($total_asg history rows) leave exactly one open assignment" || bad "open assignments=$open"
rm -rf $tmp; exit $fail
