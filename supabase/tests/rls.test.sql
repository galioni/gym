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
-- Per-account row limits (20261001100000_row_limits.sql, made plan-aware by 20261001140000_plan_row_limits.sql)
-- ===========================================================================
select gym_test.become_admin();
insert into auth.users (id, email) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c@test.local');
-- C is a Pro account, so the caps asserted below are the Pro caps (5,000 days, 200 templates, 100 plans).
insert into public.subscriptions (user_id, plan, status) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'pro', 'active');

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

-- Restoring a deleted day counts against the cap like a new day (otherwise delete / add / restore cycles grow past it).
select gym_test.expect_error($$update public.workout_days set deleted_at = null where day = '2001-01-03'$$,
  'PT422', 'restoring a deleted day at the cap is refused');
select gym_test.expect_count($$select 1 from public.workout_days where day = '2001-01-03' and deleted_at is not null$$, 1,
  'and the day stays deleted');
select gym_test.expect_affected($$update public.workout_days set deleted_at = now() where day = '2001-01-04'$$, 1, 'deleting another day makes room');
select gym_test.expect_affected($$update public.workout_days set deleted_at = null where day = '2001-01-03'$$, 1, 'so the first deleted day can now be restored');
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '2001-01-03', 'gym')
  on conflict (user_id, day) do update set deleted_at = null$$, 1, 'restoring through an upsert on a live day is a plain update and still works');
select gym_test.expect_error($$insert into public.workout_days (user_id, day, session_type) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '2001-01-04', 'gym')
  on conflict (user_id, day) do update set deleted_at = null$$, 'PT422', 'restoring a deleted day through an upsert at the cap is refused too');

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
-- Free caps, upgrades and downgrades (20261001140000_plan_row_limits.sql)
-- ===========================================================================
select gym_test.become_admin();
insert into auth.users (id, email) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'd@test.local');
select gym_test.expect_count($$select 1 where public.is_pro('dddddddd-dddd-dddd-dddd-dddddddddddd') = false$$, 1, 'an account without a subscription is Free');

-- templates: Free cap 5 (the 4 built-in starters + 1 of your own)
insert into public.templates (user_id, session_type) select 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'tpl-' || n from generate_series(1, 5) n;
select gym_test.become('dddddddd-dddd-dddd-dddd-dddddddddddd');
select gym_test.expect_error($$insert into public.templates (user_id, session_type) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'sixth')$$,
  'PT422', 'a Free account is capped at 5 templates');
select gym_test.expect_affected($$insert into public.templates (user_id, session_type, label) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'tpl-1', 'edited')
  on conflict (user_id, session_type) do update set label = excluded.label$$, 1, 'a Free account at its cap can still edit what it has');

-- plans: Free cap 20
select gym_test.become_admin();
insert into public.plans (user_id, id, label) select 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'p' || n, 'Plan ' || n from generate_series(1, 20) n;
select gym_test.become('dddddddd-dddd-dddd-dddd-dddddddddddd');
select gym_test.expect_error($$insert into public.plans (user_id, id, label) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'extra', 'Extra')$$,
  'PT422', 'a Free account is capped at 20 plans');

-- days: Free cap 1,000 live days
select gym_test.become_admin();
insert into public.workout_days (user_id, day, session_type) select 'dddddddd-dddd-dddd-dddd-dddddddddddd', date '2001-01-01' + n, 'gym' from generate_series(0, 999) n;
select gym_test.become('dddddddd-dddd-dddd-dddd-dddddddddddd');
select gym_test.expect_error($$insert into public.workout_days (user_id, day, session_type) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', '2026-10-09', 'gym')$$,
  'PT422', 'a Free account is capped at 1,000 workout days');

-- The Free message points to Pro; the Pro message does not.
do $$
declare free_hint text; pro_hint text;
begin
  perform gym_test.become('dddddddd-dddd-dddd-dddd-dddddddddddd');
  begin
    insert into public.plans (user_id, id, label) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'extra2', 'Extra');
  exception when others then
    get stacked diagnostics free_hint = pg_exception_hint;
  end;
  perform gym_test.become('cccccccc-cccc-cccc-cccc-cccccccccccc');
  begin
    insert into public.plans (user_id, id, label) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'extra3', 'Extra');
  exception when others then
    get stacked diagnostics pro_hint = pg_exception_hint;
  end;
  reset role;
  if free_hint is null or free_hint not like '%upgrade to Pro%' then raise exception 'FAIL the Free hint should mention Pro, got %', free_hint; end if;
  if pro_hint is null or pro_hint like '%upgrade%' then raise exception 'FAIL the Pro hint should not pitch an upgrade, got %', pro_hint; end if;
  raise notice 'ok   - the Free limit message points to Pro, the Pro one does not';
