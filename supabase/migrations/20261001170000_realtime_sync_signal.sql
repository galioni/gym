-- Realtime sync signal: tell a user's other devices "something changed, sync now", instead of waiting for the 5-minute poll.
--
-- How it works
--   * After every INSERT / UPDATE / DELETE statement on the four synced tables, one tiny message is sent on the private
--     channel `sync:<user id>` through Supabase Realtime Broadcast (realtime.send). The message carries NO row data: it only
--     says "changed", and the app answers by running its normal sync. Realtime is a hint; the 5-minute poll and the focus
--     and reconnect triggers stay as the fallback, so a missed message only delays a sync.
--   * Why not Postgres Changes: DELETE events are not filtered by row level security, so every subscriber would receive the
--     primary key (user id, template name) of other users' deletes. A per-user private channel leaks nothing.
--   * Only the owner can listen: a policy on realtime.messages lets a signed-in user receive messages whose topic is their own.
--   * One message per user per statement (statement triggers with transition tables), not one per row.
--   * A failure to send NEVER fails the write: the send is wrapped, and where Realtime is not installed (the local Docker
--     stack) nothing happens at all.
--
-- Rollout switch: ships OFF (flag `realtime_sync`). Turn on after the app that listens is live:
--     update public.app_flags set enabled = true where name = 'realtime_sync';
-- and the same with `false` stops all sending without a deploy.

insert into public.app_flags (name, enabled) values ('realtime_sync', false);

create function public.realtime_sync_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select f.enabled from public.app_flags f where f.name = 'realtime_sync'), false)
$$;
revoke all on function public.realtime_sync_enabled() from public, anon, authenticated, service_role;

-- Runs after a statement on a synced table. The transition table is always named `changed` (see the triggers below).
create function public.signal_sync_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  if not public.realtime_sync_enabled() then
    return null;
  end if;
  begin
    for uid in select distinct c.user_id from changed c loop
      perform realtime.send(jsonb_build_object('table', tg_table_name), 'changed', 'sync:' || uid::text, true);
    end loop;
  exception when others then
    -- Realtime missing or unhappy: the write that caused this has already succeeded and must stay that way.
    null;
  end;
  return null;
end;
$$;
revoke all on function public.signal_sync_change() from public, anon, authenticated, service_role;

-- Transition tables allow only one event per trigger, so each table gets three.
do $$
declare
  t text;
begin
  foreach t in array array['workout_days', 'templates', 'plans', 'user_settings'] loop
    execute format('create trigger %I after insert on public.%I referencing new table as changed for each statement execute function public.signal_sync_change()', t || '_signal_insert', t);
    execute format('create trigger %I after update on public.%I referencing new table as changed for each statement execute function public.signal_sync_change()', t || '_signal_update', t);
    execute format('create trigger %I after delete on public.%I referencing old table as changed for each statement execute function public.signal_sync_change()', t || '_signal_delete', t);
  end loop;
end
$$;

-- A signed-in user may listen to their own channel and nothing else. realtime.messages exists on hosted Supabase; on the
-- local stack (no Realtime service) there is nothing to authorise and this is skipped.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    drop policy if exists "users hear their own sync signal" on realtime.messages;
    create policy "users hear their own sync signal" on realtime.messages
      for select to authenticated
      using (realtime.topic() = 'sync:' || (select auth.uid())::text and realtime.messages.extension = 'broadcast');
  else
    raise notice 'realtime.messages not found: the listening policy was not created (expected on the local stack)';
  end if;
exception when others then
  raise warning 'could not create the realtime listening policy (%): create it by hand before enabling the flag', sqlerrm;
end
$$;
