-- An optional note explaining a bad-answer rating, encrypted like everything else the user writes.
alter table public.message_feedback add column note_ciphertext text;
