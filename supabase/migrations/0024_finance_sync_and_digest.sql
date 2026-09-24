-- Additive support tables; the existing finance ledger, bills and approval tables remain authoritative.
create table public.finance_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  run_id uuid not null default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete set null,
  status text not null default 'idle' check (status in ('idle','queued','running','review','blocked')),
  synced_through timestamptz,
  covered_from timestamptz,
  scan_from timestamptz,
  scan_through timestamptz,
  cursor_ciphertext text,
  checked integer not null default 0,
  version integer not null default 0,
  lease_id uuid,
  lease_until timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
create table public.finance_import_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null,
  source_ref_hmac text not null,
  payload_ciphertext text,
  classification text not null,
  status text not null check (status in ('pending','approved','rejected','ignored','blocked')),
  created_at timestamptz not null default now(),
  unique (user_id, source_ref_hmac)
);
create index finance_candidates_review_idx on public.finance_import_candidates(user_id, run_id, status);
create table public.finance_sender_registry (
  user_id uuid not null references auth.users(id) on delete cascade,
  sender_hmac text not null,
  positive_count integer not null default 0,
  negative_count integer not null default 0,
  status text not null check (status in ('transactional','non_transactional','mixed')),
  updated_at timestamptz not null default now(),
  primary key(user_id, sender_hmac)
);
alter table public.finance_transaction_sources add column order_ref_hmac text;
create index finance_sources_order_idx on public.finance_transaction_sources(user_id, order_ref_hmac) where order_ref_hmac is not null;
create table public.digest_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  status text not null check (status in ('claimed','sent','failed','unknown')),
  provider_message_id text,
  created_at timestamptz not null default now(),
  primary key(user_id, local_date)
);
alter table public.finance_sync_state enable row level security;
alter table public.finance_import_candidates enable row level security;
alter table public.finance_sender_registry enable row level security;
alter table public.digest_log enable row level security;
-- Writes are server-only: browser clients cannot approve candidates, move watermarks or claim deliveries.
create policy "users read their finance sync" on public.finance_sync_state for select using (auth.uid() = user_id);
create policy "users read their import candidates" on public.finance_import_candidates for select using (auth.uid() = user_id);
create policy "users read their sender registry" on public.finance_sender_registry for select using (auth.uid() = user_id);
create policy "users read their digest log" on public.digest_log for select using (auth.uid() = user_id);

-- Ledger + first source commit together: a source conflict must not leave an orphan duplicate transaction.
create function public.insert_finance_transaction_with_source(p_user_id uuid, p_transaction jsonb, p_source jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  saved public.finance_transactions%rowtype;
  was_duplicate boolean := false;
  linked uuid;
begin
  insert into public.finance_transactions(user_id, occurred_on, amount_minor, currency, direction, merchant_ciphertext, merchant_hash, category, note_ciphertext, dedupe_fingerprint)
  values (p_user_id, (p_transaction->>'occurred_on')::date, (p_transaction->>'amount_minor')::bigint, p_transaction->>'currency', p_transaction->>'direction', p_transaction->>'merchant_ciphertext', p_transaction->>'merchant_hash', p_transaction->>'category', p_transaction->>'note_ciphertext', p_transaction->>'dedupe_fingerprint')
  on conflict(user_id, dedupe_fingerprint) do nothing returning * into saved;
  if saved.id is null then
    was_duplicate := true;
    select * into strict saved from public.finance_transactions where user_id = p_user_id and dedupe_fingerprint = p_transaction->>'dedupe_fingerprint';
  end if;
  if p_source->>'external_ref_hmac' is not null then
    select transaction_id into linked from public.finance_transaction_sources where user_id = p_user_id and source_type = p_source->>'source_type' and external_ref_hmac = p_source->>'external_ref_hmac';
    if linked is not null and linked <> saved.id then
      raise unique_violation using message = 'SOURCE_ALREADY_LINKED';
    end if;
  end if;
  if linked is null then
    insert into public.finance_transaction_sources(user_id, transaction_id, source_type, external_ref_hmac, payload_ciphertext, order_ref_hmac)
    values (p_user_id, saved.id, p_source->>'source_type', p_source->>'external_ref_hmac', p_source->>'payload_ciphertext', p_source->>'order_ref_hmac');
  end if;
  return jsonb_build_object('transaction', to_jsonb(saved), 'duplicate', was_duplicate);
end;
$$;
revoke all on function public.insert_finance_transaction_with_source(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.insert_finance_transaction_with_source(uuid, jsonb, jsonb) to service_role;
