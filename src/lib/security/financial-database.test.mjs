import { beforeAll, afterAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { conversionCrypto, conversionPatch } from '../../../scripts/encrypt-financial-data.mjs';
import { encryptText, decryptText } from './encryption';
import { sealFinancialFields, openFinancialFields } from './financial-data';
import { bankRecord } from '../plaid/service';

let db;
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const bank = '00000000-0000-4000-8000-000000000003';
const oldTransaction = '00000000-0000-4000-8000-000000000004';
const oldBill = '00000000-0000-4000-8000-000000000005';
const crypto = conversionCrypto('existing-encryption-key-32-bytes-long', 'existing-hmac-key-at-least-32-bytes');
const migrate = async name => db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = 'existing-encryption-key-32-bytes-long';
  process.env.PII_HMAC_KEY = 'existing-hmac-key-at-least-32-bytes';
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.conversations(id uuid primary key);
    create table public.user_learnings(kind text constraint user_learnings_kind_check check(kind in ('autopay')));
    insert into auth.users values('${owner}'),('${other}');`);
  for (const migration of ['0005_finance_transactions.sql', '0013_finance_bills.sql', '0022_transfer_direction.sql', '0024_finance_sync_and_digest.sql', '0028_plaid_bank_sync.sql']) await migrate(migration);
  await db.query(`insert into finance_transactions(id,user_id,occurred_on,amount_minor,currency,direction,merchant_ciphertext,merchant_hash,category,dedupe_fingerprint)
    values($1,$2,'2026-09-27',12345,'USD','expense',$3,'hash','medical','legacy')`, [oldTransaction, owner, encryptText('Clinic')]);
  await db.query(`insert into finance_bills(id,user_id,merchant_ciphertext,merchant_hash,amount_minor,currency,category,statement_date,due_date,dedupe_fingerprint)
    values($1,$2,$3,'hash',23456,'USD','utilities','2026-09-20','2026-10-01','bill')`, [oldBill, owner, encryptText('Power')]);
  await db.query(`insert into bank_connections(id,user_id,environment,item_id,access_token_ciphertext,institution_name)
    values($1,$2,'production','item-original',$3,'Private Bank')`, [bank, owner, encryptText('persistent-token')]);
  await db.exec('grant all on finance_transactions,finance_bills to authenticated;');
  await migrate('0029_encrypt_all_financial_fields.sql');
  await migrate('0030_financial_request_limits.sql');
}, 30000);
afterAll(async () => { await db?.close(); });

it('backfills old rows losslessly and is idempotent without touching live bank tokens', async () => {
  for (const table of ['bank_connections','finance_transactions','finance_bills']) {
    const rows = (await db.query(`select * from ${table}`)).rows;
    for (const row of rows) {
      // PostgREST sends SQL dates as YYYY-MM-DD; PGlite returns Date objects.
      for (const key of ['occurred_on','statement_date','due_date','paid_on']) if (row[key] instanceof Date) row[key] = row[key].toISOString().slice(0,10);
      const patch = conversionPatch(table,row,crypto);
      const keys = Object.keys(patch);
      await db.query(`update ${table} set ${keys.map((k,i) => `${k}=$${i+1}`).join(',')} where id=$${keys.length+1}`, [...Object.values(patch),row.id]);
      const saved = await one(`select * from ${table} where id=$1`,[row.id]);
      expect(conversionPatch(table,saved,crypto)).toBeNull();
      if (table === 'bank_connections') {
        expect(saved.access_token_ciphertext).toBe(row.access_token_ciphertext);
        expect(decryptText(saved.access_token_ciphertext)).toBe('persistent-token');
        expect(JSON.parse(crypto.open(saved.metadata_ciphertext,`daylark:bank:${owner}`))).toEqual({item_id:'item-original',institution_name:'Private Bank'});
      } else {
        const opened = openFinancialFields(table,owner,saved);
        for (const key of Object.keys(patch).filter(k=>k!=='financial_ciphertext')) {
          expect(saved[key]).toBeNull(); expect(opened[key]).toEqual(row[key]);
        }
      }
    }
  }
});
it('rejects new plaintext even before constraint validation', async () => {
  await expect(db.query(`insert into finance_transactions(user_id,occurred_on,amount_minor,currency,direction,merchant_ciphertext,merchant_hash,category,dedupe_fingerprint)
    values($1,'2026-09-27',1999,'USD','expense','v1:x','h','health','bad')`,[owner])).rejects.toThrow(/encrypted_only/);
  await expect(db.query(`update finance_bills set amount_minor=1 where id=$1`,[oldBill])).rejects.toThrow(/encrypted_only/);
});
it('blocks browser table access and all sensitive RPCs, including spoofed owner IDs', async () => {
  for (const role of ['anon','authenticated']) {
    for (const table of ['finance_transactions','finance_bills','finance_transaction_sources','bank_connections','bank_transactions','financial_request_limits']) {
      expect((await one(`select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') as allowed`,[role,table])).allowed).toBe(false);
    }
    expect((await one(`select has_function_privilege($1,'import_bank_transaction(uuid,uuid,text,uuid,text)','EXECUTE') as allowed`,[role])).allowed).toBe(false);
    expect((await one(`select has_function_privilege($1,'take_financial_request(uuid,text)','EXECUTE') as allowed`,[role])).allowed).toBe(false);
  }
});
it('syncs, imports, corrects and removes an encrypted bank record atomically', async () => {
  const transaction = {transaction_id:'purchase',account_id:'card',amount:19.99,iso_currency_code:'USD',date:'2026-09-27',pending:false,name:'Shop'};
  async function sync(amount, removed = []) {
    const lease = randomUUID();
    await db.query('select * from claim_bank_connection($1,$2,$3)',[owner,bank,lease]);
    const row = bankRecord('item-original',{...transaction,amount},owner);
    await db.query('select apply_bank_sync($1,$2,$3,$4,$5,$6,$7,$8)',[owner,bank,lease,JSON.stringify(removed.length?[]:[row]),JSON.stringify(removed),encryptText('cursor'),encryptText('[]'),'HISTORICAL_UPDATE_COMPLETE']);
    return row;
  }
  const initial = await sync(19.99);
  const preview = await one('select * from bank_transactions where provider_ref=$1',[initial.provider_ref]);
  expect(preview.occurred_on).toBeNull(); expect(preview.pending).toBeNull();
  await expect(db.query('select import_bank_transaction($1,$2,$3)',[other,preview.id,preview.content_hash])).rejects.toThrow();
  await expect(db.query('select import_bank_transaction($1,$2,$3)',[owner,preview.id,'stale'])).rejects.toThrow(/PREVIEW_CHANGED/);
  const saved = await one('select import_bank_transaction($1,$2,$3) as id',[owner,preview.id,preview.content_hash]);
  expect((await one('select import_bank_transaction($1,$2,$3) as id',[owner,preview.id,preview.content_hash])).id).toBe(saved.id);
  let ledger = await one('select * from finance_transactions where id=$1',[saved.id]);
  expect(ledger.amount_minor).toBeNull(); expect(openFinancialFields('finance_transactions',owner,ledger).amount_minor).toBe(1999);
  await sync(21.49);
  ledger = await one('select * from finance_transactions where id=$1',[saved.id]);
  expect(openFinancialFields('finance_transactions',owner,ledger).amount_minor).toBe(2149);
  const cursor = (await one('select cursor_ciphertext from bank_connections where id=$1',[bank])).cursor_ciphertext;
  await expect(db.query('select apply_bank_sync($1,$2,$3,$4,$5,$6,$7,$8)',[other,bank,randomUUID(),'[]','[]','wrong','wrong','wrong'])).rejects.toThrow(/BANK_LEASE_LOST/);
  expect((await one('select cursor_ciphertext from bank_connections where id=$1',[bank])).cursor_ciphertext).toBe(cursor);
  await sync(21.49,[initial.provider_ref]);
  expect((await one('select bank_voided from finance_transactions where id=$1',[saved.id])).bank_voided).toBe(true);
});
it('serializes imports against active sync leases and rejects stale match snapshots', async () => {
  const row = bankRecord('item-original',{transaction_id:'second',account_id:'card',amount:123.45,iso_currency_code:'USD',date:'2026-09-27',pending:false,name:'Clinic'},owner);
  const lease = randomUUID();
  await db.query('select * from claim_bank_connection($1,$2,$3)',[owner,bank,lease]);
  await db.query('select apply_bank_sync($1,$2,$3,$4,$5,$6,$7,$8)',[owner,bank,lease,JSON.stringify([row]),'[]',encryptText('cursor2'),encryptText('[]'),'DONE']);
  const preview = await one('select * from bank_transactions where provider_ref=$1',[row.provider_ref]);
  await expect(db.query('select import_bank_transaction($1,$2,$3,$4,$5)',[owner,preview.id,preview.content_hash,oldTransaction,'stale-ciphertext'])).rejects.toThrow(/PREVIEW_CHANGED/);
  const active = randomUUID(); await db.query('select * from claim_bank_connection($1,$2,$3)',[owner,bank,active]);
  await expect(db.query('select import_bank_transaction($1,$2,$3)',[owner,preview.id,preview.content_hash])).rejects.toThrow(/BANK_BUSY/);
  await db.query('update bank_connections set lease_until=null,lease_id=null where id=$1',[bank]);
  const target = await one('select * from finance_transactions where id=$1',[oldTransaction]);
  expect((await one('select import_bank_transaction($1,$2,$3,$4,$5) as id',[owner,preview.id,preview.content_hash,oldTransaction,target.financial_ciphertext])).id).toBe(oldTransaction);
});
it('persists shared limits atomically and keeps each user budget separate', async () => {
  const results = await Promise.all(Array.from({length:12}, () => one('select take_financial_request($1,$2) as allowed',[owner,'link'])));
  expect(results.filter(r=>r.allowed)).toHaveLength(5);
  expect((await one('select take_financial_request($1,$2) as allowed',[other,'link'])).allowed).toBe(true);
});
it('validates that no legacy financial values remain after conversion and new writes', async () => {
  await db.exec(await readFile('scripts/validate-financial-encryption.sql','utf8'));
  const invalid = await one("select count(*)::int as n from pg_constraint where conname like '%_encrypted_only' and not convalidated");
  expect(invalid.n).toBe(0);
});