end $$;

-- Upgrading takes effect immediately.
select gym_test.become_admin();
insert into public.subscriptions (user_id, plan, status) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'pro', 'active');
select gym_test.become('dddddddd-dddd-dddd-dddd-dddddddddddd');
select gym_test.expect_affected($$insert into public.templates (user_id, session_type) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'sixth')$$, 1, 'after upgrading to Pro the sixth template fits');
select gym_test.expect_affected($$insert into public.plans (user_id, id, label) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'twenty-one', 'Plan')$$, 1, 'and so does the 21st plan');

-- A trial counts as Pro.
select gym_test.become_admin();
update public.subscriptions set status = 'trialing' where user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
select gym_test.become('dddddddd-dddd-dddd-dddd-dddddddddddd');
select gym_test.expect_affected($$insert into public.templates (user_id, session_type) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'seventh')$$, 1, 'a trialing subscription has the Pro caps');

-- Dropping to Free (lapsed, past due, or plan set to free) deletes nothing and blocks only NEW rows.
select gym_test.become_admin();
update public.subscriptions set status = 'past_due' where user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
select gym_test.become('dddddddd-dddd-dddd-dddd-dddddddddddd');
select gym_test.expect_error($$insert into public.templates (user_id, session_type) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'eighth')$$,
  'PT422', 'a past-due Pro account is back to the Free caps for new rows');
select gym_test.expect_count($$select 1 from public.templates$$, 7, 'but its 7 templates are all still there');
select gym_test.expect_affected($$update public.templates set label = 'still editable' where session_type = 'seventh'$$, 1,
  'and it can still edit them');
select gym_test.expect_affected($$delete from public.templates where session_type = 'seventh'$$, 1, 'and delete them');
select gym_test.expect_error($$insert into public.templates (user_id, session_type) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'seventh-again')$$,
  'PT422', 'but deleting one does not get it under the Free cap (6 > 5), so new templates are still refused');

select gym_test.become_admin();
update public.subscriptions set plan = 'free', status = 'active' where user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
select gym_test.expect_count($$select 1 where public.is_pro('dddddddd-dddd-dddd-dddd-dddddddddddd') = false$$, 1, 'a subscription whose plan is free is Free even when its status is active');

-- Nobody can ask who is Pro through the API.
select gym_test.become('dddddddd-dddd-dddd-dddd-dddddddddddd');
select gym_test.expect_error($$select public.is_pro('dddddddd-dddd-dddd-dddd-dddddddddddd')$$, '42501', 'a signed-in user cannot call is_pro directly');

-- ===========================================================================
-- Retention of deleted days: content is blanked at deletion, tombstones are purged after 90 days
-- ===========================================================================
select gym_test.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
insert into public.workout_days (user_id, day, session_type, warmup, main, main_notes, check_notes, weight, main_timer_ms)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2027-03-01', 'gym', '[{"text":"x"}]', '[{"text":"squat"}]', 'private note', 'felt ok', '80', 5000);
select gym_test.expect_affected($$update public.workout_days set deleted_at = now(), deleted_hash = 'hash-1' where day = '2027-03-01'$$, 1,
  'a client can soft-delete a day and record its hash');
select gym_test.expect_count($$select 1 from public.workout_days where day = '2027-03-01'
    and warmup = '[]' and main = '[]' and main_notes = '' and check_notes = '' and weight = '' and main_timer_ms = 0
    and deleted_hash = 'hash-1' and session_type = 'gym'$$, 1,
  'deleting a day blanks its content and keeps only the marker and the hash');

select gym_test.expect_affected($$update public.workout_days set main_notes = 'sneaky', main = '[{"text":"x"}]' where day = '2027-03-01'$$, 1,
  'a later write to a deleted day is accepted');
select gym_test.expect_count($$select 1 from public.workout_days where day = '2027-03-01' and main_notes = '' and main = '[]'$$, 1,
  'but a deleted day can never hold content again');

select gym_test.expect_affected($$update public.workout_days set deleted_at = null, main_notes = 'back again' where day = '2027-03-01'$$, 1,
  'a restore writes the day normally');
select gym_test.expect_count($$select 1 from public.workout_days where day = '2027-03-01' and main_notes = 'back again' and deleted_hash is null and deleted_at is null$$, 1,
  'a restored day has its content and no stale hash');

