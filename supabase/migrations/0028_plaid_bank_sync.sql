-- Bank tokens and source payloads are server-only and encrypted by the app.
create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null check (environment in ('sandbox', 'production')),
  item_id text not null,
  access_token_ciphertext text not null,
  institution_name text not null,
  cursor_ciphertext text,
  accounts_ciphertext text,
  status text not null default 'connected',
  update_status text,
  last_error text,
  last_synced_at timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  unique (environment, item_id)
);
alter table public.bank_connections enable row level security;
revoke all on public.bank_connections from anon, authenticated;
grant all on public.bank_connections to service_role;

create table public.bank_link_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null,
  connection_id uuid references public.bank_connections(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.bank_link_sessions enable row level security;
revoke all on public.bank_link_sessions from anon, authenticated;
grant all on public.bank_link_sessions to service_role;

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.bank_connections(id) on delete cascade,
  provider_ref text not null,
  occurred_on date not null,
  pending boolean not null,
  removed boolean not null default false,
  payload_ciphertext text not null,
  content_hash text not null,
  ledger_fields jsonb,
  ledger_id uuid references public.finance_transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id, provider_ref)
);
create index bank_transactions_user_date on public.bank_transactions(user_id, occurred_on desc, id);
create unique index bank_transactions_ledger on public.bank_transactions(ledger_id) where ledger_id is not null;
alter table public.bank_transactions enable row level security;
revoke all on public.bank_transactions from anon, authenticated;
grant all on public.bank_transactions to service_role;

alter table public.finance_transactions add column bank_voided boolean not null default false;
alter table public.finance_transaction_sources drop constraint finance_transaction_sources_source_type_check;
alter table public.finance_transaction_sources add constraint finance_transaction_sources_source_type_check
  check (source_type in ('user_input', 'receipt', 'email', 'plaid'));

-- A lease is shared by sync, import and disconnect. A stale worker cannot commit.
create function public.claim_bank_connection(p_user_id uuid, p_id uuid, p_lease uuid)
returns setof public.bank_connections language sql security definer set search_path = public as $$
  update public.bank_connections set lease_id = p_lease, lease_until = now() + interval '2 minutes'
  where user_id = p_user_id and id = p_id and (lease_until is null or lease_until < now()) returning *;
$$;

