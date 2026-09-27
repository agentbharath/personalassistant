import { hash } from './store.mjs';

export const RULES_VERSION = '1.0.0';
const transactionTypes = {
  purchase_receipt: ['expense', 'charged'], subscription_charge: ['expense', 'charged'],
  transaction_alert: ['expense', 'charged'], travel_booking: ['expense', 'charged'],
  refund: ['refund', 'refunded'], income: ['income', 'received'],
  transfer_sent: ['transfer', 'paid'], transfer_received: ['transfer', 'received'],
  installment_paid: ['transfer', 'paid'], installment_late_fee: ['fee', 'fee'], fee_or_interest: ['fee', 'fee'],
};
const obligationTypes = {
  bill_issued: 'bill', bill_reminder: 'bill', insurance_premium: 'bill', installment_due: 'installment_plan',
  installment_plan_created: 'installment_plan', installment_plan_adjusted: 'installment_plan',
  renewal_notice: 'subscription', trial_ending: 'subscription', autopay_scheduled: 'bill',
  card_statement: 'card_statement', bank_statement: 'bank_statement', loan_statement: 'loan', brokerage_statement: 'brokerage_statement',
};
const statementTypes = new Set(['card_statement', 'bank_statement', 'loan_statement', 'brokerage_statement']);

/** Pure deterministic derivation. Ambiguous links become checks, never fuzzy merges. */
export function derive(documents, overrides = new Map()) {
  const records = new Map();
  const findings = [];
  const addFinding = (document, reason, detail = {}) => {
    if (overrides.get(document.messageId)?.acknowledgedChecks?.includes(reason)) return;
    findings.push({ messageId: document.messageId, reason, ...detail });
  };
  const ordered = [...documents].sort((a, b) => (a.normalized.receivedDate || '').localeCompare(b.normalized.receivedDate || '') || a.messageId.localeCompare(b.messageId));
  for (const document of ordered) {
    const ex = document.extraction;
    if (!ex || ['promo', 'non_financial', 'unknown'].includes(ex.type)) continue;
    const n = document.normalized;
    const sender = n.sender;
    const override = overrides.get(document.messageId);
    const primary = ex.references.find(r => r.kind === 'order') || ex.references.find(r => r.kind === 'invoice') || ex.references.find(r => r.kind === 'plan');
    const entity = override?.entityKey || (primary ? hash(`${sender}:${primary.kind}:${primary.value}`) : hash(`message:${document.messageId}`));
    const merchant = ex.merchant?.value || sender || null;
    const date = n.dates[ex.dateIndex]?.date || n.receivedDate;
    const due = n.dates[ex.dueDateIndex]?.date || null;
    const moneyFor = role => ex.amounts.filter(a => a.role === role).map(a => ({ ...n.money[a.moneyIndex], role })).filter(a => a.currency && a.amountMinor !== null);
    const create = (kind, money, suffix, extra = {}) => {
      const id = hash(`${entity}:${suffix}`);
      const source = { messageId: document.messageId, documentId: document.id,
        gmailUrl: document.messageId.startsWith('eml_') ? null : `https://mail.google.com/mail/u/0/#all/${document.messageId}`,
        amount: money ? { start: money.start, end: money.end, text: money.text, currencyBasis: money.currencyBasis, role: money.role } : null,
        date: ex.dateIndex === null ? { basis: 'gmail_internal_date', timeZoneApplied: true } : n.dates[ex.dateIndex],
        dueDate: ex.dueDateIndex === null ? null : n.dates[ex.dueDateIndex] };
      const row = { id, entityId: entity, kind, merchant, amountMinor: money?.amountMinor ?? null, currency: money?.currency ?? null,
        date, dueDate: due, paymentRail: ex.paymentRail, quality: document.disposition === 'financial' ? 'accepted' : 'needs_review',
        sources: [source], versions: { extractor: document.version, rules: RULES_VERSION }, ...extra };
      const existing = records.get(id);
      if (existing) {
        if (existing.amountMinor !== row.amountMinor || existing.currency !== row.currency) {
          addFinding(document, 'conflicting_linked_amounts', { recordId: id });
          for (const previous of existing.sources) findings.push({ messageId: previous.messageId, reason: 'conflicting_linked_amounts', recordId: id });
        }
        existing.sources.push(source);
        if (row.quality !== 'accepted') existing.quality = 'needs_review';
        // Repeated bill reminders retain the earliest issued date and latest explicit due date.
        if (kind === 'obligation' && due) existing.dueDate = due;
      } else records.set(id, row);
      return id;
    };
    let rule = transactionTypes[ex.type];
    if (ex.type === 'transaction_alert' && moneyFor('charged').length === 0 && moneyFor('paid').length === 1) {
      rule = ['expense', 'paid'];
      addFinding(document, 'ambiguous_payment_purpose');
    }
    if (ex.type === 'payment_confirmation') {
      // A card mentioned as the payment METHOD does not prove credit-card debt settlement.
      const settlement = /\b(?:credit card payment|card payment received|payment (?:to|toward(?:s)?) your (?:credit card|card balance)|loan payment|mortgage payment)\b/i.test(n.text);
      rule = [ex.paymentRail === 'installment' || ex.paymentRail === 'loan' || settlement ? 'transfer' : 'expense', 'paid'];
      if (ex.paymentRail === 'card' && !settlement && !ex.references.some(r => r.kind === 'invoice' || r.kind === 'order')) addFinding(document, 'ambiguous_payment_purpose');
    }
    if (rule) {
      const [kind, role] = rule;
      const candidates = moneyFor(role);
      if (candidates.length !== 1) addFinding(document, candidates.length ? 'multiple_transaction_totals' : 'missing_transaction_amount');
      else {
        if (!date) addFinding(document, 'unknown_transaction_date');
        const payment = ex.references.find(r => r.kind === 'payment' || r.kind === 'refund');
        const installment = ex.references.find(r => r.kind === 'installment');
        const suffix = kind === 'expense' && primary ? 'expense' : `${kind}:${payment?.value || installment?.value || document.messageId}`;
        create(kind, candidates[0], suffix, { direction: kind === 'refund' || kind === 'income' || ex.type === 'transfer_received' ? 'inflow' : 'outflow' });
      }
    }
    if (obligationTypes[ex.type]) {
      const subtype = obligationTypes[ex.type];
      const candidates = moneyFor(ex.type.startsWith('installment_plan') ? 'plan_total' : ex.type === 'renewal_notice' ? 'future_renewal' : 'amount_due');
      if (candidates.length > 1) addFinding(document, 'multiple_obligation_totals');
      const schedule = ex.schedule.map(item => ({ dueDate: n.dates[item.dateIndex]?.date, amountMinor: n.money[item.moneyIndex]?.amountMinor,
        currency: n.money[item.moneyIndex]?.currency, status: 'pending', evidence: { amount: n.money[item.moneyIndex], date: n.dates[item.dateIndex] } }));
      create('obligation', candidates.length === 1 ? candidates[0] : null, `obligation:${subtype}`, { subtype, status: 'open', schedule });
      if (!candidates.length) addFinding(document, 'unknown_obligation_amount');
      if (!due && !schedule.length) addFinding(document, 'unknown_due_date');
      if (ex.type === 'installment_plan_created') {
        if (!schedule.length) addFinding(document, 'missing_installment_schedule');
        // Principal can be a purchase candidate, but its date/link must be confirmed before acceptance.
        if (candidates.length === 1) create('expense', candidates[0], 'expense', { direction: 'outflow', purchaseFromPlan: true });
        addFinding(document, 'plan_purchase_link_required');
      }
      if (statementTypes.has(ex.type)) {
        create('statement', null, `statement:${ex.type}`, { subtype: ex.type,
          fields: ex.amounts.map(a => ({ role: a.role, ...n.money[a.moneyIndex] })) });
        addFinding(document, 'statement_reconciliation_required');
      }
    }
    if (['payment_failed', 'installment_failed', 'installment_plan_adjusted', 'installment_plan_paid_off', 'tax_document', 'travel_change'].includes(ex.type)) {
      addFinding(document, 'lifecycle_review_required');
    }
  }
  const all = [...records.values()];
  const byMessage = new Map(documents.map(doc => [doc.messageId, doc]));
  const byEntity = new Map();
  for (const row of all) {
    if (!byEntity.has(row.entityId)) byEntity.set(row.entityId, []);
    byEntity.get(row.entityId).push(row);
  }
  for (const record of all) {
    const related = byEntity.get(record.entityId);
    if (record.kind === 'refund' && !related.some(r => r.kind === 'expense')) for (const source of record.sources) {
      addFinding(byMessage.get(source.messageId), 'orphan_refund', { recordId: record.id });
    }
    if (record.kind === 'transfer' && ['installment', 'loan'].includes(record.paymentRail) && !related.some(r => r.kind === 'obligation')) {
      for (const source of record.sources) addFinding(byMessage.get(source.messageId), 'orphan_repayment', { recordId: record.id });
    }
    if (record.kind === 'expense' && record.sources.some(source => byMessage.get(source.messageId).extraction.type === 'purchase_receipt')) {
      for (let i = findings.length - 1; i >= 0; i--) if (findings[i].reason === 'plan_purchase_link_required' && record.sources.some(s => s.messageId === findings[i].messageId)) findings.splice(i, 1);
    }
    if (record.kind === 'obligation') {
      const payments = related.filter(r => ['expense', 'transfer'].includes(r.kind) && r.quality === 'accepted' && r.currency === record.currency);
      if (record.subtype !== 'installment_plan' && payments.some(p => p.amountMinor === record.amountMinor)) record.status = 'paid';
      const used = new Set();
      for (const schedule of record.schedule) {
        const payment = payments.find(p => !used.has(p.id) && p.amountMinor === schedule.amountMinor && p.currency === schedule.currency && p.date === schedule.dueDate);
        if (payment) { used.add(payment.id); schedule.status = 'paid'; schedule.paymentId = payment.id; }
      }
      if (record.schedule.length && record.schedule.every(s => s.status === 'paid')) record.status = 'paid';
    }
  }
  // Only mark potential duplicates. Same merchant/amount/day is NOT a safe dedup key.
  const duplicateGroups = new Map();
  for (const row of all) {
    if (!['expense', 'refund', 'transfer'].includes(row.kind)) continue;
    const key = JSON.stringify([row.kind, row.merchant, row.amountMinor, row.currency, row.date]);
    if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
    duplicateGroups.get(key).push(row);
  }
  for (const group of duplicateGroups.values()) if (group.length > 1) {
    for (const row of group) for (const source of row.sources) addFinding(byMessage.get(source.messageId), 'possible_duplicate', { records: group.map(r => r.id) });
  }
  const disputed = new Set(findings.map(f => f.messageId));
  for (const row of all) if (row.sources.some(s => disputed.has(s.messageId))) row.quality = 'needs_review';
  return { records: all.sort((a, b) => a.id.localeCompare(b.id)), findings };
}

export function rebuild(store) {
  const documents = store.documents();
  const overrides = new Map(documents.map(doc => [doc.messageId, store.override(doc.messageId)]));
  const result = derive(documents, overrides);
  store.atomic(() => {
    store.db.prepare("UPDATE reviews SET status='superseded' WHERE reason LIKE 'ledger:%' AND status='open'").run();
    for (const finding of result.findings) store.review(finding.messageId, `ledger:${finding.reason}`, finding);
  });
  store.replaceLedger(result.records);
  return result;
}

export function csv(records) {
  const cell = value => {
    let text = value === null || value === undefined ? '' : String(value);
    // Prevent formula injection when a merchant or reference is opened in a spreadsheet.
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const fields = ['id', 'kind', 'date', 'merchant', 'amountMinor', 'currency', 'direction', 'quality', 'entityId'];
  return [fields.map(cell).join(','), ...records.map(row => fields.map(key => cell(row[key])).join(','))].join('\r\n');
}
