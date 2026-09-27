import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { samples, eml } from './fixtures.mjs';
import { setup } from './helpers.mjs';
import { processPending, reviewDocument } from '../src/pipeline.mjs';
import { rebuild, csv } from '../src/ledger.mjs';
import { Store } from '../src/store.mjs';
import { coverage, wilson, createAudit, labelAudit } from '../src/coverage.mjs';

async function ingestSamples(t) {
  const ctx=setup(t);
  for(const [id,raw]of samples)ctx.store.ingest(id,raw,{received:Date.parse('2026-09-26T17:00:00Z')});
  await processPending(ctx.store,ctx.config,100);return ctx;
}
test('duplicate receipts collapse; shipment, bill, statement and repayments never duplicate expense',async t=>{
  const {store}=await ingestSamples(t);const rows=store.ledger();
  const expenses=rows.filter(r=>r.kind==='expense'&&r.quality==='accepted');
  assert.deepEqual(expenses.map(r=>r.amountMinor).sort((a,b)=>a-b),[1299,7500,10800]);
  assert.equal(expenses.find(r=>r.amountMinor===10800).sources.length,2);
  const repayments=rows.filter(r=>r.kind==='transfer');assert.deepEqual(repayments.map(r=>r.amountMinor).sort((a,b)=>a-b),[2700,4000,54000]);
  assert.equal(rows.filter(r=>r.kind==='refund')[0].amountMinor,2000);
  assert.equal(rows.find(r=>r.kind==='obligation'&&r.amountMinor===7500).status,'paid');
  assert.equal(rows.filter(r=>r.sources.some(s=>s.messageId==='failed')).length,0);
});
test('rebuild is deterministic and immutable source import is idempotent',async t=>{
  const {store}=await ingestSamples(t);const before=JSON.stringify(store.ledger());
  rebuild(store);assert.equal(JSON.stringify(store.ledger()),before);
  store.ingest('receipt',Buffer.from('overwrite attempt'),{received:0});
  assert.ok(store.readRaw(store.message('receipt').raw_hash).includes('SHOP-123'));
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM messages').get().n,16);
});
test('review corrections survive reprocessing and cannot bypass source grounding',async t=>{
  const {store,config}=await ingestSamples(t);const doc=store.document('promo');
  await reviewDocument(store,'promo',{extraction:doc.extraction,note:'Confirmed promotion'},config);
  assert.equal(store.document('promo').disposition,'non_financial');
  store.db.prepare("UPDATE messages SET disposition='pending' WHERE id='promo'").run();await processPending(store,config);
  assert.equal(store.document('promo').method,'human');assert.equal(store.document('promo').disposition,'non_financial');
  await assert.rejects(()=>reviewDocument(store,'promo',{extraction:{...doc.extraction,amounts:[{role:'charged',moneyIndex:200}]},note:'bad'},config),/grounding_failed/);
});
test('similar same-day expenses are reviewed, never merged by amount alone',async t=>{
  const {store,config}=setup(t);
  for(const id of ['ONE','TWO'])store.ingest(id,eml('Purchase receipt',`Order ID: ${id}-123\nTotal: USD 10.00`),{received:Date.now()});
  await processPending(store,config);assert.equal(store.ledger().length,2);assert.ok(store.ledger().every(r=>r.quality==='needs_review'));assert.equal(store.reviews().filter(r=>r.reason==='ledger:possible_duplicate').length,2);
});
test('source and extracted financial content are encrypted at rest',async t=>{
  const {store,directory,config}=await ingestSamples(t);const rawHash=store.message('receipt').raw_hash;
  assert.ok(!readFileSync(join(directory,'blobs',rawHash),'utf8').includes('SHOP-123'));
  const payload=store.db.prepare('SELECT payload FROM documents LIMIT 1').get().payload;assert.ok(!payload.includes('Order'));
  assert.throws(()=>store.open(payload,'wrong-context'));
  assert.throws(()=>new Store(directory,'ff'.repeat(32)));
  assert.notEqual(config.encryptionKey,'ff'.repeat(32));
});
test('coverage reports gaps and never invents recall or 100% completeness',async t=>{
  const {store}=await ingestSamples(t);const report=coverage(store);assert.equal(report.complete,false);assert.equal(report.recall,null);assert.equal(report.counts.rawStored,16);assert.equal(report.accountability,1);
  store.ingest('missing',null,{received:0});assert.equal(coverage(store).counts.rawStored,16);assert.equal(coverage(store).counts.discovered,17);
});
test('audits measure exclusion miss rate rather than claiming recall',async t=>{
  const {store,config}=await ingestSamples(t);const ex=store.document('promo').extraction;
  await reviewDocument(store,'promo',{extraction:ex,note:'Confirmed'},config);
  const audit=createAudit(store,10);assert.equal(audit.sample.length,1);assert.equal(coverage(store).audit.negativeMissRate,null);
  labelAudit(store,'promo',false);assert.equal(coverage(store).audit.negativeMissRate.estimate,0);assert.equal(coverage(store).recall,null);
  assert.ok(wilson(0,100).upper>0);assert.equal(wilson(0,0),null);
});
test('CSV preserves integer amounts and escapes spreadsheet formulas',()=>{
  const result=csv([{id:'1',kind:'expense',merchant:'=HYPERLINK("evil")',amountMinor:1234,currency:'USD'}]);
  assert.ok(result.includes('"1234"'));assert.ok(result.includes("'=HYPERLINK"));assert.ok(result.includes('""evil""'));
});

test('plan principal is a reviewable purchase candidate and can link to the original receipt',async t=>{
  const {store,config}=await ingestSamples(t);
  const plan=store.ledger().find(row=>row.kind==='expense'&&row.sources.some(s=>s.messageId==='klarna-plan'));
  assert.equal(plan.amountMinor,10800);assert.equal(plan.quality,'needs_review');
  for(const id of ['receipt','duplicate','klarna-plan']){
    const doc=store.document(id);
    await reviewDocument(store,id,{extraction:doc.extraction,entityKey:'verified-shop-123',note:'Verified same financed purchase',acknowledgedChecks:['missing_installment_schedule']},config);
  }
  const merged=store.ledger().filter(row=>row.kind==='expense'&&row.entityId==='verified-shop-123');
  assert.equal(merged.length,1);assert.equal(merged[0].sources.length,3);assert.equal(merged[0].quality,'accepted');
});
test('imported EML without received metadata or a transaction date requires review',async t=>{
  const {store,config}=setup(t);store.ingest('eml_one',eml('Receipt','Order ID: RAW-1\nTotal: USD 10.00'),{received:0});await processPending(store,config);
  assert.equal(store.ledger()[0].quality,'needs_review');assert.ok(store.reviews().some(r=>r.reason==='ledger:unknown_transaction_date'));
});
