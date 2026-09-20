-- R25: drafts Daylark creates in Gmail, and the versions of their wording (for "go back to the first version").
-- This table is the only source of "drafts Daylark created": nothing else in the mailbox is ever touched.

alter table public.oauth_connections
  drop constraint oauth_connections_capability_check,
  add constraint oauth_connections_capability_check check (capability in ('calendar', 'email', 'email_drafts'));

create table public.email_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  conversation_id uuid references public.conversations(id) on delete cascade,
  gmail_draft_id text not null,
  gmail_thread_id text,
  -- Encrypted JSON list of { at, body, subject, to, cc, note }. Null once the draft is discarded (R25.8).
  versions_ciphertext text,
  discarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, gmail_draft_id)
);

alter table public.email_drafts enable row level security;

create policy "users manage their drafts"
  on public.email_drafts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index email_drafts_user_idx on public.email_drafts (user_id, created_at desc);
