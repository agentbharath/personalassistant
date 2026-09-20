-- Per-conversation email context (R5.7): the last structured request and its top results, encrypted.
alter table public.conversations
  add column email_state_ciphertext text;

-- Per-user learned corrections (R11.4): default windows and sender aliases, encrypted.
create table public.user_learnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('default_window', 'sender_alias')),
  key_hmac text not null,
  value_ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, key_hmac)
);

alter table public.user_learnings enable row level security;

create policy "users manage their learnings"
  on public.user_learnings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index user_learnings_user_idx on public.user_learnings (user_id, kind);
