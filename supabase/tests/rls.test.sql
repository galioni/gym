-- Database tests: row level security, grants, constraints and triggers.
-- Run with `npm run gym:test-db`. Everything happens in one transaction that is rolled back at the end,
-- so nothing persists. A failed assertion raises, psql stops (ON_ERROR_STOP) and the exit code is non-zero.
--
-- Roles are switched with SET LOCAL ROLE and a forged JWT claim, which is exactly what PostgREST does
-- for a real request, so auth.uid() and the policies see what they would see in production.

begin;

create schema gym_test;
grant usage on schema gym_test to anon, authenticated, service_role;

create function gym_test.become(uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function gym_test.become_anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end $$;

create function gym_test.become_service() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;

create function gym_test.become_admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Statement must fail with exactly this SQLSTATE (42501 = insufficient privilege / RLS, 23514 = check, 23505 = unique).
create function gym_test.expect_error(stmt text, expected text, label text) returns void language plpgsql as $$
declare ok boolean := false;
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = expected then
      ok := true;
    else
      raise exception 'FAIL % : expected SQLSTATE % but got % (%)', label, expected, sqlstate, sqlerrm;
    end if;
  end;
  if not ok then
    raise exception 'FAIL % : expected SQLSTATE % but the statement succeeded', label, expected;
  end if;
  raise notice 'ok   - %', label;
end $$;

create function gym_test.expect_count(q text, expected bigint, label text) returns void language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from (%s) q', q) into n;
  if n is distinct from expected then
    raise exception 'FAIL % : expected % rows, got %', label, expected, n;
  end if;
  raise notice 'ok   - %', label;
end $$;

create function gym_test.expect_affected(stmt text, expected bigint, label text) returns void language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  if n is distinct from expected then
    raise exception 'FAIL % : expected % rows affected, got %', label, expected, n;
  end if;
  raise notice 'ok   - %', label;
end $$;

-- Two users.
select gym_test.become_admin();
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@test.local'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@test.local');

-- ===========================================================================
-- Guards that apply to every future migration
-- ===========================================================================
select gym_test.expect_count($$select 1 from pg_tables where schemaname = 'public' and not rowsecurity$$, 0,
  'every public table has RLS enabled');
select gym_test.expect_count($$select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'$$, 0,
  'anon holds no grants on public tables');

-- ===========================================================================
-- workout_days
-- ===========================================================================
select gym_test.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
insert into public.workout_days (user_id, day, session_type, main_notes)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-01', 'gym', 'A secret');
select gym_test.expect_count($$select 1 from public.workout_days$$, 1, 'A can insert and read their own day');
select gym_test.expect_error($$insert into public.workout_days (user_id, day, session_type) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-10-02', 'gym')$$,
  '42501', 'A cannot insert a row owned by B');
select gym_test.expect_error($$update public.workout_days set user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  '42501', 'A cannot hand their row to B');

select gym_test.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select gym_test.expect_count($$select 1 from public.workout_days$$, 0, 'B cannot read A''s days');
select gym_test.expect_affected($$update public.workout_days set main_notes = 'hacked'$$, 0, 'B cannot update A''s days');
select gym_test.expect_affected($$delete from public.workout_days$$, 0, 'B cannot delete A''s days');
insert into public.workout_days (user_id, day, session_type)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-10-01', 'swim');
select gym_test.expect_count($$select 1 from public.workout_days$$, 1, 'B can use the same calendar day independently');

select gym_test.become_admin();
select gym_test.expect_count($$select 1 from public.workout_days where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and main_notes = 'A secret'$$, 1,
  'A''s row is intact after B''s attempts');

select gym_test.become_anon();
select gym_test.expect_error($$select * from public.workout_days$$, '42501', 'anon cannot read workout_days');
select gym_test.expect_error($$insert into public.workout_days (user_id, day, session_type) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-05', 'gym')$$,
  '42501', 'anon cannot write workout_days');

-- Upsert path used by sync (insert ... on conflict do update) and server-owned timestamps.
select gym_test.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type, main_notes, updated_at)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-01', 'gym', 'A edited', '2001-01-01')
  on conflict (user_id, day) do update set main_notes = excluded.main_notes, updated_at = excluded.updated_at$$, 1,
  'upsert on (user_id, day) updates the existing row');
select gym_test.expect_count($$select 1 from public.workout_days where main_notes = 'A edited' and updated_at = now()$$, 1,
  'client-supplied updated_at is ignored (server owns the sync cursor)');
select gym_test.expect_affected($$update public.workout_days set deleted_at = now()$$, 1, 'tombstoning a day is an ordinary update');
select gym_test.expect_count($$select 1 from public.workout_days where deleted_at is not null$$, 1, 'tombstoned rows stay readable so deletes can sync');

