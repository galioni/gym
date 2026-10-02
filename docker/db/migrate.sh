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
for file in /migrations/*.sql; do
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
  psql -v ON_ERROR_STOP=1 -q --single-transaction -f "$file" \
    -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')"
done

[ "$found" = 1 ] || echo "no migrations found in /migrations"
echo "migrations up to date"
