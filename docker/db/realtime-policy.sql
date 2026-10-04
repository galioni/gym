-- After Realtime has created its `realtime` schema: let a signed-in user listen to their own sync channel, and nothing else.
--
-- This is the same policy migration 20261001170000_realtime_sync_signal.sql creates, but that migration only creates it when
-- realtime.messages already exists, so on a database that was migrated BEFORE Realtime was ever started (an existing local
-- volume) it was skipped. Run by `npm run gym:up -- realtime`; idempotent, and a no-op where the migration already did it.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    drop policy if exists "users hear their own sync signal" on realtime.messages;
    create policy "users hear their own sync signal" on realtime.messages
      for select to authenticated
      using (realtime.topic() = 'sync:' || (select auth.uid())::text and realtime.messages.extension = 'broadcast');
    raise notice 'realtime listening policy in place';
  else
    raise warning 'realtime.messages does not exist yet: is the realtime service healthy?';
  end if;
end
$$;
