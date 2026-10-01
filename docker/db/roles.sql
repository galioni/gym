-- Runs once, on first initialisation of the Postgres volume (mounted into the Supabase image's
-- /docker-entrypoint-initdb.d/init-scripts, which the Supabase CLI normally provides).
-- The image creates these login roles without passwords; GoTrue and PostgREST connect as them.
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER ROLE authenticator WITH PASSWORD :'pgpass';
ALTER ROLE supabase_auth_admin WITH PASSWORD :'pgpass';
