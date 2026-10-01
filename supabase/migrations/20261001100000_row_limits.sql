-- Per-account row limits.
--
-- The browser writes straight to Postgres, so there is no API layer to stop one account from storing an
-- unbounded number of rows. Field sizes are already capped (see core_tables); this caps the row counts.
--
-- Design notes
--   * One statement-level AFTER INSERT trigger per table, using a transition table: a sync upserts up to 200
--     rows per request and this counts once per affected user per statement, not once per row.
--   * Only genuinely new rows fire it. Updates, and upserts that hit an existing row, never count, so an
--     account at its limit can still edit; deleting frees room.
--   * A per-user advisory lock serialises concurrent inserts, so two requests cannot both squeeze under the cap.
--   * workout_days counts live rows only (soft-deleted days are bounded anyway by the primary key and the
--     2000-2100 date range). templates and plans are hard-deleted by the app, so every row counts there,
--     which also stops a client from hiding rows behind deleted_at.
--   * The error is SQLSTATE PT422, which PostgREST returns as HTTP 422 with {"code":"PT422"}; the client keys
--     off that code to show a clear message instead of retrying.
--
-- To change a limit, replace row_limit() in a new migration.

create function public.row_limit(table_name text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case table_name
    when 'workout_days' then 5000
    when 'templates'    then 200
    when 'plans'        then 100
  end
$$;

create function public.enforce_row_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  owner uuid;
  cap integer := public.row_limit(tg_table_name);
  live_only text := case tg_table_name when 'workout_days' then ' and deleted_at is null' else '' end;
  total bigint;
begin
  for owner in select distinct user_id from new_rows order by user_id loop
    perform pg_advisory_xact_lock(hashtextextended(tg_table_name || ':' || owner::text, 0));
    execute format('select count(*) from public.%I where user_id = $1%s', tg_table_name, live_only)
      into total using owner;
    if total > cap then
      raise exception 'row limit reached for %: at most % per account', tg_table_name, cap
        using errcode = 'PT422', hint = 'Delete older entries to free space.';
    end if;
  end loop;
  return null;
end;
$$;

create trigger workout_days_row_limit after insert on public.workout_days
  referencing new table as new_rows for each statement execute function public.enforce_row_limit();
create trigger templates_row_limit after insert on public.templates
  referencing new table as new_rows for each statement execute function public.enforce_row_limit();
create trigger plans_row_limit after insert on public.plans
  referencing new table as new_rows for each statement execute function public.enforce_row_limit();
