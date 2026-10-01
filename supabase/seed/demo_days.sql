-- Demo data for the LOCAL stack: 28 days of workouts for an account that already exists.
--   npm run gym:seed -- you@example.com
-- Sign up in the app first (the local mail UI is at http://localhost:8026 with `gym:up -- mail`). Idempotent: running it
-- again rewrites the same days. Never run this against a hosted project: it is applied by the local launcher only.
\set ON_ERROR_STOP on

select id as uid from auth.users where lower(email) = lower(:'email') \gset
\if :{?uid}
\else
  do $$ begin raise exception 'No account with that email. Sign up in the local app first.'; end $$;
\endif

insert into public.workout_days (user_id, day, session_type, main, main_notes, weight)
select :'uid'::uuid,
       (current_date - n)::date,
       (array['push', 'pull', 'legs'])[1 + n % 3],
       '[]'::jsonb,
       'Demo day ' || n,
       to_char(80.0 - n * 0.05, 'FM990.0')
  from generate_series(0, 27) as n
 where n % 7 <> 6
on conflict (user_id, day) do update
  set session_type = excluded.session_type, main_notes = excluded.main_notes, weight = excluded.weight, deleted_at = null;

select count(*) as demo_days from public.workout_days where user_id = :'uid'::uuid;
