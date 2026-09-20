-- Pinning, custom titles, and per-answer feedback.
alter table public.conversations
  add column pinned_at timestamptz,
  add column title_custom boolean not null default false;

create table public.message_feedback (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sequence_number bigint not null,
  rating smallint not null check (rating in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (user_id, conversation_id, sequence_number)
);

alter table public.message_feedback enable row level security;

create policy "users manage their feedback"
  on public.message_feedback for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
