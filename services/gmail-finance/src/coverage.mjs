import { randomInt, randomUUID } from 'node:crypto';

export function wilson(successes, count) {
  if (!count) return null;
  const z = 1.959963984540054;
  const p = successes / count;
  const denominator = 1 + z * z / count;
  const center = (p + z * z / (2 * count)) / denominator;
  const radius = z * Math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / denominator;
  return { estimate: p, lower: Math.max(0, center - radius), upper: Math.min(1, center + radius), confidence: 0.95 };
}

export function coverage(store, config = {}) {
  const counts = Object.fromEntries(store.db.prepare('SELECT disposition,count(*) AS n FROM messages GROUP BY disposition').all().map(row => [row.disposition, row.n]));
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const raw = store.db.prepare('SELECT count(*) AS n FROM messages WHERE raw_hash IS NOT NULL').get().n;
  const reviews = store.reviews();
  const ledger = store.ledger();
  const scan = store.get('coverage');
  const audit = store.get('negative-audit');
  const labels = audit?.sample.filter(row => typeof row.financial === 'boolean') || [];
  const months = store.db.prepare("SELECT strftime('%Y-%m',received/1000,'unixepoch') AS month,count(*) AS n FROM messages WHERE received>0 GROUP BY month ORDER BY month DESC").all();
  const normalizationPending = counts.pending || 0;
  const modelPending = counts.awaiting_model || 0;
  const pending = normalizationPending + modelPending;
  const today = new Date().toISOString().slice(0, 10);
  const used = store.get(`model-usage:${today}`) || 0;
  const limit = config.modelDailyLimit ?? null;
  return {
    status: pending ? 'processing' : reviews.length ? 'needs_review' : scan?.enumerationCompleted ? 'processed_unvalidated' : 'not_synced',
    complete: false, // No audited recall/precision claim without a representative labeled evaluation.
    mailbox: store.get('mailbox')?.email || null, connection: store.get('connection')?.status || 'disconnected',
    scan, counts: { discovered: total, rawStored: raw, pending, normalizationPending, modelPending, processed: total - pending, dispositions: counts, reviewItems: reviews.length },
    accountability: total ? (total - pending) / total : null,
    ledger: { accepted: ledger.filter(r => r.quality === 'accepted').length, needsReview: ledger.filter(r => r.quality !== 'accepted').length },
    modelBudget: { used, limit, remaining: limit === null ? null : Math.max(0, limit - used),
      paused: modelPending > 0 && limit !== null && used >= limit,
      resumesAt: limit > 0 && used >= limit ? new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString() : null },
    months: months.map(row => ({ month: row.month, stored: row.n, independentlyReconciled: false })),
    audit: audit ? { id: audit.id, population: audit.population, sampled: audit.sample.length, reviewed: labels.length,
      negativeMissRate: labels.length === audit.sample.length ? wilson(labels.filter(row => row.financial).length, labels.length) : null,
      note: 'Uniform random sample of excluded messages. This estimates false negatives among exclusions, NOT overall recall.' } : null,
    recall: null, precision: null,
    limitations: ['No visibility into transactions without retained email evidence.', 'Unresolved attachments, ambiguous links and complex documents require review.',
      'Statement line-item reconciliation, OCR and real-mailbox accuracy validation are not automated in this version.'],
  };
}

export function createAudit(store, count) {
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('invalid_sample_size');
  const active = store.get('negative-audit');
  if (active && active.sample.some(row => row.financial === null)) throw new Error('finish_current_audit_first');
  const ids = store.db.prepare("SELECT id FROM messages WHERE disposition='non_financial' ORDER BY id").all().map(row => row.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = randomInt(i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const audit = { id: randomUUID(), population: ids.length, createdAt: new Date().toISOString(),
    sample: ids.slice(0, count).map(id => ({ messageId: id, documentId: store.document(id)?.id, financial: null })) };
  store.set('negative-audit', audit);
  store.log('audit.created', { auditId: audit.id, population: ids.length, sampleSize: audit.sample.length });
  return audit;
}

export function labelAudit(store, messageId, financial) {
  if (typeof financial !== 'boolean') throw new Error('financial_must_be_boolean');
  const audit = store.get('negative-audit');
  const item = audit?.sample.find(row => row.messageId === messageId);
  if (!item) throw new Error('audit_item_not_found');
  // The immutable source remains the sampled unit even if its classification is corrected later.
  item.financial = financial;
  store.set('negative-audit', audit);
  store.log('audit.labeled', { auditId: audit.id, messageId, financial });
  if (financial) store.review(messageId, 'audit:missed_financial_document', { detail: 'Correct classification/extraction before resolving this audit finding.' });
  return audit;
}