-- Data-shape constraints.
select gym_test.expect_error($$insert into public.workout_days (user_id, day, session_type, warmup) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-11-01', 'gym', '{"not":"an array"}')$$,
  '23514', 'warmup must be a json array');
select gym_test.expect_error($$insert into public.workout_days (user_id, day, session_type, main_notes) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-11-02', 'gym', repeat('x', 20001))$$,
  '23514', 'notes are capped at 20000 characters');
select gym_test.expect_error($$insert into public.workout_days (user_id, day, session_type) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '1999-12-31', 'gym')$$,
  '23514', 'days before 2000 are rejected');
select gym_test.expect_error($$insert into public.workout_days (user_id, day, session_type) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-11-03', '')$$,
  '23514', 'session type cannot be empty');
select gym_test.expect_error($$insert into public.workout_days (user_id, day, session_type, main_timer_ms) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-11-04', 'gym', -1)$$,
  '23514', 'timers cannot be negative');

-- ===========================================================================
-- templates, plans, user_settings: same isolation, plus their own shapes
-- ===========================================================================
select gym_test.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
insert into public.templates (user_id, session_type, label, source, position)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'push', 'Push day', 'user', 1);
insert into public.plans (user_id, id, label, session_ids, schedule)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'plan-1', 'Strength block', '["push"]', '{"0":"push"}');
insert into public.user_settings (user_id, ai_provider, active_plan_id)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'google', 'plan-1');
select gym_test.expect_error($$insert into public.templates (user_id, session_type, source) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bad', 'robot')$$,
  '23514', 'template source must be ai or user');
select gym_test.expect_error($$insert into public.plans (user_id, id, label, schedule) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'p2', 'x', '["not","an","object"]')$$,
  '23514', 'plan schedule must be an object');
select gym_test.expect_error($$update public.user_settings set ai_provider = 'bard'$$,
  '23514', 'ai_provider is restricted to known providers');
select gym_test.expect_error($$insert into public.user_settings (user_id) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  '23505', 'at most one settings row per user');

select gym_test.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select gym_test.expect_count($$select 1 from public.templates$$, 0, 'B cannot read A''s templates');
select gym_test.expect_count($$select 1 from public.plans$$, 0, 'B cannot read A''s plans');
select gym_test.expect_count($$select 1 from public.user_settings$$, 0, 'B cannot read A''s settings');
select gym_test.expect_error($$insert into public.user_settings (user_id, ai_provider) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'openai')$$,
  '42501', 'B cannot write settings for A');

-- ===========================================================================
-- subscriptions: readable by the owner, writable only by the server
-- ===========================================================================
select gym_test.become_service();
insert into public.subscriptions (user_id, plan, status, stripe_customer_id)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pro', 'active', 'cus_test');
select gym_test.expect_count($$select 1 from public.subscriptions$$, 1, 'service role can write and read subscriptions');

select gym_test.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select gym_test.expect_count($$select 1 from public.subscriptions where plan = 'pro'$$, 1, 'A can read their own subscription');
select gym_test.expect_error($$update public.subscriptions set plan = 'free'$$, '42501', 'A cannot modify their subscription');
select gym_test.expect_error($$insert into public.subscriptions (user_id, plan) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pro')$$,
  '42501', 'A cannot grant themselves Pro');
select gym_test.expect_error($$delete from public.subscriptions$$, '42501', 'A cannot delete their subscription');

select gym_test.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select gym_test.expect_count($$select 1 from public.subscriptions$$, 0, 'B cannot read A''s subscription');

select gym_test.become_anon();
select gym_test.expect_error($$select * from public.subscriptions$$, '42501', 'anon cannot read subscriptions');

-- ===========================================================================
-- Per-account row limits (20261001100000_row_limits.sql)
-- ===========================================================================
select gym_test.become_admin();
insert into auth.users (id, email) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c@test.local');

-- workout_days: fill account C to exactly the cap (5000 live days) using bulk inserts.
insert into public.workout_days (user_id, day, session_type)
  select 'cccccccc-cccc-cccc-cccc-cccccccccccc', date '2001-01-01' + n, 'gym' from generate_series(0, 4999) n;
select gym_test.expect_count($$select 1 from public.workout_days where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$, 5000, 'C holds exactly the day cap');

select gym_test.become('cccccccc-cccc-cccc-cccc-cccccccccccc');
select gym_test.expect_error($$insert into public.workout_days (user_id, day, session_type) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '2026-10-09', 'gym')$$,
  'PT422', 'a new day beyond the cap is rejected with the limit code');
