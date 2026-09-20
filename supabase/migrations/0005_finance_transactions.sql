create table public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  occurred_on date not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  direction text not null check (direction in ('expense', 'income')),
  merchant_ciphertext text not null,
  merchant_hash text not null,
  category text not null,
  note_ciphertext text,
  dedupe_fingerprint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_fingerprint)
);

create table public.finance_transaction_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  transaction_id uuid not null references public.finance_transactions(id) on delete restrict,
  source_type text not null check (source_type in ('user_input', 'receipt', 'email')),
  external_ref_hmac text,
  payload_ciphertext text,
  created_at timestamptz not null default now()
);

alter table public.finance_transactions enable row level security;
alter table public.finance_transaction_sources enable row level security;

create policy "users manage their finance transactions"
  on public.finance_transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users manage their finance sources"
  on public.finance_transaction_sources for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index finance_transactions_period_idx
  on public.finance_transactions (user_id, occurred_on desc);

create index finance_transactions_aggregate_idx
  on public.finance_transactions (user_id, category, direction, occurred_on desc);

create index finance_transactions_candidate_idx
  on public.finance_transactions (user_id, amount_minor, currency, occurred_on);

create unique index finance_sources_external_ref_idx
  on public.finance_transaction_sources (user_id, source_type, external_ref_hmac)
  where external_ref_hmac is not null;