select gym_test.expect_error($$select public.purge_deleted_days()$$, '42501', 'a signed-in user cannot run the purge');
select gym_test.become_anon();
select gym_test.expect_error($$select public.purge_deleted_days()$$, '42501', 'anon cannot run the purge');
select gym_test.become_service();
select gym_test.expect_error($$select public.purge_deleted_days()$$, '42501', 'not even the service role can run the purge through the API');

select gym_test.become_admin();
insert into public.workout_days (user_id, day, session_type, deleted_at, deleted_hash) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2027-03-10', 'gym', now() - interval '100 days', 'old'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2027-03-11', 'gym', now() - interval '89 days',  'recent'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2027-03-10', 'gym', now() - interval '91 days',  'old-b');
insert into public.workout_days (user_id, day, session_type, main_notes) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2027-03-12', 'gym', 'a live day, however old, is never purged');
update public.workout_days set updated_at = now() - interval '400 days' where day = '2027-03-12';
select gym_test.expect_count($$select 1 from public.workout_days where day between '2027-03-10' and '2027-03-12'$$, 4, 'purge fixtures are in place');

do $$
declare removed bigint;
begin
  removed := public.purge_deleted_days();
  if removed <> 2 then raise exception 'FAIL purge should report the 2 tombstones it removed, got %', removed; end if;
  raise notice 'ok   - purge reports how many tombstones it removed';
end $$;
select gym_test.expect_count($$select 1 from public.workout_days where day between '2027-03-10' and '2027-03-12'$$, 2,
  'the purge removed the two tombstones older than 90 days, for every user');
select gym_test.expect_count($$select 1 from public.workout_days where deleted_hash = 'recent'$$, 1, 'a tombstone younger than 90 days is kept');
select gym_test.expect_count($$select 1 from public.workout_days where main_notes like 'a live day%'$$, 1, 'live days are never purged');
do $$
declare removed bigint;
begin
  removed := public.purge_deleted_days(interval '1 day');
  if removed <> 1 then raise exception 'FAIL a 1-day retention should remove the 89-day-old tombstone, got %', removed; end if;
  raise notice 'ok   - the retention period is a parameter';
end $$;
select gym_test.expect_count($$select 1 from public.workout_days where deleted_hash = 'recent'$$, 0, 'a shorter period purges more');

-- ===========================================================================
-- Billing state: subscriptions are looked up by Stripe customer; webhook events are de-duplicated server-side
-- ===========================================================================
select gym_test.become_admin();
-- A already has a subscription (customer cus_test) from the service-role test above.
select gym_test.expect_error($$insert into public.subscriptions (user_id, stripe_customer_id) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cus_test')$$,
  '23505', 'one Stripe customer cannot be attached to two accounts');
insert into public.subscriptions (user_id) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select gym_test.expect_count($$select 1 from (select count(*) as n from public.subscriptions where stripe_customer_id is null) q where n >= 2$$, 1,
  'many users without a Stripe customer are allowed');

select gym_test.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select gym_test.expect_count($$select 1 from public.subscriptions$$, 1, 'a user reads only their own subscription');
select gym_test.expect_error($$select * from public.stripe_events$$, '42501', 'a signed-in user cannot read webhook events');
select gym_test.expect_error($$insert into public.stripe_events (event_id) values ('evt_user')$$, '42501', 'a signed-in user cannot write webhook events');
select gym_test.become_anon();
select gym_test.expect_error($$select * from public.stripe_events$$, '42501', 'anon cannot read webhook events');

select gym_test.become_service();
insert into public.stripe_events (event_id) values ('evt_new');
select gym_test.expect_error($$insert into public.stripe_events (event_id) values ('evt_new')$$, '23505', 'a repeated event id is detected');
select gym_test.expect_count($$select 1 from public.stripe_events$$, 1, 'the server can record and read webhook events');
select gym_test.expect_error($$select public.purge_stripe_events()$$, '42501', 'the service role cannot run the event purge through the API');

select gym_test.become_admin();
insert into public.stripe_events (event_id, received_at) values ('evt_old', now() - interval '40 days'), ('evt_recent', now() - interval '29 days');
do $$
declare removed bigint;
begin
  removed := public.purge_stripe_events();
  if removed <> 1 then raise exception 'FAIL the event purge should remove only the 40-day-old id, removed %', removed; end if;
  raise notice 'ok   - the event purge removes ids older than 30 days';
end $$;
select gym_test.expect_count($$select 1 from public.stripe_events where event_id in ('evt_new', 'evt_recent')$$, 2, 'newer event ids are kept');

