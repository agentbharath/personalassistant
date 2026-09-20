-- R27: mail the owner has dismissed from the "Waiting on your reply" card. Dismissed for good, so a dismissed thread never comes back.
-- Only a keyed hash of the Gmail thread id is stored, never the id, subject or sender.

create table public.reply_dismissals (
  user_id uuid not null references auth.users(id) on delete restrict,
  thread_hmac text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, thread_hmac)
);

alter table public.reply_dismissals enable row level security;

create policy "users manage their dismissals"
  on public.reply_dismissals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
