-- Rollback for the app schema migrations:
--   20261001090000_core_tables, 20261001090100_row_level_security, 20261001100000_row_limits
--
-- DESTRUCTIVE: this deletes every row in the app tables (workout days, templates, plans, settings,
-- subscriptions). Browsers keep their own local copies, so users do not lose their data, but the cloud
-- copies are gone. It does not touch auth.users, storage, or anything else.
--
-- Not in supabase/migrations on purpose: the migration runner and the Supabase CLI must never apply it.
-- Run it by hand, only when you mean to undo the schema.

begin;

-- Dropping a table drops its triggers and policies with it.
drop table if exists public.plans         cascade;
drop table if exists public.templates     cascade;
drop table if exists public.workout_days  cascade;
drop table if exists public.user_settings cascade;
drop table if exists public.subscriptions cascade;

drop function if exists public.enforce_row_limit();
drop function if exists public.row_limit(text);
drop function if exists public.set_updated_at();

-- Forget that the migrations were applied, so they can be applied again later.
-- (Harmless if supabase_migrations does not exist or the versions were recorded differently.)
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations
      where version in ('20261001090000', '20261001090100', '20261001100000');
  end if;
end
$$;

commit;