-- ===========================================================================
-- Rate limiting: sliding log, atomic, server only
-- ===========================================================================
select gym_test.become_service();
do $$
declare r record;
begin
  select * into r from public.consume_rate_limit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'gen', 2, 3600);
  if not r.allowed then raise exception 'FAIL first call must be allowed'; end if;
  select * into r from public.consume_rate_limit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'gen', 2, 3600);
  if not r.allowed then raise exception 'FAIL second call must be allowed'; end if;
  select * into r from public.consume_rate_limit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'gen', 2, 3600);
  if r.allowed or r.retry_after_seconds not between 3590 and 3600 then
    raise exception 'FAIL third call must be refused with ~1h retry, got % / %', r.allowed, r.retry_after_seconds;
  end if;
  raise notice 'ok   - two calls allowed, the third refused with an exact retry-after';
end $$;
select gym_test.expect_count($$select 1 from public.rate_events where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and route = 'gen'$$, 2,
  'refused calls are not recorded');
do $$
declare r record;
begin
  select * into r from public.consume_rate_limit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'other-route', 2, 3600);
  if not r.allowed then raise exception 'FAIL another route has its own allowance'; end if;
  select * into r from public.consume_rate_limit('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'gen', 2, 3600);
  if not r.allowed then raise exception 'FAIL another user has their own allowance'; end if;
  raise notice 'ok   - routes and users are limited independently';
end $$;

-- Exactness: a single old call decides when the next one is allowed.
select gym_test.become_admin();
insert into public.rate_events (user_id, route, at) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'daily', now() - interval '50 minutes');
select gym_test.become_service();
do $$
declare r record;
begin
  select * into r from public.consume_rate_limit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'daily', 1, 3600);
  if r.allowed or r.retry_after_seconds not between 590 and 610 then
    raise exception 'FAIL a call 50 minutes ago blocks a 1-per-hour limit for ~10 more minutes, got % / %', r.allowed, r.retry_after_seconds;
  end if;
  select * into r from public.consume_rate_limit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'daily', 1, 86400);
  if r.allowed or r.retry_after_seconds not between 86400 - 3000 - 10 and 86400 - 3000 + 10 then
    raise exception 'FAIL the same call blocks a 1-per-day limit for ~23h10m, got % / %', r.allowed, r.retry_after_seconds;
  end if;
  raise notice 'ok   - the window is sliding: the same call is old enough for one limit and not for another';
end $$;
select gym_test.become_admin();
update public.rate_events set at = now() - interval '2 hours' where route = 'daily';
select gym_test.become_service();
do $$
declare r record;
begin
  select * into r from public.consume_rate_limit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'daily', 1, 3600);
  if not r.allowed then raise exception 'FAIL a call older than the window no longer counts'; end if;
  raise notice 'ok   - calls older than the window stop counting';
end $$;

select gym_test.expect_error($$select * from public.consume_rate_limit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bad', 0, 60)$$, '22023', 'a limit of zero is rejected');
select gym_test.expect_error($$select * from public.consume_rate_limit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bad', 1, 0)$$, '22023', 'a zero-length window is rejected');

select gym_test.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select gym_test.expect_error($$select * from public.consume_rate_limit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'gen', 100, 60)$$, '42501', 'a signed-in user cannot call the limiter (they could only grant themselves allowance)');
select gym_test.expect_error($$select * from public.rate_events$$, '42501', 'a signed-in user cannot read rate events');
select gym_test.become_anon();
select gym_test.expect_error($$select * from public.consume_rate_limit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'gen', 100, 60)$$, '42501', 'anon cannot call the limiter');
select gym_test.become_service();
select gym_test.expect_error($$select public.purge_rate_events()$$, '42501', 'the service role cannot run the purge through the API');

select gym_test.become_admin();
insert into public.rate_events (user_id, route, at) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'purge-old', now() - interval '3 days'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'purge-new', now() - interval '1 day');
do $$
declare removed bigint;
begin
  removed := public.purge_rate_events();
  if removed <> 1 then raise exception 'FAIL the purge should remove only the 3-day-old event, removed %', removed; end if;
  raise notice 'ok   - the purge removes events older than 2 days and keeps the rest';
end $$;
select gym_test.expect_count($$select 1 from public.rate_events where route = 'purge-new'$$, 1, 'a one-day-old event survives the purge (the longest plan window is a day)');

-- ===========================================================================
-- Free-plan sync allowance (20261001150000_sync_allowance.sql): one upload window per 30 days
-- ===========================================================================
select gym_test.become_admin();
insert into auth.users (id, email) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'e@test.local');

