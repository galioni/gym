-- Before Realtime first starts: the schema it keeps its own bookkeeping in. (The Supabase CLI normally creates this; the plain
-- Postgres image does not.) Idempotent. Run by `npm run gym:up -- realtime`, as supabase_admin.
create schema if not exists _realtime;
alter schema _realtime owner to supabase_admin;
