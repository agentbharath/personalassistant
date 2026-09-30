-- R47: a general-purpose, classification-agnostic recall record for any completed informational answer (conversations/conversation-state.ts)
-- -- decided by the owner, 2026-09-30 ("it doesn't matter which classification, it should remember the chats and convo we have had"),
-- after chasing recall one feature at a time (research, then suggestions) each left a real gap. Wired centrally in run.ts, not opted
-- into per agent, so a future new answer kind is covered automatically.
alter table public.conversation_references drop constraint conversation_references_kind_check;
alter table public.conversation_references add constraint conversation_references_kind_check
  check (kind in ('email_results', 'place_results', 'research_results', 'suggestion_results', 'answer_results'));
