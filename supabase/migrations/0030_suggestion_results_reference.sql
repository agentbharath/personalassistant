-- R47: the suggestions card (product/service recommendations) gets the same cross-conversation recall as research mode's own
-- comparisons and an ordinary place search (conversations/suggestion-state.ts). Found live: a later chat asking "which product did you
-- suggest for strawberry skin" had nothing to recall, since the suggestions card had no persistence at all until now.
alter table public.conversation_references drop constraint conversation_references_kind_check;
alter table public.conversation_references add constraint conversation_references_kind_check
  check (kind in ('email_results', 'place_results', 'research_results', 'suggestion_results'));
