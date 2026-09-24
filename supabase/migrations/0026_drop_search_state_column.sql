-- R29 simplified: a web search is now one row in conversation_references (kind "place_results"), never updated in place, so both a
-- same-conversation follow-up and cross-conversation recall read the same log instead of two different, easily-inconsistent places.
-- Existing values were backfilled into conversation_references first (any conversation with no matching reference got one made from its
-- last saved value), so no history is lost by dropping this column.
alter table public.conversations
  drop column search_state_ciphertext;
