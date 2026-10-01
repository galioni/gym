-- App schema, part 1: tables, constraints, indexes, updated_at trigger.
--
-- Model: every user-owned table is keyed by (user_id, natural key) so a row is the unit of sync and merge.
-- `updated_at` is owned by the server (trigger) and is the sync cursor; `deleted_at` is a tombstone so
-- deletions propagate to other devices. Exercise lists stay jsonb: they are always read and written with
-- their parent row and never queried across rows.

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Clients cannot set or backdate this: it is the ordering the sync protocol relies on.
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- workout_days: one row per user per calendar day (DayData)
-- ---------------------------------------------------------------------------
create table public.workout_days (
  user_id         uuid        not null references auth.users (id) on delete cascade,
  day             date        not null,
  session_type    text        not null,
  warmup          jsonb       not null default '[]'::jsonb,
  main            jsonb       not null default '[]'::jsonb,
  warmup_notes    text        not null default '',
  main_notes      text        not null default '',
  warmup_timer_ms integer     not null default 0,
  main_timer_ms   integer     not null default 0,
  weight          text        not null default '',   -- free text as typed (e.g. "79,5"); parsed by the client
  check_notes     text        not null default '',
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  primary key (user_id, day),
  constraint workout_days_day_range     check (day between date '2000-01-01' and date '2100-12-31'),
  constraint workout_days_session_type  check (char_length(session_type) between 1 and 100),
  constraint workout_days_warmup_shape  check (jsonb_typeof(warmup) = 'array' and jsonb_array_length(warmup) <= 200 and octet_length(warmup::text) <= 200000),
  constraint workout_days_main_shape    check (jsonb_typeof(main) = 'array' and jsonb_array_length(main) <= 200 and octet_length(main::text) <= 200000),
  constraint workout_days_notes_len     check (char_length(warmup_notes) <= 20000 and char_length(main_notes) <= 20000 and char_length(check_notes) <= 20000),
  constraint workout_days_weight_len    check (char_length(weight) <= 32),
  constraint workout_days_timers        check (warmup_timer_ms between 0 and 86400000 and main_timer_ms between 0 and 86400000)
);
create index workout_days_user_updated_idx on public.workout_days (user_id, updated_at);
comment on table public.workout_days is 'One row per user per day (client type DayData). Synced per row; last write wins per day.';

-- ---------------------------------------------------------------------------
-- templates: one row per user per session type (TemplateData)
-- ---------------------------------------------------------------------------
create table public.templates (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  session_type text        not null,
  label        text,
  focus        text,
  source       text,
  video_url    text,
  warmup       jsonb       not null default '[]'::jsonb,
  main         jsonb       not null default '[]'::jsonb,
  position     integer     not null default 0,       -- order of the session list in the UI
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  primary key (user_id, session_type),
  constraint templates_session_type check (char_length(session_type) between 1 and 100),
  constraint templates_label_len    check (label is null or char_length(label) <= 200),
  constraint templates_focus_len    check (focus is null or char_length(focus) <= 500),
  constraint templates_video_len    check (video_url is null or char_length(video_url) <= 2000),
  constraint templates_source       check (source is null or source in ('ai', 'user')),
  constraint templates_warmup_shape check (jsonb_typeof(warmup) = 'array' and jsonb_array_length(warmup) <= 200 and octet_length(warmup::text) <= 200000),
  constraint templates_main_shape   check (jsonb_typeof(main) = 'array' and jsonb_array_length(main) <= 200 and octet_length(main::text) <= 200000),
  constraint templates_position     check (position between 0 and 10000)
);
create index templates_user_updated_idx on public.templates (user_id, updated_at);
comment on table public.templates is 'Session templates (client type TemplateData), one row per session type.';

-- ---------------------------------------------------------------------------
-- plans: named groups of session types (Plan)
-- ---------------------------------------------------------------------------
create table public.plans (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  id          text        not null,                 -- client-generated id
  label       text        not null,
  session_ids jsonb       not null default '[]'::jsonb,
  schedule    jsonb,                                -- optional {"0": "<session type>", ... "6": ...}, 0 = Monday
  position    integer     not null default 0,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  primary key (user_id, id),
  constraint plans_id_len       check (char_length(id) between 1 and 100),
  constraint plans_label_len    check (char_length(label) between 1 and 200),
  constraint plans_sessions     check (jsonb_typeof(session_ids) = 'array' and jsonb_array_length(session_ids) <= 200),
  constraint plans_schedule     check (schedule is null or (jsonb_typeof(schedule) = 'object' and octet_length(schedule::text) <= 4000)),
  constraint plans_position     check (position between 0 and 10000)
);
create index plans_user_updated_idx on public.plans (user_id, updated_at);
comment on table public.plans is 'Training plans (client type Plan). Sessions are referenced by session type, not owned.';

-- ---------------------------------------------------------------------------
-- user_settings: one row per user
-- ---------------------------------------------------------------------------
create table public.user_settings (
  user_id        uuid        primary key references auth.users (id) on delete cascade,
  ai_provider    text,
  active_plan_id text,
  plan_params    jsonb,                              -- PlanParams used to generate the plan
  plan_meta      jsonb,                              -- GeneratedPlanMeta
  onboarded_at   timestamptz,
  updated_at     timestamptz not null default now(),
  constraint user_settings_ai_provider check (ai_provider is null or ai_provider in ('google', 'anthropic', 'openai')),
  constraint user_settings_plan_id     check (active_plan_id is null or char_length(active_plan_id) between 1 and 100),
  constraint user_settings_params      check (plan_params is null or (jsonb_typeof(plan_params) = 'object' and octet_length(plan_params::text) <= 10000)),
  constraint user_settings_meta        check (plan_meta is null or (jsonb_typeof(plan_meta) = 'object' and octet_length(plan_meta::text) <= 20000))
);
comment on table public.user_settings is 'Per-user preferences that are not workout data (replaces KV user_settings:{id} and several localStorage keys).';

-- ---------------------------------------------------------------------------
-- subscriptions: billing state, written only by the server (Stripe webhook)
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  user_id            uuid        primary key references auth.users (id) on delete cascade,
  plan               text        not null default 'free',
  status             text        not null default 'inactive',
  stripe_customer_id text,
  current_period_end timestamptz,
  updated_at         timestamptz not null default now(),
  constraint subscriptions_plan check (plan in ('free', 'pro'))
);
comment on table public.subscriptions is 'Billing state (replaces KV subscription:{id}). Users may read their own row; only the service role writes.';

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create trigger workout_days_set_updated_at  before insert or update on public.workout_days  for each row execute function public.set_updated_at();
create trigger templates_set_updated_at     before insert or update on public.templates     for each row execute function public.set_updated_at();
create trigger plans_set_updated_at         before insert or update on public.plans         for each row execute function public.set_updated_at();
create trigger user_settings_set_updated_at before insert or update on public.user_settings for each row execute function public.set_updated_at();
create trigger subscriptions_set_updated_at before insert or update on public.subscriptions for each row execute function public.set_updated_at();
