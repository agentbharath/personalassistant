import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const positive = kind => ['receipt', 'refund', 'bill_due', 'statement', 'transfer'].includes(kind);
const norm = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Offline comparison only: no providers, credentials or model calls. */
export function metrics(gold, predictions) {
  const labels = new Map(gold.map(row => [row.id, row]));
  const actual = new Map(predictions.map(row => [row.id, row]));
  if (labels.size !== gold.length || actual.size !== predictions.length || predictions.some(row => !labels.has(row.id))) throw new Error('IDs must be unique and predictions must belong to the labeled set');
  let tp = 0, fp = 0, fn = 0, amount = 0, date = 0, merchant = 0, extractionCount = 0, correctClass = 0;
  for (const expected of gold) {
    const predicted = actual.get(expected.id);
    if (predicted?.classification === expected.classification) correctClass++;
    if (positive(expected.classification)) { if (positive(predicted?.classification)) tp++; else fn++; }
    else if (positive(predicted?.classification)) fp++;
    if (expected.transaction) {
      extractionCount++;
      if (predicted?.transaction?.amountMinor === expected.transaction.amountMinor && predicted?.transaction?.currency === expected.transaction.currency) amount++;
      if (predicted?.transaction?.date === expected.transaction.date) date++;
      if (norm(predicted?.transaction?.merchant) === norm(expected.transaction.merchant)) merchant++;
    }
  }
  let pairCount = 0, dedupErrors = 0;
  const duplicateLabels = gold.filter(row => row.transactionKey);
  for (let i = 0; i < duplicateLabels.length; i++) for (let j = i + 1; j < duplicateLabels.length; j++) {
    const a = duplicateLabels[i], b = duplicateLabels[j];
    const pa = actual.get(a.id)?.transactionKey, pb = actual.get(b.id)?.transactionKey;
    pairCount++;
    if (!pa || !pb || (a.transactionKey === b.transactionKey) !== (pa === pb)) dedupErrors++;
  }
  const ratio = (a, b) => b ? a / b : null;
  return {samples: gold.length, predicted: predictions.length, classifierPrecision: ratio(tp, tp + fp), classifierRecall: ratio(tp, tp + fn), classificationAccuracy: ratio(correctClass, gold.length), amountAccuracy: ratio(amount, extractionCount), dateAccuracy: ratio(date, extractionCount), merchantAccuracy: ratio(merchant, extractionCount), dedupErrorRate: ratio(dedupErrors, pairCount), dedupPairs: pairCount};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [goldPath, predictionPath] = process.argv.slice(2);
  if (!goldPath || !predictionPath) throw new Error('Usage: node scripts/finance-sync-metrics.mjs labels.jsonl predictions.jsonl');
  const read = async path => (await readFile(path, 'utf8')).split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  const [gold, predicted] = await Promise.all([read(goldPath), read(predictionPath)]);
  console.log(JSON.stringify(metrics(gold, predicted), null, 2));
  if (gold.length < 200) console.warn('Fewer than 200 hand-labeled examples: this is not the planned full evaluation set.');
}
