/** Run only with app/cron writers stopped. Default is a read-only audit; --apply converts in place.
 * No keys, plaintext, row IDs or bank names are printed or written to disk.
 * Keep the existing APP_ENCRYPTION_KEY and PII_HMAC_KEY; this is NOT key rotation.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';

const columns = {
  finance_transactions: ['occurred_on', 'amount_minor', 'currency', 'direction', 'category'],
  finance_bills: ['amount_minor', 'currency', 'category', 'statement_date', 'due_date', 'status', 'paid_on'],
};
export function conversionCrypto(secret, hmacSecret) {
  if (!secret || Buffer.byteLength(secret) < 32 || !hmacSecret || Buffer.byteLength(hmacSecret) < 32) throw new Error('Strong existing encryption and HMAC keys are required');
  const key = createHash('sha256').update(secret).digest();
  const seal = (value, context) => {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return ['v2', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join(':');
  };
  const open = (value, context) => {
    const [version, iv, tag, ciphertext] = value.split(':');
    if (!['v1', 'v2'].includes(version)) throw new Error('Invalid ciphertext');
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    if (version === 'v2') cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([cipher.update(Buffer.from(ciphertext, 'base64url')), cipher.final()]).toString();
  };
  return { seal, open, hmac: value => createHmac('sha256', hmacSecret).update(value).digest('base64url') };
}
export function conversionPatch(table, row, crypto) {
  if (columns[table]) {
    // An existing encrypted field authenticates the key before legacy numeric fields are converted.
    crypto.open(row.merchant_ciphertext, '');
    if (row.note_ciphertext) crypto.open(row.note_ciphertext, '');
    if (row.payload_ciphertext) crypto.open(row.payload_ciphertext, '');
    const context = `daylark:financial:${table}:${row.user_id}`;
    if (row.financial_ciphertext) {
      crypto.open(row.financial_ciphertext, context); // Check the actual key even in audit mode.
      if (columns[table].some(key => row[key] != null)) throw new Error('Mixed plaintext and ciphertext');
      return null;
    }
    const values = Object.fromEntries(columns[table].map(key => [key, row[key] ?? null]));
    const ciphertext = crypto.seal(values, context);
    if (crypto.open(ciphertext, context) !== JSON.stringify(values)) throw new Error('Encryption verification failed');
    return { ...Object.fromEntries(columns[table].map(key => [key, null])), financial_ciphertext: ciphertext };
  }
  if (table === 'bank_connections') {
    // Verify existing access credentials before any write: a wrong key must never strand a live Item.
    crypto.open(row.access_token_ciphertext, '');
    if (row.metadata_ciphertext) {
      crypto.open(row.metadata_ciphertext, `daylark:bank:${row.user_id}`);
      if (row.item_id != null || row.institution_name != null) throw new Error('Mixed bank identity');
      return null;
    }
    return { item_id: null, institution_name: null, item_ref_hmac: crypto.hmac(`item:${row.item_id}`),
      metadata_ciphertext: crypto.seal({ item_id: row.item_id, institution_name: row.institution_name }, `daylark:bank:${row.user_id}`) };
  }
  // The original bank payload already contains the date and pending state in ciphertext.
  crypto.open(row.payload_ciphertext, '');
  const fields = row.ledger_fields;
  const ledger = row.pending === true ? null : fields && !fields.financial_ciphertext ? { ...fields, ...conversionPatch('finance_transactions', { ...fields, user_id: row.user_id }, crypto) } : fields;
  if (fields?.financial_ciphertext) crypto.open(fields.financial_ciphertext, `daylark:financial:finance_transactions:${row.user_id}`);
  return row.occurred_on != null || row.pending != null || ledger !== fields ? { occurred_on: null, pending: null, ledger_fields: ledger } : null;
}
async function run() {
  const apply = process.argv.includes('--apply');
  const crypto = conversionCrypto(process.env.APP_ENCRYPTION_KEY, process.env.PII_HMAC_KEY);
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let outstanding = 0;
  for (const table of ['bank_connections', 'finance_transactions', 'finance_bills', 'bank_transactions']) {
    let after; let checked = 0; let converted = 0; let legacy = 0;
    for (;;) {
      let query = db.from(table).select('*').order('id').limit(200);
      if (after) query = query.gt('id', after);
      const result = await query;
      if (result.error) throw new Error(`Cannot read ${table}; apply migration 0029 first`);
      for (const row of result.data) {
        const patch = conversionPatch(table, row, crypto); checked++;
        if (!patch) continue;
        legacy++;
        if (!apply) continue;
        let update = db.from(table).update(patch).eq('id', row.id).eq('user_id', row.user_id);
        // Compare the entire preimage: concurrent edits cause a visible failure instead of lost updates.
        for (const key of Object.keys(patch)) {
          if (key === 'ledger_fields') continue; // updated_at protects this JSON value below.
          update = row[key] == null ? update.is(key, null) : update.eq(key, row[key]);
        }
        if (row.updated_at) update = update.eq('updated_at', row.updated_at);
        const saved = await update.select('*').single();
        if (saved.error || !saved.data) throw new Error(`Conversion conflict in ${table}; stop writers before retrying`);
        if (conversionPatch(table, saved.data, crypto)) throw new Error(`Verification failed for ${table}`);
        for (const [key, value] of Object.entries(patch)) if (JSON.stringify(saved.data[key]) !== JSON.stringify(value) && key !== 'ledger_fields') throw new Error('Stored value differs');
        converted++;
      }
      if (result.data.length < 200) break;
      after = result.data.at(-1).id;
    }
    outstanding += legacy - converted;
    console.log(JSON.stringify({ table, checked, legacy, converted }));
  }
  if (outstanding) { console.log('Legacy financial fields remain. Conversion has not completed.'); process.exitCode = 2; }
  else console.log('All inspected financial rows are encrypted. Validate constraints with scripts/validate-financial-encryption.sql.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(() => { console.error('Financial encryption audit/conversion failed. No financial values logged. Keep maintenance mode on; inspect configuration and retry.'); process.exitCode = 1; });
}