-- begin_sync() as a user, returning its row, so the tests can look at the dates.
create function gym_test.begin_as(uid uuid) returns table (allowed boolean, window_ends_at timestamptz, next_available_at timestamptz)
language plpgsql as $$
begin
  perform gym_test.become(uid);
  return query select * from public.begin_sync();
  perform gym_test.become_admin();
end $$;

-- Put a user's last window "age" ago (run as admin).
create function gym_test.set_window(uid uuid, age interval) returns void language sql as $$
  insert into public.sync_windows (user_id, opened_at) values (uid, now() - age)
  on conflict (user_id) do update set opened_at = excluded.opened_at
$$;

-- The switch ships OFF: until the app that calls begin_sync() is live, nothing changes for anyone.
select gym_test.expect_count($$select 1 where public.sync_allowance_enforced() = false$$, 1, 'the allowance ships switched off');
select gym_test.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '2026-12-01', 'gym')$$, 1,
  'switched off: a Free account writes without a window');
do $$
declare r record;
begin
  select * into r from gym_test.begin_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
  if not r.allowed or r.window_ends_at is not null then raise exception 'FAIL switched off, begin_sync should allow with no window, got %', r; end if;
  raise notice 'ok   - switched off: begin_sync allows the sync and records nothing';
end $$;
select gym_test.expect_count($$select 1 from public.sync_windows where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'$$, 0, 'switched off: no window is recorded');

-- Switch it on.
select gym_test.become_admin();
update public.app_flags set enabled = true where name = 'sync_allowance';

-- A sync that only checks (or only downloads) spends nothing: the month is spent by the first upload.
do $$
declare r record;
begin
  select * into r from gym_test.begin_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
  if not r.allowed or r.window_ends_at is not null or r.next_available_at is not null then raise exception 'FAIL begin_sync with no window used should simply allow, got %', r; end if;
  raise notice 'ok   - begin_sync alone is allowed and spends nothing';
end $$;
select gym_test.expect_count($$select 1 from public.sync_windows where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'$$, 0, 'and opens no window');

-- The first upload opens the window...
select gym_test.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '2026-12-02', 'gym')$$, 1,
  'the first upload of a Free account is allowed');
select gym_test.become_admin();
select gym_test.expect_count($$select 1 from public.sync_windows where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' and opened_at >= now() - interval '1 minute'$$, 1,
  'and it opens the 10-minute window');

