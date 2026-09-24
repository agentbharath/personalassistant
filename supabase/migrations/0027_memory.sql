-- Phase 1 of general memory (facts, preferences, behavioral rules only; entities, commitments, the answer ledger and consolidation are
-- later phases). One statement is one row. A later statement that contradicts or updates an earlier one supersedes it rather than
-- overwriting it, so the history stays intact. Retrieval is agentic (the model reasons over what it's given), not vector search: a
-- single-owner store stays small enough that "read everything active" is simpler and more reliable than embeddings guessing relevance.
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('fact','preference','rule')),
  category text not null,
  strength text not null default 'soft' check (strength in ('hard','soft')),
  statement_ciphertext text not null,
  status text not null default 'active' check (status in ('active','pending','superseded','expired','rejected')),
  superseded_by uuid references public.memories(id) on delete set null,
  -- Reserved for a future entities table (a fact about someone other than the account owner). Null means the owner themself. Added now,
  -- not later, because backfilling every existing row would be needed if it were added after the fact.
  subject_entity_id uuid,
  valid_until timestamptz,
  source_excerpt_ciphertext text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_active_idx on public.memories (user_id, status, created_at);
alter table public.memories enable row level security;
create policy "users read their memories" on public.memories for select using (auth.uid() = user_id);
-- Writes are server-only: the extractor and explicit remember/forget commands run with the service role, never directly from the browser.

create table public.memory_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_id uuid references public.memories(id) on delete set null,
  action text not null check (action in ('add','update','supersede','confirm','reject','expire','forget')),
  detail_ciphertext text,
  created_at timestamptz not null default now()
);
create index memory_events_history_idx on public.memory_events (user_id, created_at desc);
alter table public.memory_events enable row level security;
create policy "users read their memory events" on public.memory_events for select using (auth.uid() = user_id);
