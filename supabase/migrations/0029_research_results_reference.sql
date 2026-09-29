-- R47: research mode's comparisons get the same cross-conversation recall as an ordinary place search (conversations/research-state.ts).
-- Found live: a brand new conversation asking "which air purifier did you recommend" had nothing to recall, since research mode had no
-- persistence at all until now.
alter table public.conversation_references drop constraint conversation_references_kind_check;
alter table public.conversation_references add constraint conversation_references_kind_check
  check (kind in ('email_results', 'place_results', 'research_results'));
