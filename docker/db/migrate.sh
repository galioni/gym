#!/bin/sh
# Applies supabase/migrations/*.sql in filename order, once each.
# Applied versions are recorded in supabase_migrations.schema_migrations, the same table the Supabase CLI
# uses, so the identical files can later be pushed to a hosted project with `supabase db push`.
# Each migration and its bookkeeping row commit in one transaction: a failure leaves nothing half-applied.
set -eu

export PGHOST=db PGUSER=postgres PGDATABASE=postgres   # PGPASSWORD comes from the environment

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
