-- Retention for deleted workout days (owner decision: 90 days).
--
-- A deleted day stays in the table as a tombstone so the deletion can reach every device. Two rules keep that
-- from becoming a place where deleted personal notes live on:
--
--   1. The moment a day is soft-deleted, its content is blanked. Only the marker stays: (user_id, day,
--      session_type, deleted_at) plus `deleted_hash`.
--   2. Tombstones older than 90 days are erased by a daily job. A device that was offline for longer than
--      that may bring such a day back when it reconnects; that is the accepted trade-off of a time limit.
--
-- Why `deleted_hash`: the sync decides whether a deletion applies to another device by comparing a hash of the
-- deleted content with that device's copy (see application/sync/deletionReconciliation.ts). With the content
-- gone the hash cannot be recomputed, so the client stores it on the row when it deletes the day.
-- Rows without one (not expected, the tables were empty) fall back to hashing their content on the client.

alter table public.workout_days
  add column deleted_hash text,
  add constraint workout_days_deleted_hash_len check (deleted_hash is null or char_length(deleted_hash) <= 128);

comment on column public.workout_days.deleted_hash is
  'Content hash the day had when it was deleted (set by the client); lets deletions sync after the content is blanked.';

-- Blank on every write that leaves the row deleted, not only on the transition: a deleted row never holds content,
-- whatever the client sends. A restore (deleted_at set back to null) writes its content normally.
create function public.blank_deleted_day()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.deleted_at is not null then
    new.warmup := '[]'::jsonb;
    new.main := '[]'::jsonb;
    new.warmup_notes := '';
    new.main_notes := '';
    new.check_notes := '';
    new.weight := '';
    new.warmup_timer_ms := 0;
    new.main_timer_ms := 0;
  else
    new.deleted_hash := null;
  end if;
  return new;
end;
$$;

create trigger workout_days_blank_deleted
  before insert or update on public.workout_days
  for each row execute function public.blank_deleted_day();

-- Daily purge. Callable only by the database owner and by the scheduler, never through the REST API.
create function public.purge_deleted_days(retention interval default interval '90 days')
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  removed bigint;
begin
  delete from public.workout_days
   where deleted_at is not null
     and deleted_at < now() - retention;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_deleted_days(interval) from public, anon, authenticated, service_role;
revoke all on function public.blank_deleted_day() from public, anon, authenticated, service_role;

-- Schedule it where pg_cron exists (hosted Supabase; the local image may not preload it). The function above is
-- the part that matters and is tested directly; if scheduling cannot happen here, say so loudly instead of silently.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge-deleted-days';
    perform cron.schedule('purge-deleted-days', '17 3 * * *', 'select public.purge_deleted_days()');
    raise notice 'purge-deleted-days scheduled daily at 03:17 UTC';
  else
    raise warning 'pg_cron is not available: purge_deleted_days() must be scheduled some other way';
  end if;
exception when others then
  raise warning 'could not schedule purge-deleted-days (%): schedule public.purge_deleted_days() manually', sqlerrm;
end
$$;
