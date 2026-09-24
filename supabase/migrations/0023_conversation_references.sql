-- Preserve displayed result sets independently of mutable latest-search state and expiring approvals.
create table public.conversation_references (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  kind text not null check (kind in ('email_results', 'place_results')),
  payload_ciphertext text not null,
  created_at timestamptz not null default now()
);
alter table public.conversation_references enable row level security;
create policy "users manage their conversation references"
  on public.conversation_references for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (
    select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()
  ));
create index conversation_references_history_idx on public.conversation_references (user_id, conversation_id, created_at desc, id);
