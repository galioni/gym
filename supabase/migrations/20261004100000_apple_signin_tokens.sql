-- Sign in with Apple: the refresh token Apple gives us when someone signs in with it.
--
-- Apple requires an app that offers Sign in with Apple to REVOKE that token when the person deletes their account
-- (App Store guideline 5.1.1(v)); without the token the revocation cannot be made. It is kept only for that.
--
-- Server only: nobody can read or write it through the API, not even its owner. The service role does (api/apple-token
-- stores it, api/delete-account reads and revokes it). It disappears with the account (on delete cascade).

create table public.apple_auth_tokens (
  user_id       uuid        primary key references auth.users (id) on delete cascade,
  refresh_token text        not null,
  updated_at    timestamptz not null default now(),
  constraint apple_auth_tokens_token_len check (char_length(refresh_token) between 1 and 2048)
);

comment on table public.apple_auth_tokens is 'Apple refresh token per user, kept only to revoke it when the account is deleted. Server only: no policy, no grants.';

alter table public.apple_auth_tokens enable row level security;
revoke all on table public.apple_auth_tokens from anon, authenticated;

create trigger apple_auth_tokens_set_updated_at before insert or update on public.apple_auth_tokens
  for each row execute function public.set_updated_at();
