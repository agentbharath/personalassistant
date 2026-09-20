create table public.oauth_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  provider text not null check (provider in ('google')),
  capability text not null check (capability in ('calendar', 'email')),
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  scopes text[] not null default '{}',
  access_token_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, capability)
);

alter table public.oauth_connections enable row level security;

-- Deliberately no user-facing RLS policy. Only the server-side credential broker,
-- using the Supabase secret key, can read or write provider credentials.
create index oauth_connections_lookup_idx
  on public.oauth_connections (user_id, provider, capability);
