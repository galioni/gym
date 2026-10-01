-- Billing state in Postgres (Phase 15, slice 1): replaces the three things the Stripe code kept in KV.
--
--   KV key                     now
--   subscription:{userId}      public.subscriptions (already exists; one row per user)
--   stripe_customer:{id}       public.subscriptions.stripe_customer_id, looked up through a unique index
--   stripe_event:{id}          public.stripe_events
--
-- Only the server (service role) writes these. Users may read their own subscription row, as before.

-- The Stripe webhook finds the user from the Stripe customer id. Unique, so one customer can never be attached
-- to two accounts; partial, so the many free users without a customer are not constrained.
create unique index subscriptions_stripe_customer_idx
  on public.subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;

alter table public.subscriptions
  add constraint subscriptions_status_len   check (char_length(status) <= 64),
  add constraint subscriptions_customer_len check (stripe_customer_id is null or char_length(stripe_customer_id) <= 128);

-- Webhook de-duplication: Stripe delivers at least once and retries on any non-2xx, so a processed event id is
-- remembered and the repeat is acknowledged without being applied again.
create table public.stripe_events (
  event_id    text        primary key,
  received_at timestamptz not null default now(),
  constraint stripe_events_id_len check (char_length(event_id) between 1 and 255)
);
create index stripe_events_received_idx on public.stripe_events (received_at);
comment on table public.stripe_events is 'Processed Stripe webhook event ids (de-duplication). Server only: no user can read or write it.';

alter table public.stripe_events enable row level security;
revoke all on table public.stripe_events from anon, authenticated;

-- Stripe retries for at most a few days, so 30 days of ids is far more than needed.
create function public.purge_stripe_events(retention interval default interval '30 days')
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  removed bigint;
begin
  delete from public.stripe_events where received_at < now() - retention;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_stripe_events(interval) from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge-stripe-events';
    perform cron.schedule('purge-stripe-events', '41 3 * * *', 'select public.purge_stripe_events()');
    raise notice 'purge-stripe-events scheduled daily at 03:41 UTC';
  else
    raise warning 'pg_cron is not available: purge_stripe_events() must be scheduled some other way';
  end if;
exception when others then
  raise warning 'could not schedule purge-stripe-events (%): schedule public.purge_stripe_events() manually', sqlerrm;
end
$$;