-- ...and everything inside it is the same sync.
select gym_test.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
select gym_test.expect_affected($$insert into public.templates (user_id, session_type) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'tpl')$$, 1, 'inside the window templates are written too');
select gym_test.expect_affected($$insert into public.plans (user_id, id, label) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'p', 'P')$$, 1, 'and plans');
select gym_test.expect_affected($$insert into public.user_settings (user_id, active_plan_id) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'p')$$, 1, 'and the account settings');
select gym_test.expect_affected($$update public.workout_days set main_notes = 'synced' where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'$$, 2, 'and edits');
select gym_test.expect_affected($$delete from public.workout_days where day = '2026-12-02'$$, 1, 'and deletes');
do $$
declare r record;
begin
  select * into r from gym_test.begin_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
  if not r.allowed or r.window_ends_at not between now() + interval '9 minutes' and now() + interval '11 minutes' then raise exception 'FAIL inside the window begin_sync reports it closing in ~10 minutes, got %', r; end if;
  if r.next_available_at not between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour' then raise exception 'FAIL the next sync is ~30 days after the window opened, got %', r.next_available_at; end if;
  raise notice 'ok   - inside the window begin_sync allows the same sync and reports when it closes and when the next opens';
end $$;

-- After the window, within the 30 days: refused everywhere, with the date.
select gym_test.become_admin();
select gym_test.set_window('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', interval '11 minutes');
select gym_test.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
select gym_test.expect_error($$insert into public.workout_days (user_id, day, session_type) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '2026-12-03', 'gym')$$, 'PT423', 'once the window has closed uploads are refused');
select gym_test.expect_error($$update public.workout_days set main_notes = 'x' where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'$$, 'PT423', 'edits too');
select gym_test.expect_error($$delete from public.workout_days where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'$$, 'PT423', 'and deletes');
select gym_test.expect_error($$insert into public.templates (user_id, session_type) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'tpl2')$$, 'PT423', 'templates are gated too');
select gym_test.expect_error($$insert into public.plans (user_id, id, label) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'p2', 'P')$$, 'PT423', 'plans are gated too');
select gym_test.expect_error($$update public.user_settings set active_plan_id = 'q' where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'$$, 'PT423', 'and the account settings');
select gym_test.expect_count($$select 1 from public.workout_days where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'$$, 1, 'but reading is never refused by the database (a refused read would look like an empty account)');
do $$
declare detail text; hint text; code text; next_at timestamptz;
begin
  perform gym_test.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
  begin
    perform * from public.begin_sync();
  exception when others then
    get stacked diagnostics detail = pg_exception_detail, hint = pg_exception_hint;
    code := sqlstate;
  end;
  perform gym_test.become_admin();
  if code is distinct from 'PT423' then raise exception 'FAIL expected PT423, got %', code; end if;
  next_at := detail::timestamptz;
  if next_at not between now() + interval '29 days' and now() + interval '30 days' then raise exception 'FAIL the refusal names the next date, got %', detail; end if;
  if hint not like '%Pro%' then raise exception 'FAIL the refusal points to Pro, got %', hint; end if;
  raise notice 'ok   - begin_sync refuses inside the 30 days and names the date the next sync opens';
end $$;
do $$
declare detail text;
begin
  perform gym_test.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
  begin
    insert into public.workout_days (user_id, day, session_type) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '2026-12-03', 'gym');
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
  end;
  perform gym_test.become_admin();
  if detail is null or detail::timestamptz not between now() + interval '29 days' and now() + interval '30 days' then raise exception 'FAIL a refused upload also names the date, got %', detail; end if;
  raise notice 'ok   - a refused upload names the date too';
end $$;

-- sync_allowance() for the UI.
do $$
declare r record;
begin
  perform gym_test.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
  select * into r from public.sync_allowance();
  perform gym_test.become_admin();
  if not r.enforced or r.is_pro or r.window_ends_at is not null or r.next_available_at is null then raise exception 'FAIL status while waiting, got %', r; end if;
  raise notice 'ok   - sync_allowance reports the wait without changing anything';
end $$;
select gym_test.expect_count($$select 1 from public.sync_windows where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' and opened_at < now() - interval '10 minutes'$$, 1, 'and the status call did not touch the window');

-- Thirty days later: a sync is available again, and the next upload opens a new window.
select gym_test.set_window('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', interval '31 days');
do $$
declare r record;
begin
  select * into r from gym_test.begin_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
  if not r.allowed or r.next_available_at is not null then raise exception 'FAIL 31 days later a sync is available, got %', r; end if;
  raise notice 'ok   - after 30 days a sync is available again';
end $$;
select gym_test.expect_count($$select 1 from public.sync_windows where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' and opened_at < now() - interval '30 days'$$, 1, 'and checking did not open a window');
select gym_test.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '2026-12-04', 'gym')$$, 1, 'the next upload is allowed');
select gym_test.become_admin();
select gym_test.expect_count($$select 1 from public.sync_windows where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' and opened_at >= now() - interval '1 minute'$$, 1, 'and opens a new window');

-- Pro is never limited; the service role is not affected; another account has its own allowance.
select gym_test.set_window('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', interval '2 days');
select gym_test.set_window('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', interval '2 days');
select gym_test.become_service();
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '2026-12-05', 'gym')$$, 1, 'server-side writes (service role) are not gated');
select gym_test.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select gym_test.expect_error($$insert into public.workout_days (user_id, day, session_type) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-12-06', 'gym')$$, 'PT423', 'another Free account whose window is used is refused independently');
select gym_test.become_admin();
insert into public.subscriptions (user_id, plan, status) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'pro', 'active');
select gym_test.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '2026-12-06', 'gym')$$, 1, 'a Pro account writes with no window');
do $$
declare r record;
begin
  select * into r from gym_test.begin_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
  if not r.allowed or r.next_available_at is not null then raise exception 'FAIL Pro is never limited, got %', r; end if;
  raise notice 'ok   - begin_sync never limits a Pro account';
end $$;

