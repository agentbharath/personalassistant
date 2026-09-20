-- R29: the places (or answer) from the last web search in a conversation, so a follow-up such as "the second one" or "which is open now?"
-- can be read. Encrypted like the email state, and it expires on its own after an hour.
alter table public.conversations
  add column search_state_ciphertext text;
