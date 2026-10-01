-- Free-plan history window (plan tiers, slice 4): the cloud keeps the last 7 days of workout history for a Free account.
--
-- The app already uploads only the last 7 days (today and the six before). This is the database side:
--   * a row trigger refuses a Free account's INSERT/UPDATE of a workout day older than 9 days (PT424). The app's window is
--     7 days; the extra 2 days absorb time zones and a clock a day off, so an honest client is never refused.
--   * purge_free_history() removes cloud days older than 10 days for accounts that are not Pro and never were (no Stripe
--     customer on file), daily. Nothing on the device is touched, and mergeWorkoutDays never deletes a day that is merely
--     absent from the cloud, so the device keeps its history.
--   * Accounts that used to be Pro keep their cloud days: a Stripe customer id means they paid once, and the plan says
--     nothing is deleted when Pro ends. Their old rows can be read but, on Free, not added to.
--
-- Rollout switch: ships OFF (flag `free_history_window`). Turn it on once the app that limits its own uploads is live,
-- otherwise an older app would get refusals it does not understand:
--     update public.app_flags set enabled = true where name = 'free_history_window';
-- and the same statement with `false` switches both the refusal and the purge off again without a deploy.

insert into public.app_flags (name, enabled) values ('free_history_window', false);

create function public.free_history_window_enforced()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select f.enabled from public.app_flags f where f.name = 'free_history_window'), false)
$$;
revoke all on function public.free_history_window_enforced() from public, anon, authenticated, service_role;

create function public.enforce_free_history_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  -- Signed-in users only: server-side writes (service role, account deletion) have no auth.uid() and are not affected.
  if uid is null or not public.free_history_window_enforced() or new.day >= current_date - 9 or public.is_pro(uid) then
    return new;
  end if;
  raise exception 'The Free plan keeps the last 7 days in the cloud'
    using errcode = 'PT424',
          detail = to_char(current_date - 9, 'YYYY-MM-DD'),
          hint = 'Older days stay on your device. Upgrade to Pro to keep all your history in the cloud.';
end;
$$;
revoke all on function public.enforce_free_history_window() from public, anon, authenticated, service_role;

create trigger workout_days_free_history
  before insert or update on public.workout_days
  for each row execute function public.enforce_free_history_window();

-- Daily purge. Callable only by the database owner and by the scheduler, never through the REST API.
create function public.purge_free_history(keep_days integer default 10)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  removed bigint;
begin
  if not public.free_history_window_enforced() then
    return 0;
  end if;
  delete from public.workout_days d
   where d.day < current_date - keep_days
     and not public.is_pro(d.user_id)
     and not exists (
       select 1 from public.subscriptions s where s.user_id = d.user_id and s.stripe_customer_id is not null
     );
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.purge_free_history(integer) from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge-free-history';
    perform cron.schedule('purge-free-history', '27 3 * * *', 'select public.purge_free_history()');
    raise notice 'purge-free-history scheduled daily at 03:27 UTC';
  else
    raise warning 'pg_cron is not available: purge_free_history() must be scheduled some other way';
  end if;
exception when others then
  raise warning 'could not schedule purge-free-history (%): schedule public.purge_free_history() manually', sqlerrm;
end
$$;
