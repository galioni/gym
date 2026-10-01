-- App schema, part 2: row level security and grants.
--
-- Supabase's default privileges hand every new public table to anon, authenticated and service_role, so
-- the first step is to take everything back and grant only what each role needs. RLS then decides *which*
-- rows. `(select auth.uid())` (rather than a bare auth.uid()) lets Postgres evaluate it once per query.

do $$
declare
  t text;
begin
  -- User-owned data: an authenticated user has full CRUD on their own rows and nothing else.
  foreach t in array array['workout_days', 'templates', 'plans', 'user_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);

    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
                   t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
                   t || '_insert_own', t);
    -- WITH CHECK stops a user re-assigning their row to someone else.
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
                   t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))',
                   t || '_delete_own', t);
  end loop;
end
$$;

-- Billing state: readable by its owner, writable only by the server (service_role bypasses RLS).
alter table public.subscriptions enable row level security;
revoke all on table public.subscriptions from anon, authenticated;
grant select on table public.subscriptions to authenticated;
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
