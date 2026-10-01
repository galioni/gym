-- Free-plan sync allowance (plan tiers, slice 3): a Free account syncs once every 30 days.
--
-- How it works
--   * begin_sync() is called by the app at the start of EVERY sync. For a Pro account it does nothing. For a Free account
--     it opens a 10-minute "sync window" if 30 days have passed since the last one, lets the sync through if a window is
--     open, and otherwise refuses with SQLSTATE PT423 (HTTP 423) and the date the next sync becomes available.
--   * Writes to the synced tables (workout_days, templates, plans, user_settings) are refused with PT423 for a Free
--     account unless its window is open, so a modified app cannot upload outside it. Server-side writes (the service
--     role, e.g. the AI-provider setting, and account deletion) are not affected.
--   * Reads are not refused by the database on purpose: a refused read comes back as "no rows", which the sync could
--     mistake for "everything was deleted" and then remove from the device. Downloads are gated by begin_sync() instead.
--
-- Rollout switch: the allowance ships OFF (flag `sync_allowance`). Turn it on once the app that calls begin_sync() is live:
--     update public.app_flags set enabled = true where name = 'sync_allowance';
-- and the same statement with `false` switches it off again without a deploy.

create table public.app_flags (
  name    text    primary key,
  enabled boolean not null default false,
  constraint app_flags_name_len check (char_length(name) between 1 and 100)
);
comment on table public.app_flags is 'Server-side switches for features that must be rolled out in a given order. Server only.';
alter table public.app_flags enable row level security;
revoke all on table public.app_flags from anon, authenticated;
insert into public.app_flags (name, enabled) values ('sync_allowance', false);

create table public.sync_windows (
  user_id   uuid        primary key references auth.users (id) on delete cascade,
  opened_at timestamptz not null default now()
);
comment on table public.sync_windows is 'When a Free account last opened its sync window. Written only by begin_sync().';
alter table public.sync_windows enable row level security;
revoke all on table public.sync_windows from anon, authenticated;

create function public.sync_allowance_enforced()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select f.enabled from public.app_flags f where f.name = 'sync_allowance'), false)
$$;
revoke all on function public.sync_allowance_enforced() from public, anon, authenticated, service_role;

create function public.sync_window_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sync_windows w where w.user_id = p_user and w.opened_at > now() - interval '10 minutes'
  )
$$;
revoke all on function public.sync_window_active(uuid) from public, anon, authenticated, service_role;

-- Called at the start of every sync.
create function public.begin_sync()
returns table (allowed boolean, window_ends_at timestamptz, next_available_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  opened timestamptz;
begin
  if uid is null then
    raise exception 'sign in to sync' using errcode = '42501';
  end if;
  if not public.sync_allowance_enforced() or public.is_pro(uid) then
    return query select true, null::timestamptz, null::timestamptz;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sync-window:' || uid::text, 0));
  select w.opened_at into opened from public.sync_windows w where w.user_id = uid;

  if opened is not null and opened > now() - interval '10 minutes' then
    return query select true, opened + interval '10 minutes', opened + interval '30 days';
  elsif opened is null or opened <= now() - interval '30 days' then
    insert into public.sync_windows (user_id, opened_at) values (uid, now())
      on conflict (user_id) do update set opened_at = excluded.opened_at;
    return query select true, now() + interval '10 minutes', now() + interval '30 days';
  else
    raise exception 'The Free plan syncs once every 30 days'
      using errcode = 'PT423',
            detail = to_char((opened + interval '30 days') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            hint = 'Upgrade to Pro for automatic, unlimited sync.';
  end if;
end;
$$;
revoke all on function public.begin_sync() from public, anon;
grant execute on function public.begin_sync() to authenticated;

-- What the app shows: can I sync now, and if not, when? Changes nothing.
create function public.sync_allowance()
returns table (enforced boolean, is_pro boolean, window_ends_at timestamptz, next_available_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  opened timestamptz;
  pro boolean;
begin
  if uid is null then
    raise exception 'sign in to sync' using errcode = '42501';
  end if;
  pro := public.is_pro(uid);
  select w.opened_at into opened from public.sync_windows w where w.user_id = uid;
  return query select
    public.sync_allowance_enforced(),
    pro,
    case when opened is not null and opened > now() - interval '10 minutes' then opened + interval '10 minutes' end,
    -- null means "a sync is available now"
    case when pro or opened is null or opened <= now() - interval '30 days' then null else opened + interval '30 days' end;
end;
$$;
revoke all on function public.sync_allowance() from public, anon;
grant execute on function public.sync_allowance() to authenticated;

-- The database-side stop for uploads outside the window.
create function public.enforce_sync_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.sync_allowance_enforced() or public.is_pro(uid) or public.sync_window_active(uid) then
    return null;
  end if;
  raise exception 'The Free plan syncs once every 30 days'
    using errcode = 'PT423', hint = 'Upgrade to Pro for automatic, unlimited sync.';
end;
$$;
revoke all on function public.enforce_sync_window() from public, anon, authenticated, service_role;

create trigger workout_days_sync_window  before insert or update or delete on public.workout_days  for each statement execute function public.enforce_sync_window();
create trigger templates_sync_window     before insert or update or delete on public.templates     for each statement execute function public.enforce_sync_window();
create trigger plans_sync_window         before insert or update or delete on public.plans         for each statement execute function public.enforce_sync_window();
create trigger user_settings_sync_window before insert or update or delete on public.user_settings for each statement execute function public.enforce_sync_window();
