#!/usr/bin/env bash
# Rebuild a throwaway local Postgres database from the migrations and run SQL tests.
# Usage: scripts/db-test.sh   (requires a local PostgreSQL server reachable via PGHOST/PGUSER or `su postgres`)
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-blezex_test}
run() { if [ -n "${PSQL_AS_POSTGRES:-}" ]; then su postgres -c "psql -X -v ON_ERROR_STOP=1 -q $*"; else psql -X -v ON_ERROR_STOP=1 -q "$@"; fi; }
run "-d postgres -c 'drop database if exists $DB'" ; run "-d postgres -c 'create database $DB'"
run "-d $DB -f supabase/tests/00_supabase_shim.sql"
for f in supabase/migrations/*.sql; do echo "• applying $f"; run "-d $DB -f $f"; done
for f in supabase/tests/[1-9]*.sql; do echo "• running $f"; run "-d $DB -f $f"; done
echo "• running supabase/tests/20_concurrency.sh"; TEST_DB=$DB supabase/tests/20_concurrency.sh
echo "ALL DATABASE TESTS PASSED"
