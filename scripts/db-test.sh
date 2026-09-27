#!/usr/bin/env bash
#
# Database tests on a plain PostgreSQL server (no Docker / Supabase CLI needed).
#
#  1. creates a fresh database, loads a stub of the Supabase platform
#     (supabase/tests/stub/supabase_stub.sql), applies every migration and the seed;
#  2. runs every supabase/tests/*.test.sql file (each must end with ROLLBACK or
#     leave no trace; a failing assertion raises an exception);
#  3. checks that the declarative schema (supabase/schemas) and the migrations
#     produce the same database.
#
# Connection: standard libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD).
# Usage: scripts/db-test.sh [test-file ...]
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUPA="$ROOT/supabase"
DB_MIGRATIONS="crm_test_migrations"
DB_SCHEMAS="crm_test_schemas"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc)
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

# Extensions that only exist on Supabase are stubbed by supabase_stub.sql
filter_extensions() {
  grep -viE '^\s*create extension if not exists "?(http|pg_net|pgjwt|pg_cron)"?' "$1"
}

fresh_db() {
  dropdb --if-exists "$1"
  createdb "$1"
  "${PSQL[@]}" -d "$1" -f "$SUPA/tests/stub/supabase_stub.sql"
}

echo "==> Applying migrations"
fresh_db "$DB_MIGRATIONS"
for f in "$SUPA"/migrations/*.sql; do
  filter_extensions "$f" | "${PSQL[@]}" -d "$DB_MIGRATIONS" -f - || { echo "FAILED: $f"; exit 1; }
done
"${PSQL[@]}" -d "$DB_MIGRATIONS" -f "$SUPA/seed.sql"

echo "==> Running tests"
tests=("$@")
if [ ${#tests[@]} -eq 0 ]; then
  tests=("$SUPA"/tests/*.test.sql)
fi
failed=0
for t in "${tests[@]}"; do
  if "${PSQL[@]}" -d "$DB_MIGRATIONS" -f "$t" >/dev/null; then
    echo "  ok   $(basename "$t")"
  else
    echo "  FAIL $(basename "$t")"
    failed=1
  fi
done

echo "==> Checking declarative schema matches migrations"
fresh_db "$DB_SCHEMAS"
for f in "$SUPA"/schemas/*.sql; do
  filter_extensions "$f" | "${PSQL[@]}" -d "$DB_SCHEMAS" -f - || { echo "FAILED: $f"; exit 1; }
done
DIFF_FILE="$(mktemp)"
trap 'rm -f "$DIFF_FILE"' EXIT
dump() {
  pg_dump --schema-only --no-owner --schema=public --schema=private "$1" |
    grep -vE '^(--|SET |SELECT pg_catalog|\\(un)?restrict )' | sed '/^$/d'
}
if diff <(dump "$DB_MIGRATIONS") <(dump "$DB_SCHEMAS") >"$DIFF_FILE"; then
  echo "  ok   schemas/ == migrations/"
else
  echo "  FAIL schemas/ and migrations/ differ:"
  head -50 "$DIFF_FILE"
  failed=1
fi

exit $failed
