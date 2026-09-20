alter table public.conversations
  add column if not exists title_ciphertext text;

create index if not exists conversations_user_updated_idx
  on public.conversations (user_id, updated_at desc);

create index if not exists conversation_messages_order_idx
  on public.conversation_messages (conversation_id, sequence_number);
