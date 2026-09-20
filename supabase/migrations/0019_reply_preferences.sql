-- R27: which kinds of waiting mail the owner wants to be reminded about (person, business, invitation).
-- No row means the owner has not chosen yet, and the card asks.

create table public.reply_preferences (
  user_id uuid primary key references auth.users(id) on delete restrict,
  kinds text[] not null check (kinds <@ array['person', 'business', 'invitation']),
  updated_at timestamptz not null default now()
);

alter table public.reply_preferences enable row level security;

create policy "users manage their reply preferences"
  on public.reply_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
