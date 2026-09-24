# Offline finance sync evaluation

No live AI evaluation is run automatically. This directory does not contain fabricated "hand-labeled" private email examples.

Build a private set of about 200 last-month messages, including receipts, refunds, bills, statements, shipping, promotions, transfers, all senders, and difficult negatives. Store it under ignored `evals/candidates/finance-sync/`. Independently label each message before comparing model outputs; include both positive and negative messages to measure recall rather than only accepted imports.

Each JSONL label/prediction uses:

```json
{"id":"redacted-sample-001","classification":"receipt","transaction":{"merchant":"Example Store","amountMinor":1000,"currency":"USD","date":"2026-09-20"},"transactionKey":"purchase-a"}
```

Negative rows omit `transaction` and `transactionKey`. Related receipt/payment evidence for the same purchase shares a key; separate purchases have distinct keys. Refunds are separate financial records. Dedup metrics compare pair equivalence, not the spelling of arbitrary keys. Missing predictions count against recall and extraction accuracy.

Run `node scripts/finance-sync-metrics.mjs labels.jsonl predictions.jsonl` after a prompt/model change. It reports classification precision/recall, full classification accuracy, amount+currency/date/merchant accuracy, and pairwise dedup error. It reads local files only. Model-generated predictions and hand-labeling of the real 200-message sample remain separate steps; there is no live-eval command in this workflow.
