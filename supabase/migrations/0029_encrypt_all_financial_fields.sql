-- Deploy during a maintenance window, then run scripts/encrypt-financial-data.mjs.
-- NOT VALID permits legacy rows to be backfilled, but rejects ALL new plaintext writes.
-- No encryption keys enter SQL: all encryption/decryption happens in the app.
alter table public.finance_transactions add column financial_ciphertext text;
alter table public.finance_transactions alter column occurred_on drop not null, alter column occurred_on drop default;
alter table public.finance_transactions alter column amount_minor drop not null, alter column amount_minor drop default;
alter table public.finance_transactions alter column currency drop not null, alter column currency drop default;
alter table public.finance_transactions alter column direction drop not null, alter column direction drop default;
alter table public.finance_transactions alter column category drop not null, alter column category drop default;
alter table public.finance_transactions add constraint finance_transactions_encrypted_only check (financial_ciphertext is not null and financial_ciphertext like 'v2:%' and occurred_on is null and amount_minor is null and currency is null and direction is null and category is null) not valid;
alter table public.finance_bills add column financial_ciphertext text;
alter table public.finance_bills alter column amount_minor drop not null, alter column amount_minor drop default;
alter table public.finance_bills alter column currency drop not null, alter column currency drop default;
alter table public.finance_bills alter column category drop not null, alter column category drop default;
alter table public.finance_bills alter column statement_date drop not null, alter column statement_date drop default;
alter table public.finance_bills alter column due_date drop not null, alter column due_date drop default;
alter table public.finance_bills alter column status drop not null, alter column status drop default;
alter table public.finance_bills alter column paid_on drop not null, alter column paid_on drop default;
alter table public.finance_bills add constraint finance_bills_encrypted_only check (financial_ciphertext is not null and financial_ciphertext like 'v2:%' and amount_minor is null and currency is null and category is null and statement_date is null and due_date is null and status is null and paid_on is null) not valid;
alter table public.bank_connections add column metadata_ciphertext text;
alter table public.bank_connections add column item_ref_hmac text;
alter table public.bank_connections alter column item_id drop not null, alter column institution_name drop not null;
create unique index bank_connection_item_hmac on public.bank_connections(environment, item_ref_hmac);
alter table public.bank_connections add constraint bank_connections_encrypted_only check
  (metadata_ciphertext is not null and metadata_ciphertext like 'v2:%' and item_ref_hmac is not null and item_id is null and institution_name is null) not valid;
alter table public.bank_transactions alter column occurred_on drop not null, alter column pending drop not null;
alter table public.bank_transactions add constraint bank_transactions_encrypted_only check
  (occurred_on is null and pending is null and (ledger_fields is null or
    (ledger_fields->>'financial_ciphertext' is not null and ledger_fields->>'financial_ciphertext' like 'v2:%'
     and ledger_fields->>'amount_minor' is null and ledger_fields->>'currency' is null and ledger_fields->>'direction' is null
     and ledger_fields->>'category' is null and ledger_fields->>'occurred_on' is null))) not valid;
-- Remove browser access even for encrypted rows: all access must pass server authorization.
revoke all on public.finance_transactions, public.finance_transaction_sources, public.finance_bills,
 public.finance_sync_state, public.finance_import_candidates, public.finance_sender_registry from anon, authenticated;
grant all on public.finance_transactions, public.finance_transaction_sources, public.finance_bills,
 public.finance_sync_state, public.finance_import_candidates, public.finance_sender_registry to service_role;
create or replace function public.insert_finance_transaction_with_source(p_user_id uuid, p_transaction jsonb, p_source jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  saved public.finance_transactions%rowtype;
  was_duplicate boolean := false;
  linked uuid;
begin
  insert into public.finance_transactions(user_id, financial_ciphertext, merchant_ciphertext, merchant_hash, note_ciphertext, dedupe_fingerprint)
  values (p_user_id, p_transaction->>'financial_ciphertext', p_transaction->>'merchant_ciphertext', p_transaction->>'merchant_hash', p_transaction->>'note_ciphertext', p_transaction->>'dedupe_fingerprint')
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

create or replace function public.apply_bank_sync(p_user_id uuid, p_id uuid, p_lease uuid, p_rows jsonb, p_removed jsonb,
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
        update public.finance_transactions set financial_ciphertext = f->>'financial_ciphertext', occurred_on = null, amount_minor = null, currency = null, direction = null, category = null, merchant_ciphertext = f->>'merchant_ciphertext',
          merchant_hash = f->>'merchant_hash', note_ciphertext = f->>'note_ciphertext', bank_voided = false, updated_at = now()
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

drop function public.import_bank_transaction(uuid, uuid, text, uuid);
create function public.import_bank_transaction(p_user_id uuid, p_id uuid, p_hash text, p_match uuid default null, p_match_ciphertext text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare connection_key uuid; b public.bank_transactions; f jsonb; saved_id uuid; existing public.finance_transactions;
begin
  select connection_id into strict connection_key from public.bank_transactions where id = p_id and user_id = p_user_id;
  perform 1 from public.bank_connections where id = connection_key and user_id = p_user_id
    and (lease_until is null or lease_until < now()) for update;
  if not found then raise exception 'BANK_BUSY'; end if;
  select * into strict b from public.bank_transactions where id = p_id and user_id = p_user_id for update;
  if b.content_hash <> p_hash or b.pending or b.removed or b.ledger_fields is null then raise exception 'PREVIEW_CHANGED'; end if;
  if b.ledger_id is not null then return b.ledger_id; end if;
  -- Sandbox data remains a preview and cannot enter real spending totals.
  perform 1 from public.bank_connections where id = b.connection_id and user_id = p_user_id and environment = 'production';
  if not found then raise exception 'SANDBOX_IMPORT_DISABLED'; end if;
  f := b.ledger_fields;
  if p_match is not null then
    select * into strict existing from public.finance_transactions where id = p_match and user_id = p_user_id and not bank_voided for update;
    -- The server decrypts and validates the candidate. Compare the exact ciphertext it read
    -- under the lock so a concurrent bank correction cannot invalidate that decision.
    if p_match_ciphertext is null or existing.financial_ciphertext is distinct from p_match_ciphertext then raise exception 'PREVIEW_CHANGED'; end if;
    if exists(select 1 from public.finance_transaction_sources where user_id = p_user_id and transaction_id = p_match and source_type = 'plaid') then raise exception 'BANK_ALREADY_LINKED'; end if;
    saved_id := p_match;
  else
    insert into public.finance_transactions(user_id, financial_ciphertext, merchant_ciphertext,
      merchant_hash, note_ciphertext, dedupe_fingerprint)
    values(p_user_id, f->>'financial_ciphertext', f->>'merchant_ciphertext',
      f->>'merchant_hash', f->>'note_ciphertext', 'plaid:' || b.id::text) returning id into saved_id;
  end if;
  insert into public.finance_transaction_sources(user_id, transaction_id, source_type, external_ref_hmac, payload_ciphertext)
    values(p_user_id, saved_id, 'plaid', b.provider_ref, b.payload_ciphertext);
  update public.bank_transactions set ledger_id = saved_id where id = p_id;
  return saved_id;
end;
$$;

revoke all on function public.import_bank_transaction(uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.import_bank_transaction(uuid, uuid, text, uuid, text) to service_role;
