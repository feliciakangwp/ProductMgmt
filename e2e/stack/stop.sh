#!/usr/bin/env bash
# Stops the stack started by e2e/stack/start.sh.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
state="$here/../.stack"
for name in gateway postgrest gotrue; do
  [[ -f "$state/$name.pid" ]] && kill "$(cat "$state/$name.pid")" 2>/dev/null || true
done
PG_BIN="${PG_BIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/pg_ctl 2>/dev/null | sort -V | tail -1)")}"
if [[ -d "$state/pg" ]]; then
  if [[ "$(id -u)" == "0" ]]; then
    su -s /bin/bash nobody -c "$PG_BIN/pg_ctl -D $state/pg -m fast stop" >/dev/null 2>&1 || true
  else
    "$PG_BIN/pg_ctl" -D "$state/pg" -m fast stop >/dev/null 2>&1 || true
  fi
fi
