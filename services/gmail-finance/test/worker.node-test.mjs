import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { eml } from './fixtures.mjs';
import { createWorker } from '../src/worker.mjs';
import { processPending, processModelPending, repairSavedEvidence } from '../src/pipeline.mjs';
import { extractRules, evaluateExtraction, GROUNDING_VERSION, ground } from '../src/extract.mjs';
import { coverage } from '../src/coverage.mjs';

test('saved-email processing continues while Gmail download is waiting', async t => {
  const { store, config } = setup(t); store.set('connection', { status: 'connected' });
  let release, normalized = 0, extracted = 0;
  const wait = new Promise(resolve => { release = resolve; });
  const worker = createWorker(store, config, {}, {
    syncStep: () => wait,
    processPending: async (...args) => { normalized++; assert.equal(args[3].deferModel, true); },
    processModelPending: async () => { extracted++; }, intervalMs: 100000,
  });
  worker.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.phases.ingestion, true); assert.equal(normalized, 1); assert.equal(extracted, 1);
  release(); await worker.stop();
});

test('Gmail errors cannot prevent normalization or extraction', async t => {
  const { store, config } = setup(t); store.set('connection', { status: 'connected' });
  let normalized = 0, extracted = 0;
  const worker = createWorker(store, config, {}, {
    syncStep: async () => { throw new Error('quota'); }, processPending: async () => { normalized++; },
    processModelPending: async () => { extracted++; }, intervalMs: 100000,
  });
  worker.start(); await new Promise(resolve => setImmediate(resolve)); await worker.stop();
  assert.equal(normalized, 1); assert.equal(extracted, 1);
  assert.equal(store.get('worker-error:ingestion').code, 'ingestion_failed');
});

test('financial candidates get model budget first; queued mail resumes when budget renews', async t => {
  const { store, config } = setup(t); config.modelKey = 'test'; config.model = 'test'; config.modelDailyLimit = 1;
  store.ingest('promo', eml('Weekend sale', 'Shop now! Starting at USD 9.99'), { received: Date.now() });
  store.ingest('receipt', eml('Purchase receipt', 'Order ID: REAL-123\nTotal: USD 12.00'), { received: Date.now() - 1000 });
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const input = JSON.parse(JSON.parse(init.body).messages[0].content);
    const id = input.text.includes('REAL-123') ? 'receipt' : 'promo';
    if (calls === 1) assert.equal(id, 'receipt');
    const extraction = extractRules(store.document(id).normalized); extraction.confidence = 0.99;
    return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'record_financial_document', input: extraction }] }));
  };
  await processPending(store, config, 10, { deferModel: true });
  assert.equal(calls, 0); assert.equal(coverage(store, config).counts.modelPending, 2);
  await processModelPending(store, config);
  assert.equal(store.document('receipt').disposition, 'financial');
  assert.equal(coverage(store, config).modelBudget.paused, true);
  assert.equal(await processModelPending(store, config), 0); assert.equal(calls, 1);
  store.set(`model-usage:${new Date().toISOString().slice(0, 10)}`, 0);
  await processModelPending(store, config);
  assert.equal(calls, 2); assert.equal(coverage(store, config).counts.modelPending, 0);
});

test('model quote positions are computed locally but missing or altered quotes still fail', async t => {
  const { store, config } = setup(t);
  store.ingest('receipt', eml('Purchase receipt', 'Order ID: DUP-123\nOrder ID: DUP-123\nTotal: USD 12.00'), { received: Date.now() });
  await processPending(store, config);
  const doc = store.document('receipt'); const ex = structuredClone(doc.extraction);
  ex.merchant.start = 0; ex.merchant.end = 0;
  for (const ref of ex.references) { ref.start = 0; ref.end = 0; }
  const repaired = evaluateExtraction(doc.normalized, ex, 'model');
  assert.equal(repaired.disposition, 'financial'); assert.equal(ground(doc.normalized, repaired.extraction).issues.length, 0);
  ex.references[0].value = 'INVENTED-REFERENCE';
  assert.ok(evaluateExtraction(doc.normalized, ex, 'model').issues.includes('ungrounded_reference'));
  // Human edits remain strict: there is no silent re-anchoring of an override.
  assert.ok(evaluateExtraction(doc.normalized, ex, 'human', {}).issues.includes('ungrounded_reference'));
});

test('startup repairs previously saved model outputs without spending API calls', async t => {
  const { store, config } = setup(t);
  store.ingest('receipt', eml('Purchase receipt', 'Order ID: SAVED-123\nTotal: USD 12.00'), { received: Date.now() });
  await processPending(store, config);
  const doc = store.document('receipt'); delete doc.groundingVersion;
  doc.method = 'model'; doc.extraction.merchant.start = 0; doc.extraction.merchant.end = 0;
  doc.issues = ['ungrounded_reference']; doc.disposition = 'needs_review'; store.saveDocument('receipt', doc);
  assert.equal(repairSavedEvidence(store, config), 1);
  assert.equal(store.document('receipt').groundingVersion, GROUNDING_VERSION);
  assert.equal(store.document('receipt').disposition, 'financial');
  assert.equal(repairSavedEvidence(store, config), 0);
});

test('promo vs non-financial is agreement on exclusion; a financial/non-financial disagreement stays flagged', async t => {
  const { store, config } = setup(t);
  store.ingest('newsletter', eml('Weekend sale', 'Shop now and save 20%'), { received: Date.now() });
  await processPending(store, config);
  const doc = store.document('newsletter');
  const ex = { ...doc.extraction, type: 'non_financial', confidence: 0.99 };
  assert.equal(evaluateExtraction(doc.normalized, ex, 'model').disposition, 'non_financial');
  assert.ok(evaluateExtraction(doc.normalized, { ...ex, type: 'purchase_receipt' }, 'model').issues.includes('classification_disagreement'));
});
