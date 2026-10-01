-- Plan-aware row limits (plan tiers, slice 2).
--
-- The per-account caps from 20261001100000_row_limits now depend on the plan of the account:
--
--                  Free    Pro
--   workout_days   1,000   5,000   (live days; deleted ones do not count)
--   templates      5       200     (the 4 built-in starters + 1 of your own on Free)
--   plans          20      100
--
-- "Pro" means an active or trialing Pro subscription (the same rule the API uses, api/_lib/subscriptionGuard.hasProAccess).
-- Nothing is ever deleted when an account drops to Free: the check only runs when NEW rows are inserted, so a lapsed Pro
-- account keeps everything it has, can still edit it, and just cannot add beyond the Free caps until it deletes or upgrades.
--
-- enforce_row_limit() becomes SECURITY DEFINER so it can read the plan and count rows whoever performs the write; it is a
-- trigger function (not callable through the API) with a fixed search_path.

create function public.is_pro(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
     where s.user_id = p_user and s.plan = 'pro' and s.status in ('active', 'trialing')
  )
$$;
revoke all on function public.is_pro(uuid) from public, anon, authenticated, service_role;

create function public.row_limit(table_name text, is_pro boolean)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case table_name
    when 'workout_days' then case when is_pro then 5000 else 1000 end
    when 'templates'    then case when is_pro then 200  else 5    end
    when 'plans'        then case when is_pro then 100  else 20   end
  end
$$;

create or replace function public.enforce_row_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  pro boolean;
  cap integer;
  live_only text := case tg_table_name when 'workout_days' then ' and deleted_at is null' else '' end;
  total bigint;
begin
  for owner in select distinct user_id from new_rows order by user_id loop
    perform pg_advisory_xact_lock(hashtextextended(tg_table_name || ':' || owner::text, 0));
    pro := public.is_pro(owner);
    cap := public.row_limit(tg_table_name, pro);
    execute format('select count(*) from public.%I where user_id = $1%s', tg_table_name, live_only)
      into total using owner;
    if total > cap then
      raise exception 'row limit reached for %: at most % per account', tg_table_name, cap
        using errcode = 'PT422',
              hint = case when pro then 'Delete older entries to free space.'
                          else 'Delete older entries to free space, or upgrade to Pro for a higher limit.' end;
    end if;
  end loop;
  return null;
end;
$$;

-- The old one-argument limit function is no longer used by anything.
drop function public.row_limit(text);

-- Restoring a deleted day is an UPDATE (deleted_at back to null), which the insert trigger above never sees. Without this,
-- an account at its cap could delete N days, add N new ones, restore the N deleted ones and repeat: N more live days per
-- cycle, with no ceiling. A restore now counts against the cap exactly like a new day.
create function public.enforce_restore_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  pro boolean;
  cap integer;
  total bigint;
begin
  for owner in
    select distinct n.user_id
      from new_rows n
      join old_rows o on o.user_id = n.user_id and o.day = n.day
     where o.deleted_at is not null and n.deleted_at is null
     order by n.user_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('workout_days:' || owner::text, 0));
    pro := public.is_pro(owner);
    cap := public.row_limit('workout_days', pro);
    select count(*) into total from public.workout_days where user_id = owner and deleted_at is null;
    if total > cap then
      raise exception 'row limit reached for workout_days: at most % per account', cap
        using errcode = 'PT422',
              hint = case when pro then 'Delete older entries to free space.'
                          else 'Delete older entries to free space, or upgrade to Pro for a higher limit.' end;
    end if;
  end loop;
  return null;
end;
$$;

create trigger workout_days_restore_limit
  after update on public.workout_days
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.enforce_restore_limit();
