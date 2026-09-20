alter table public.conversations
  add column context_summary_ciphertext text,
  add column summarized_through_sequence bigint not null default 0;

create index conversation_messages_recent_idx
  on public.conversation_messages (conversation_id, sequence_number desc);