-- Nobody but the app's own calls: no table access, no helper functions, anon cannot even ask.
select gym_test.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select gym_test.expect_error($$select * from public.sync_windows$$, '42501', 'a user cannot read the window table');
select gym_test.expect_error($$insert into public.sync_windows (user_id) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$, '42501', 'nor grant themselves a window');
select gym_test.expect_error($$select * from public.app_flags$$, '42501', 'nor read the switches');
select gym_test.expect_error($$select public.sync_window_active('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$, '42501', 'nor call the window helper');
select gym_test.become_anon();
select gym_test.expect_error($$select * from public.begin_sync()$$, '42501', 'anon cannot begin a sync');
select gym_test.expect_error($$select * from public.sync_allowance()$$, '42501', 'or read the allowance');

-- Kill switch.
select gym_test.become_admin();
update public.app_flags set enabled = false where name = 'sync_allowance';
select gym_test.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-12-06', 'gym')$$, 1, 'switching it off lifts the limit at once, without a deploy');
select gym_test.become_admin();
-- Leave B as the later assertions expect it.
delete from public.workout_days where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and day = '2026-12-06';

-- ===========================================================================
-- Free-plan history window (20261001160000_free_history_window.sql): 7 days in the cloud
-- ===========================================================================
select gym_test.become_admin();
insert into auth.users (id, email) values ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'f@test.local'), ('99999999-9999-9999-9999-999999999999', 'g@test.local'), ('88888888-8888-8888-8888-888888888888', 'h@test.local');
-- G is Pro now; H used to be Pro (a Stripe customer on file, subscription cancelled).
insert into public.subscriptions (user_id, plan, status, stripe_customer_id) values ('99999999-9999-9999-9999-999999999999', 'pro', 'active', 'cus_g'), ('88888888-8888-8888-8888-888888888888', 'free', 'canceled', 'cus_h');
insert into public.workout_days (user_id, day, session_type) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', current_date - 40, 'gym'), ('ffffffff-ffff-ffff-ffff-ffffffffffff', current_date - 3, 'gym'),
  ('99999999-9999-9999-9999-999999999999', current_date - 40, 'gym'), ('88888888-8888-8888-8888-888888888888', current_date - 40, 'gym');

select gym_test.expect_count($$select 1 where public.free_history_window_enforced() = false$$, 1, 'the history window ships switched off');
select gym_test.become('ffffffff-ffff-ffff-ffff-ffffffffffff');
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type) values ('ffffffff-ffff-ffff-ffff-ffffffffffff', current_date - 20, 'gym')$$, 1,
  'switched off: a Free account can still write an old day');
select gym_test.become_admin();
select gym_test.expect_count($$select 1 where public.purge_free_history() = 0$$, 1, 'switched off: the purge removes nothing');

update public.app_flags set enabled = true where name = 'free_history_window';

