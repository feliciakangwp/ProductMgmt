#!/usr/bin/env bash
# Starts a local Supabase-compatible stack without Docker:
#   PostgreSQL (local binaries) + GoTrue (auth) + PostgREST + a small gateway,
# applies supabase/migrations, and writes the connection settings to
# e2e/.stack/env. Used by the end-to-end tests; also handy for development on
# machines without Docker. Stop it with e2e/stack/stop.sh.
#
# For normal development prefer the Supabase CLI (`supabase start`), see docs/SETUP.md.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
cache="$root/e2e/.cache"
state="$root/e2e/.stack"
POSTGREST_VERSION="v12.2.3"
GOTRUE_VERSION="v2.170.0"
PG_PORT="${PG_PORT:-54330}"
JWT_SECRET="${JWT_SECRET:-productflow-local-jwt-secret-at-least-32-chars}"

PG_BIN="${PG_BIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/pg_ctl 2>/dev/null | sort -V | tail -1)")}"
[[ -x "$PG_BIN/initdb" ]] || { echo "PostgreSQL server binaries not found; set PG_BIN" >&2; exit 1; }

mkdir -p "$cache" "$state"
if [[ ! -x "$cache/postgrest" ]]; then
  echo "Downloading PostgREST $POSTGREST_VERSION…"
  curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-linux-static-x64.tar.xz" | tar -xJ -C "$cache"
fi
if [[ ! -x "$cache/gotrue/auth" ]]; then
  echo "Downloading GoTrue $GOTRUE_VERSION…"
  mkdir -p "$cache/gotrue"
  curl -fsSL "https://github.com/supabase/auth/releases/download/$GOTRUE_VERSION/auth-$GOTRUE_VERSION-x86.tar.gz" | tar -xz -C "$cache/gotrue"
fi

"$here/stop.sh" >/dev/null 2>&1 || true
rm -rf "$state" && mkdir -p "$state"

run() { "$@"; }
if [[ "$(id -u)" == "0" ]]; then
  chmod 777 "$state"
  run() { su -s /bin/bash nobody -c "$(printf '%q ' "$@")"; }
fi

run "$PG_BIN/initdb" -D "$state/pg" -U postgres -A trust >/dev/null
run "$PG_BIN/pg_ctl" -D "$state/pg" -o "-p $PG_PORT -k $state -c listen_addresses=127.0.0.1" -l "$state/postgres.log" -w start >/dev/null
psql=("$PG_BIN/psql" -h 127.0.0.1 -p "$PG_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${psql[@]}" -f "$here/bootstrap.sql"

eval "$(node "$here/keys.mjs" "$JWT_SECRET")"

(
  cd "$cache/gotrue"
  GOTRUE_DB_DRIVER=postgres \
  DATABASE_URL="postgres://supabase_auth_admin:supabase_auth_admin@127.0.0.1:$PG_PORT/postgres?sslmode=disable" \
  DB_NAMESPACE=auth \
  GOTRUE_API_HOST=127.0.0.1 PORT=9999 \
  API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1 \
  GOTRUE_SITE_URL=http://localhost:5173 \
  GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
  GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role \
  GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_DISABLE_SIGNUP=false \
  GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_LOG_LEVEL=warn \
  nohup ./auth > "$state/gotrue.log" 2>&1 &
  echo $! > "$state/gotrue.pid"
)

for _ in $(seq 1 60); do
  if curl -fs http://127.0.0.1:9999/health >/dev/null 2>&1; then break; fi
  sleep 0.5
done
curl -fs http://127.0.0.1:9999/health >/dev/null || { cat "$state/gotrue.log" >&2; exit 1; }

"${psql[@]}" -f "$here/post-auth.sql"
for migration in "$root"/supabase/migrations/*.sql; do
  "${psql[@]}" -f "$migration"
done

cat > "$state/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:authenticator@127.0.0.1:$PG_PORT/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = 3000
CONF
nohup "$cache/postgrest" "$state/postgrest.conf" > "$state/postgrest.log" 2>&1 &
echo $! > "$state/postgrest.pid"

nohup node "$here/gateway.mjs" > "$state/gateway.log" 2>&1 &
echo $! > "$state/gateway.pid"

for _ in $(seq 1 60); do
  if curl -fs -H "apikey: $ANON_KEY" -H "authorization: Bearer $ANON_KEY" http://127.0.0.1:54321/rest/v1/ >/dev/null 2>&1; then break; fi
  sleep 0.5
done

cat > "$state/env" <<ENV
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
PG_PORT=$PG_PORT
ENV
echo "Local stack ready: http://127.0.0.1:54321 (settings in e2e/.stack/env)"
