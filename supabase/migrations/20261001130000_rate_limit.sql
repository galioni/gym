-- Rate limiting in Postgres (Phase 15, slice 4): replaces the Redis counters (`ratelimit:{route}:{user}:{window}`).
--
-- A sliding log: one row per ALLOWED call. A call is allowed when fewer than `max` allowed calls happened in the
-- last `window` seconds. Compared with fixed buckets this gives exact semantics ("1 per 24 hours" really means one
-- per 24 hours, not two across a bucket boundary) and an exact retry-after, which the Free/Pro plan limits need.
--
--   * Refused calls are not recorded, so hammering the button never extends the wait.
--   * Limit and window are arguments: the caller picks them from the user's plan.
--   * A per-user, per-route advisory lock makes check-and-record atomic, so two simultaneous requests cannot both
--     squeeze under the cap.
--   * Only the server (service role) can call the function. Browsers have no access to the table or the function.

create table public.rate_events (
  id      bigint      generated always as identity primary key,
  user_id uuid        not null references auth.users (id) on delete cascade,
  route   text        not null,
  at      timestamptz not null default now(),
  constraint rate_events_route_len check (char_length(route) between 1 and 100)
);
create index rate_events_lookup_idx on public.rate_events (user_id, route, at);
comment on table public.rate_events is 'One row per allowed rate-limited call (sliding log). Server only; purged daily.';

alter table public.rate_events enable row level security;
revoke all on table public.rate_events from anon, authenticated;

create function public.consume_rate_limit(p_user uuid, p_route text, p_max integer, p_window_seconds integer)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
set search_path = ''
as $$
declare
  window_len interval;
  recent integer;
  oldest timestamptz;
begin
  if p_max < 1 or p_window_seconds < 1 or p_window_seconds > 2678400 then
    raise exception 'invalid rate limit: max % per % seconds', p_max, p_window_seconds using errcode = '22023';
  end if;
  window_len := make_interval(secs => p_window_seconds);

  perform pg_advisory_xact_lock(hashtextextended('rate:' || p_route || ':' || p_user::text, 0));

  select count(*), min(e.at) into recent, oldest
    from public.rate_events e
   where e.user_id = p_user and e.route = p_route and e.at > now() - window_len;

  if recent >= p_max then
    -- Free again when the oldest call in the window ages out.
    return query select false, greatest(1, ceil(extract(epoch from (oldest + window_len - now())))::integer);
  else
    insert into public.rate_events (user_id, route) values (p_user, p_route);
    return query select true, 0;
  end if;
end;
$$;

revoke all on function public.consume_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(uuid, text, integer, integer) to service_role;

-- Retention must stay longer than the longest window any caller uses (the plan limits use up to one day).
create function public.purge_rate_events(retention interval default interval '2 days')
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  removed bigint;
begin
  delete from public.rate_events where at < now() - retention;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_rate_events(interval) from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge-rate-events';
    perform cron.schedule('purge-rate-events', '53 3 * * *', 'select public.purge_rate_events()');
    raise notice 'purge-rate-events scheduled daily at 03:53 UTC';
  else
    raise warning 'pg_cron is not available: purge_rate_events() must be scheduled some other way';
  end if;
exception when others then
  raise warning 'could not schedule purge-rate-events (%): schedule public.purge_rate_events() manually', sqlerrm;
end
$$;