select gym_test.become('ffffffff-ffff-ffff-ffff-ffffffffffff');
select gym_test.expect_error($$insert into public.workout_days (user_id, day, session_type) values ('ffffffff-ffff-ffff-ffff-ffffffffffff', current_date - 30, 'gym')$$, 'PT424', 'a Free account cannot add a day older than the window');
select gym_test.expect_error($$update public.workout_days set main_notes = 'x' where day = current_date - 40$$, 'PT424', 'nor edit one');
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type) values ('ffffffff-ffff-ffff-ffff-ffffffffffff', current_date, 'gym')$$, 1, 'today is accepted');
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type) values ('ffffffff-ffff-ffff-ffff-ffffffffffff', current_date - 6, 'gym')$$, 1, 'the oldest day of the window is accepted');
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type) values ('ffffffff-ffff-ffff-ffff-ffffffffffff', current_date - 9, 'gym')$$, 1, 'the slack for time zones is accepted');
select gym_test.expect_count($$select 1 from public.workout_days where day = current_date - 40$$, 1, 'old days can still be read');
select gym_test.become('99999999-9999-9999-9999-999999999999');
select gym_test.expect_affected($$update public.workout_days set main_notes = 'pro' where day = current_date - 40$$, 1, 'Pro keeps all history');
select gym_test.become_admin();
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type) values ('ffffffff-ffff-ffff-ffff-ffffffffffff', current_date - 100, 'gym')$$, 1, 'server-side writes (no signed-in user) are not refused');
select gym_test.expect_affected($$delete from public.workout_days where user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' and day = current_date - 100$$, 1, 'clean up that row');

do $$
declare removed bigint;
begin
  removed := public.purge_free_history();
  -- The purge covers every Free account in the database, including the other test users, so the total is not asserted:
  -- it must have removed at least F's two old days (40 and 20 days), and the checks below look at F, G and H by name.
  if removed < 2 then raise exception 'FAIL the purge should remove at least F''s two old days, removed %', removed; end if;
  raise notice 'ok   - the purge removes a Free account''s days older than 10 days';
end $$;
select gym_test.expect_count($$select 1 from public.workout_days where user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' and day < current_date - 10$$, 0, 'the Free account has no day older than 10 days left');
select gym_test.expect_count($$select 1 from public.workout_days where user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'$$, 4, 'recent days of the Free account survive the purge');
select gym_test.expect_count($$select 1 from public.workout_days where user_id in ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888') and day = current_date - 40$$, 2, 'Pro and ex-Pro accounts keep their old days');

update public.app_flags set enabled = false where name = 'free_history_window';
select gym_test.become('ffffffff-ffff-ffff-ffff-ffffffffffff');
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type) values ('ffffffff-ffff-ffff-ffff-ffffffffffff', current_date - 50, 'gym')$$, 1, 'switching it off lifts the refusal at once');
select gym_test.become_admin();
delete from auth.users where id in ('ffffffff-ffff-ffff-ffff-ffffffffffff', '99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888');

-- ===========================================================================
-- Realtime sync signal (20261001170000_realtime_sync_signal.sql): one "changed" message per user per statement
-- ===========================================================================
select gym_test.become_admin();
insert into auth.users (id, email) values ('77777777-7777-7777-7777-777777777777', 'j@test.local'), ('66666666-6666-6666-6666-666666666666', 'k@test.local');

-- Realtime is not installed in the local stack: stand in for it, recording what would have been sent.
create schema if not exists realtime;
grant usage on schema realtime to public;
create table gym_test.sent (topic text, event text, payload jsonb);
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
language sql security definer as $$ insert into gym_test.sent values (topic, event, payload) $$;

select gym_test.expect_count($$select 1 where public.realtime_sync_enabled() = false$$, 1, 'the realtime signal ships switched off');
insert into public.workout_days (user_id, day, session_type) values ('77777777-7777-7777-7777-777777777777', current_date, 'gym');
select gym_test.expect_count($$select 1 from gym_test.sent$$, 0, 'switched off: nothing is sent');

update public.app_flags set enabled = true where name = 'realtime_sync';

-- One statement, three rows, one user: one message, on that user's own channel, carrying no row data.
insert into public.workout_days (user_id, day, session_type) select '77777777-7777-7777-7777-777777777777', current_date - n, 'gym' from generate_series(1, 3) n;
select gym_test.expect_count($$select 1 from gym_test.sent where topic = 'sync:77777777-7777-7777-7777-777777777777' and event = 'changed' and payload = '{"table": "workout_days"}'::jsonb$$, 1,
  'a three-row insert sends one message to the owner''s channel');
select gym_test.expect_count($$select 1 from gym_test.sent$$, 1, 'and nothing else');

-- One statement touching two users: one message each.
delete from gym_test.sent;
insert into public.templates (user_id, session_type) values ('77777777-7777-7777-7777-777777777777', 'tpl-a'), ('66666666-6666-6666-6666-666666666666', 'tpl-b');
select gym_test.expect_count($$select 1 from gym_test.sent where topic in ('sync:77777777-7777-7777-7777-777777777777', 'sync:66666666-6666-6666-6666-666666666666')$$, 2, 'a statement across two users signals each of them once');

-- Updates and deletes signal too, and a user's own writes (through the API role) do as well.
delete from gym_test.sent;
select gym_test.become('77777777-7777-7777-7777-777777777777');
update public.workout_days set main_notes = 'x' where day = current_date;
delete from public.templates where session_type = 'tpl-a';
select gym_test.become_admin();
select gym_test.expect_count($$select 1 from gym_test.sent where topic = 'sync:77777777-7777-7777-7777-777777777777'$$, 2, 'an update and a delete by the user each signal once');
select gym_test.expect_count($$select 1 from gym_test.sent where topic like '%66666666%'$$, 0, 'and the other user hears nothing about it');

-- A statement that changes no rows sends nothing.
delete from gym_test.sent;
update public.workout_days set main_notes = 'y' where day = current_date + 1000;
select gym_test.expect_count($$select 1 from gym_test.sent$$, 0, 'no rows changed, no message');

-- Realtime failing must never fail the write.
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
language plpgsql as $$ begin raise exception 'realtime is down'; end $$;
select gym_test.become('77777777-7777-7777-7777-777777777777');
select gym_test.expect_affected($$insert into public.workout_days (user_id, day, session_type) values ('77777777-7777-7777-7777-777777777777', current_date - 30, 'gym')$$, 1, 'a failing send does not fail the write');
select gym_test.expect_error($$select public.signal_sync_change()$$, '42501', 'a signed-in user cannot call the signal function');
select gym_test.become_admin();

update public.app_flags set enabled = false where name = 'realtime_sync';
delete from auth.users where id in ('77777777-7777-7777-7777-777777777777', '66666666-6666-6666-6666-666666666666');

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
  union all select 1 from public.subscriptions where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  union all select 1 from public.rate_events where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$, 0,
  'deleting a user removes all of their rows');
select gym_test.expect_count($$select 1 from public.workout_days where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$, 1,
  'other users'' data is untouched by that deletion');

do $$ begin raise notice 'ALL DATABASE TESTS PASSED'; end $$;
rollback;
