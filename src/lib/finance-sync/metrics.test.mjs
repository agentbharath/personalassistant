import { expect, it } from 'vitest';
import { metrics } from '../../../scripts/finance-sync-metrics.mjs';
const gold = [
 {id: 'a', classification: 'receipt', transaction: {amountMinor: 1000, currency: 'USD', merchant: 'Shop', date: '2026-09-01'}, transactionKey: 'order1'},
 {id: 'b', classification: 'receipt', transaction: {amountMinor: 1000, currency: 'USD', merchant: 'Shop', date: '2026-09-01'}, transactionKey: 'order1'},
 {id: 'c', classification: 'promo'},
];
it('measures exact labeled outputs without any live provider', () => {
 expect(metrics(gold, gold)).toMatchObject({classifierPrecision: 1, classifierRecall: 1, amountAccuracy: 1, dateAccuracy: 1, merchantAccuracy: 1, dedupErrorRate: 0});
});
it('counts missing predictions against recall and extraction', () => {
 expect(metrics(gold, [gold[0]])).toMatchObject({classifierRecall: 0.5, amountAccuracy: 0.5, dedupErrorRate: 1});
});
it('counts false positives and split duplicate purchases', () => {
 expect(metrics(gold, [{...gold[0]}, {...gold[1], transactionKey: 'other'}, {id: 'c', classification: 'receipt'}])).toMatchObject({classifierPrecision: 2 / 3, dedupErrorRate: 1});
});
it('rejects predictions belonging to a different test set', () => expect(() => metrics(gold, [{id: 'foreign'}])).toThrow());
