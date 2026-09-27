import { normalize } from './normalize.mjs';
import { extract, ground, evaluateExtraction, modelPriority, GROUNDING_VERSION } from './extract.mjs';
import { rebuild } from './ledger.mjs';

export async function processMessage(store, id, config, { deferModel = false } = {}) {
  const message = store.message(id);
  if (!message?.raw_hash) return;
  try {
    const normalized = await normalize(store.readRaw(message.raw_hash), message, config);
    const originalOverride = store.override(id);
    const deferred = deferModel && config.modelKey && config.model && !originalOverride;
    let document = await extract(normalized, deferred ? { ...config, modelKey: '' } : config, store, originalOverride);
    if (deferred) document = { ...document, disposition: 'awaiting_model', issues: [], modelPriority: modelPriority(normalized, document.extraction) };
    const latestOverride = store.override(id);
    if (latestOverride && JSON.stringify(latestOverride) !== JSON.stringify(originalOverride)) {
      document = await extract(normalized, config, store, latestOverride);
    }
    store.saveDocument(id, document);
  } catch {
    store.db.prepare("UPDATE messages SET disposition='error' WHERE id=?").run(id);
    store.review(id, 'processing:pipeline_error', { detail: 'Normalization or storage failed. Retry after inspecting the source.' });
    store.log('pipeline.error', { messageId: id });
  }
}

export async function processPending(store, config, limit = 10, options = {}) {
  const rows = store.db.prepare("SELECT id FROM messages WHERE disposition='pending' ORDER BY received DESC LIMIT ?").all(limit);
  for (const row of rows) await processMessage(store, row.id, config, options);
  if (rows.length) rebuild(store);
  return rows.length;
}

export async function processModelPending(store, config) {
  if (!config.modelKey || !config.model) return 0;
  const day = new Date().toISOString().slice(0, 10);
  if ((store.get(`model-usage:${day}`) || 0) >= config.modelDailyLimit) return 0;
  const row = store.db.prepare(`SELECT q.* FROM model_queue q JOIN messages m ON m.id=q.message_id
    WHERE q.retry_at<=? ORDER BY q.priority DESC,m.received DESC,q.message_id LIMIT 1`).get(Date.now());
  if (!row) return 0;
  const saved = store.document(row.message_id);
  if (!saved) return 0;
  let document = await extract(saved.normalized, config, store, store.override(row.message_id));
  const override = store.override(row.message_id);
  if (override) document = await extract(saved.normalized, config, store, override);
  const failure = document.issues.find(issue => /^model_(?:http_|failed|daily_budget|incomplete_output|missing_output)/.test(issue));
  const retry = failure && row.attempts < 3 && !override;
  if (retry) document = { ...document, disposition: 'awaiting_model', modelPriority: row.priority };
  store.saveDocument(row.message_id, document);
  if (retry) store.db.prepare('UPDATE model_queue SET retry_at=?,attempts=attempts+1 WHERE message_id=?')
    .run(Date.now() + 60000 * 2 ** row.attempts, row.message_id);
  rebuild(store);
  return 1;
}

/** Upgrade existing saved evidence locally. No Gmail/model calls or changed source values. */
export function repairSavedEvidence(store, config) {
  let repaired = 0;
  for (const document of store.documents()) {
    if (document.groundingVersion === GROUNDING_VERSION || store.override(document.messageId)) continue;
    if (document.method === 'model') {
      store.saveDocument(document.messageId, evaluateExtraction(document.normalized, document.extraction, 'model'));
      repaired++;
    } else if (config.modelKey && config.model && document.issues.some(issue => issue.startsWith('model_') && issue !== 'model_input_limit')) {
      store.saveDocument(document.messageId, { ...document, groundingVersion: GROUNDING_VERSION,
        disposition: 'awaiting_model', issues: [], modelPriority: modelPriority(document.normalized, document.extraction) });
      repaired++;
    }
  }
  if (repaired) { rebuild(store); store.log('pipeline.evidence_repaired', { count: repaired, groundingVersion: GROUNDING_VERSION }); }
  return repaired;
}

export async function reviewDocument(store, id, input, config) {
  const document = store.document(id);
  if (!document) throw new Error('document_not_found');
  if (!input.note || typeof input.note !== 'string' || input.note.length > 2000) throw new Error('review_note_required');
  const result = ground(document.normalized, input.extraction);
  if (result.issues.length) throw new Error(`grounding_failed:${result.issues.join(',')}`);
  const acknowledgedIssues = input.acknowledgedIssues || [];
  const acknowledgedChecks = input.acknowledgedChecks || [];
  if (![acknowledgedIssues, acknowledgedChecks].every(items => Array.isArray(items) && items.every(x => typeof x === 'string' && x.length < 200))) throw new Error('invalid_acknowledgements');
  if (input.entityKey !== undefined && (typeof input.entityKey !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.entityKey))) throw new Error('invalid_entity_key');
  store.putOverride(id, { extraction: result.extraction, note: input.note, acknowledgedIssues, acknowledgedChecks,
    ...(input.entityKey ? { entityKey: input.entityKey } : {}), updatedAt: new Date().toISOString() });
  await processMessage(store, id, config);
  rebuild(store);
  return store.document(id);
}
