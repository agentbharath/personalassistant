-- R17: a bill is a liability until it is paid. Only paid bills become expenses.
create table public.finance_bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  merchant_ciphertext text not null,
  merchant_hash text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  category text not null,
  statement_date date not null,
  due_date date,
  status text not null default 'outstanding' check (status in ('outstanding', 'paid')),
  paid_on date,
  paid_transaction_id uuid references public.finance_transactions(id) on delete set null,
  dedupe_fingerprint text not null,
  source_ref_hmac text,
  payload_ciphertext text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_fingerprint)
);

alter table public.finance_bills enable row level security;

create policy "users manage their bills"
  on public.finance_bills for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index finance_bills_status_idx on public.finance_bills (user_id, status, due_date);

-- R17.6: declared autopay is a learned preference.
alter table public.user_learnings
  drop constraint user_learnings_kind_check,
  add constraint user_learnings_kind_check check (kind in (
    'default_window', 'sender_alias', 'default_action',
    'calendar_duration', 'calendar_buffer',
    'merchant_category', 'merchant_alias', 'autopay'
  ));
