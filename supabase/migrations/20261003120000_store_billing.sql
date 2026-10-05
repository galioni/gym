-- Store billing (App Store / Google Play) alongside Stripe. Additive only: old code that does not know these columns keeps
-- working, because it never writes them and an upsert that omits a column leaves it alone.
--
--   billing_source        who bills this user: 'stripe', 'apple' or 'google' (null = never subscribed)
--   store_transaction_id  Apple: originalTransactionId. Google: the latest purchase token.
--
-- One store purchase can belong to only one account: the unique index below. The server (service role) is the only writer.

alter table public.subscriptions
  add column billing_source       text,
  add column store_transaction_id text,
  add constraint subscriptions_billing_source check (billing_source is null or billing_source in ('stripe', 'apple', 'google')),
  add constraint subscriptions_store_txn_len  check (store_transaction_id is null or char_length(store_transaction_id) <= 1024);

-- Everything that exists today was billed by Stripe.
update public.subscriptions
   set billing_source = 'stripe'
 where stripe_customer_id is not null
   and billing_source is null;

-- Partial, so the many users without a store purchase are not constrained.
create unique index subscriptions_store_txn_idx
  on public.subscriptions (billing_source, store_transaction_id)
  where store_transaction_id is not null;

comment on column public.subscriptions.billing_source is 'stripe | apple | google. Decides where a person manages their subscription.';
comment on column public.subscriptions.store_transaction_id is 'Apple originalTransactionId or Google purchase token; looks the user up when a store notification arrives.';