-- Commit the complete /transactions/sync pagination result and its cursor together.
-- Provider updates apply only to records explicitly approved for ongoing bank sync.
create function public.apply_bank_sync(p_user_id uuid, p_id uuid, p_lease uuid, p_rows jsonb, p_removed jsonb,
  p_cursor text, p_accounts text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare r jsonb; b public.bank_transactions; f jsonb;
begin
  perform 1 from public.bank_connections where id = p_id and user_id = p_user_id and lease_id = p_lease and lease_until > now() for update;
  if not found then raise exception 'BANK_LEASE_LOST'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.bank_transactions(user_id, connection_id, provider_ref, occurred_on, pending, payload_ciphertext, content_hash, ledger_fields)
    values(p_user_id, p_id, r->>'provider_ref', (r->>'occurred_on')::date, (r->>'pending')::boolean, r->>'payload_ciphertext', r->>'content_hash', nullif(r->'ledger_fields', 'null'::jsonb))
    on conflict(connection_id, provider_ref) do update set occurred_on = excluded.occurred_on, pending = excluded.pending,
      removed = false, payload_ciphertext = excluded.payload_ciphertext, content_hash = excluded.content_hash, ledger_fields = excluded.ledger_fields, updated_at = now()
    returning * into b;
    if b.ledger_id is not null then
      f := b.ledger_fields;
      if b.pending or f is null then
        update public.finance_transactions set bank_voided = true, updated_at = now() where id = b.ledger_id and user_id = p_user_id;
      else
        update public.finance_transactions set occurred_on = (f->>'occurred_on')::date, amount_minor = (f->>'amount_minor')::bigint,
          currency = f->>'currency', direction = f->>'direction', merchant_ciphertext = f->>'merchant_ciphertext',
          merchant_hash = f->>'merchant_hash', category = f->>'category', note_ciphertext = f->>'note_ciphertext', bank_voided = false, updated_at = now()
          where id = b.ledger_id and user_id = p_user_id;
      end if;
      update public.finance_transaction_sources set payload_ciphertext = b.payload_ciphertext
        where user_id = p_user_id and transaction_id = b.ledger_id and source_type = 'plaid';
    end if;
  end loop;
  for r in select * from jsonb_array_elements(p_removed) loop
    update public.bank_transactions set removed = true, updated_at = now()
      where user_id = p_user_id and connection_id = p_id and provider_ref = r#>>'{}' returning * into b;
    if found and b.ledger_id is not null then
      update public.finance_transactions set bank_voided = true, updated_at = now() where user_id = p_user_id and id = b.ledger_id;
    end if;
  end loop;
  update public.bank_connections set cursor_ciphertext = p_cursor, accounts_ciphertext = p_accounts,
    update_status = p_status, last_synced_at = now(), last_error = null, status = 'connected', lease_id = null, lease_until = null
    where id = p_id and user_id = p_user_id;
end;
$$;

-- The browser supplies only preview IDs/hashes and an optional explicitly chosen
-- existing record. Financial values are taken from the server-owned bank preview.
create function public.import_bank_transaction(p_user_id uuid, p_id uuid, p_hash text, p_match uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.bank_transactions; f jsonb; saved_id uuid; existing public.finance_transactions;
begin
  select * into strict b from public.bank_transactions where id = p_id and user_id = p_user_id for update;
  if b.content_hash <> p_hash or b.pending or b.removed or b.ledger_fields is null then raise exception 'PREVIEW_CHANGED'; end if;
  if b.ledger_id is not null then return b.ledger_id; end if;
  -- Sandbox data remains a preview and cannot enter real spending totals.
  perform 1 from public.bank_connections where id = b.connection_id and user_id = p_user_id and environment = 'production';
  if not found then raise exception 'SANDBOX_IMPORT_DISABLED'; end if;
  f := b.ledger_fields;
  if p_match is not null then
    select * into strict existing from public.finance_transactions where id = p_match and user_id = p_user_id and not bank_voided for update;
    if existing.amount_minor <> (f->>'amount_minor')::bigint or existing.currency <> f->>'currency'
      or existing.direction <> f->>'direction' or abs(existing.occurred_on - (f->>'occurred_on')::date) > 3 then raise exception 'PREVIEW_CHANGED'; end if;
    if exists(select 1 from public.finance_transaction_sources where transaction_id = p_match and source_type = 'plaid') then raise exception 'BANK_ALREADY_LINKED'; end if;
    saved_id := p_match;
  else
    insert into public.finance_transactions(user_id, occurred_on, amount_minor, currency, direction, merchant_ciphertext,
      merchant_hash, category, note_ciphertext, dedupe_fingerprint)
    values(p_user_id, (f->>'occurred_on')::date, (f->>'amount_minor')::bigint, f->>'currency', f->>'direction', f->>'merchant_ciphertext',
      f->>'merchant_hash', f->>'category', f->>'note_ciphertext', 'plaid:' || b.id::text) returning id into saved_id;
  end if;
  insert into public.finance_transaction_sources(user_id, transaction_id, source_type, external_ref_hmac, payload_ciphertext)
    values(p_user_id, saved_id, 'plaid', b.provider_ref, b.payload_ciphertext);
  update public.bank_transactions set ledger_id = saved_id where id = p_id;
  return saved_id;
end;
$$;

revoke all on function public.claim_bank_connection(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.apply_bank_sync(uuid, uuid, uuid, jsonb, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.import_bank_transaction(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_bank_connection(uuid, uuid, uuid) to service_role;
grant execute on function public.apply_bank_sync(uuid, uuid, uuid, jsonb, jsonb, text, text, text) to service_role;
grant execute on function public.import_bank_transaction(uuid, uuid, text, uuid) to service_role;
