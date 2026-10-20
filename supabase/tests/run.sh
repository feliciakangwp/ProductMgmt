#!/usr/bin/env bash
# Runs the database tests against a throwaway local PostgreSQL cluster.
#
#   bash supabase/tests/run.sh
#
# Requires PostgreSQL 15+ server binaries (initdb, pg_ctl, psql). Set PG_BIN
# if they are not on PATH, e.g. PG_BIN=/usr/lib/postgresql/16/bin.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"

if [[ -z "${PG_BIN:-}" ]]; then
  if command -v pg_ctl >/dev/null 2>&1; then
    PG_BIN="$(dirname "$(command -v pg_ctl)")"
  else
    PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  fi
fi
if [[ ! -x "$PG_BIN/initdb" ]]; then
  echo "PostgreSQL server binaries not found. Set PG_BIN." >&2
  exit 1
fi

workdir="$(mktemp -d)"
port="${PG_TEST_PORT:-54329}"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$workdir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$workdir"
}
trap cleanup EXIT

# initdb refuses to run as root; use an unprivileged account when needed.
run() { "$@"; }
if [[ "$(id -u)" == "0" ]]; then
  chown nobody "$workdir" 2>/dev/null || true
  chmod 777 "$workdir"
  run() { su -s /bin/bash nobody -c "$(printf '%q ' "$@")"; }
fi

run "$PG_BIN/initdb" -D "$workdir/data" -U postgres -A trust >/dev/null
run "$PG_BIN/pg_ctl" -D "$workdir/data" -o "-p $port -k $workdir -c listen_addresses=''" -l "$workdir/log" -w start >/dev/null

psql_cmd=("$PG_BIN/psql" -h "$workdir" -p "$port" -U postgres -v ON_ERROR_STOP=1 -q)
"${psql_cmd[@]}" -c "create database productflow_test" postgres
db=("${psql_cmd[@]}" -d productflow_test)

"${db[@]}" -f "$here/support/supabase_stub.sql"
for migration in "$root"/supabase/migrations/*.sql; do
  echo "migrate: $(basename "$migration")"
  "${db[@]}" -f "$migration"
done
"${db[@]}" -f "$here/support/helpers.sql"

failed=0
for test in "$here"/*.test.sql; do
  echo "test: $(basename "$test")"
  if ! out="$("${db[@]}" -f "$test" 2>&1)"; then
    echo "$out" | grep -v '^psql:.*NOTICE:  ok' >&2
    failed=1
  else
    echo "$out" | grep -c 'NOTICE:  ok' | xargs -I{} echo "  {} assertions passed"
  fi
done

if [[ "$failed" != "0" ]]; then
  echo "Database tests FAILED" >&2
  exit 1
fi
echo "Database tests passed"
