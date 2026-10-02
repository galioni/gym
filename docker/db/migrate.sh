#!/bin/sh
# Applies supabase/migrations/*.sql in filename order, once each.
# Applied versions are recorded in supabase_migrations.schema_migrations, the same table the Supabase CLI
# uses, so the identical files can later be pushed to a hosted project with `supabase db push`.
# Each migration and its bookkeeping row commit in one transaction: a failure leaves nothing half-applied.
set -eu

export PGHOST=db PGUSER=postgres PGDATABASE=postgres   # PGPASSWORD comes from the environment

# The first migration references auth.users, which the auth service (GoTrue) creates when it first starts, at the same time as
# this container. Wait for it, so a slow auth start cannot fail a from-scratch run.
waited=0
until [ -n "$(psql -tA -c "select to_regclass('auth.users')")" ]; do
  waited=$((waited + 1))
  if [ "$waited" -gt 60 ]; then
    echo "auth.users did not appear within 60s: is the auth service running?" >&2
    exit 1
  fi
  sleep 1
done

psql -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
SQL

found=0
MIGRATIONS_DIR=${MIGRATIONS_DIR:-/migrations}
for file in "$MIGRATIONS_DIR"/*.sql; do
  [ -e "$file" ] || continue
  found=1
  base=$(basename "$file" .sql)
  version=${base%%_*}
  name=${base#*_}

  if [ -n "$(psql -tA -c "select 1 from supabase_migrations.schema_migrations where version = '$version'")" ]; then
    echo "skip   $base"
    continue
  fi

  echo "apply  $base"
  # GoTrue (the auth service) runs its own migrations on auth.* at the same moment on a first start, and the two can
  # deadlock on locks over auth.users. Postgres then aborts ours. Each migration is one transaction, so running it again
  # is safe: retry a deadlock a few times, and fail at once on any other error.
  attempt=1
  while :; do
    if psql -v ON_ERROR_STOP=1 -q --single-transaction -f "$file" \
      -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')" 2>/tmp/migrate.err; then
      cat /tmp/migrate.err >&2
      break
    fi
    cat /tmp/migrate.err >&2
    if grep -q "deadlock detected" /tmp/migrate.err && [ "$attempt" -lt 6 ]; then
      echo "retry  $base (deadlock with the auth service's own migrations, attempt $attempt)"
      attempt=$((attempt + 1))
      sleep 2
      continue
    fi
    exit 3
  done
done

[ "$found" = 1 ] || echo "no migrations found in $MIGRATIONS_DIR"
echo "migrations up to date"