select gym_test.expect_affected($$update public.workout_days set main_notes = 'still editable' where day = '2001-01-01'$$, 1,
  'an account at its cap can still edit existing days');
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type, main_notes)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '2001-01-02', 'gym', 'upserted') on conflict (user_id, day) do update set main_notes = excluded.main_notes$$, 1,
  'upserting an existing day at the cap still works (it is an update, not a new row)');

-- Deleting frees room: soft-delete one day, then a batch of two new days must fail atomically, one must fit.
select gym_test.expect_affected($$update public.workout_days set deleted_at = now() where day = '2001-01-03'$$, 1, 'C soft-deletes a day');
select gym_test.expect_error($$insert into public.workout_days (user_id, day, session_type)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '2026-10-10', 'gym'), ('cccccccc-cccc-cccc-cccc-cccccccccccc', '2026-10-11', 'gym')$$,
  'PT422', 'a batch that would cross the cap is rejected');
select gym_test.expect_count($$select 1 from public.workout_days where day in ('2026-10-10', '2026-10-11')$$, 0,
  'and none of that batch was stored (the statement is atomic)');
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '2026-10-10', 'gym')$$, 1,
  'the freed slot can be used');
select gym_test.expect_error($$insert into public.workout_days (user_id, day, session_type) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '2026-10-11', 'gym')$$,
  'PT422', 'and the cap holds again afterwards');

-- Another account is unaffected by C being full.
select gym_test.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-10-20', 'gym')$$, 1,
  'a different account is not affected by C reaching its cap');
delete from public.workout_days where day = '2026-10-20';  -- leave B as the later assertions expect

-- templates: cap 200, every row counts (no soft-delete escape hatch).
select gym_test.become_admin();
insert into public.templates (user_id, session_type)
  select 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'tpl-' || n from generate_series(1, 200) n;
select gym_test.become('cccccccc-cccc-cccc-cccc-cccccccccccc');
select gym_test.expect_error($$insert into public.templates (user_id, session_type) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'one-too-many')$$,
  'PT422', 'templates are capped at 200 per account');
select gym_test.expect_affected($$insert into public.templates (user_id, session_type, label) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'tpl-1', 'renamed')
  on conflict (user_id, session_type) do update set label = excluded.label$$, 1, 'updating an existing template at the cap works');
select gym_test.expect_affected($$update public.templates set deleted_at = now() where session_type = 'tpl-2'$$, 1, 'C marks a template deleted');
select gym_test.expect_error($$insert into public.templates (user_id, session_type) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'one-too-many')$$,
  'PT422', 'hiding rows behind deleted_at does not create room for templates');
select gym_test.expect_affected($$delete from public.templates where session_type = 'tpl-2'$$, 1, 'a real delete does');
select gym_test.expect_affected($$insert into public.templates (user_id, session_type) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'now-it-fits')$$, 1, 'and then a new template fits');

-- plans: cap 100.
select gym_test.become_admin();
insert into public.plans (user_id, id, label)
  select 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'p' || n, 'Plan ' || n from generate_series(1, 100) n;
select gym_test.become('cccccccc-cccc-cccc-cccc-cccccccccccc');
select gym_test.expect_error($$insert into public.plans (user_id, id, label) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'extra', 'Extra')$$,
  'PT422', 'plans are capped at 100 per account');

-- The limit message tells the user what to do.
do $$
declare msg text; hint text;
begin
  perform gym_test.become('cccccccc-cccc-cccc-cccc-cccccccccccc');
  begin
    insert into public.plans (user_id, id, label) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'extra2', 'Extra');
  exception when others then
    get stacked diagnostics msg = message_text, hint = pg_exception_hint;
  end;
  reset role;
  if msg is null or msg not like 'row limit reached for plans%' or hint is null then
    raise exception 'FAIL limit error is not actionable: % / %', msg, hint;
  end if;
  raise notice 'ok   - the limit error names the table and the limit, with a hint';
end $$;

-- ===========================================================================
-- Account deletion cascades to all user data
-- ===========================================================================
select gym_test.become_admin();
delete from auth.users where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select gym_test.expect_count($$
  select 1 from public.workout_days where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  union all select 1 from public.templates where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  union all select 1 from public.plans where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  union all select 1 from public.user_settings where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  union all select 1 from public.subscriptions where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$, 0,
  'deleting a user removes all of their rows');
select gym_test.expect_count($$select 1 from public.workout_days where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$, 1,
  'other users'' data is untouched by that deletion');

do $$ begin raise notice 'ALL DATABASE TESTS PASSED'; end $$;
rollback;
