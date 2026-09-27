# Gmail Finance — personal standalone service

A locally running HTTP service that connects to **your own Gmail**, archives retained messages, extracts financial evidence, and produces a ledger with a review queue. It has its own package, database, encrypted archive, API, and small browser console. It does not depend on the parent Next.js application or its credentials.

**This is a working personal v0.1, not a validated “100% accurate” extractor.** Source grounding prevents invented amounts and references from being accepted. It does not prove the semantic meaning of every email. Unsupported layouts and uncertain records need review. Bank transactions without email cannot be recovered. `complete` stays `false`, and overall recall/precision remain `null` until a representative, labeled mailbox evaluation exists.

## Run it

Requires Node.js **22.20 or newer**. Node 22 reports its built-in SQLite module as experimental. No external database, cloud account, or model key is needed for the synthetic demo.

```sh
cd services/gmail-finance
npm ci
npm run demo
```

Open **http://127.0.0.1:4320**. Paste the `SERVICE_API_KEY` from `demo-data/demo.env` into the console. The demo includes receipts, duplicate order confirmations, a refund, a utility bill and payment, a subscription, dues, a card statement/payment, Klarna/Affirm repayments, and a promotion. Its credentials and data are isolated from your real account. Use `npm run demo -- --no-server` to generate the fixtures and CSV without starting a listener.

For your real mailbox:

```sh
npm run init
# Edit .env using the Google setup below.
npm start
```

`init` creates random encryption/API keys and refuses to overwrite an existing `.env`. If `.env` already exists, edit it directly. Open **http://127.0.0.1:4318**, enter its `SERVICE_API_KEY`, and choose **Connect Gmail**. After Google's consent redirect, enter the key again; it is kept only in browser memory. Full sync starts automatically. The service must stay running for background ingestion and 15-minute incremental polling.

### Google OAuth setup

1. Create or select a Google Cloud project and enable the **Gmail API**.
2. Configure the OAuth consent screen for personal testing and add your own Gmail address as a test user. Declare only `https://www.googleapis.com/auth/gmail.readonly`.
3. Create an OAuth client of type **Web application**. Add this exact authorized redirect URI: `http://127.0.0.1:4318/oauth/callback`.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_ALLOWED_EMAIL` in this service's `.env`. The email must match the account you connect. Check `HOME_CURRENCY` and `TIME_ZONE` too.
5. Start the service and complete Google's consent flow in the browser. An email address alone cannot authorize access.

Testing-mode refresh tokens can expire after seven days for these scopes. Reconnect when the coverage screen shows `reauth required`. Personal-use verification exceptions and public-distribution requirements are described in Google's [restricted-scope documentation](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification). See the [OAuth server flow](https://developers.google.com/identity/protocols/oauth2/web-server) for client configuration and token handling.

### Optional model extraction

With no model settings, the service uses conservative generic rules and sends uncertainty to review. In particular, it **does not silently discard non-financial emails on one classifier's decision**. This intentionally creates a large review queue on a general mailbox.

To enable Anthropic extraction, set both `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` to a model available to your account, then restart. **This sends normalized email and attachment text to Anthropic.** The model has no tools capable of fetching links, changing mail, or making payments. Its output must match a strict schema and pass local source-grounding checks. Financial/non-financial disagreement with the rule classifier stays in review; `promo` and `non_financial` agree on exclusion. Models quote literal source text; the service computes character positions by exact matching instead of relying on model-generated offsets. Absent or altered quotes still fail validation.

Gmail downloading, local normalization and model extraction run independently. A durable model queue prioritizes likely financial messages over newsletters/promotions. Requests are limited by `MODEL_DAILY_CALL_LIMIT` (100 by default, UTC day); when the budget is exhausted, queued model work pauses and **resumes automatically the next UTC day**. The UI reports the limit and resume time. Temporary model failures retry with backoff (up to three retries); persistent failures remain review items. Successful schema-valid outputs are encrypted and cached by content, model and pipeline version, so unchanged messages do not consume the budget again on reprocessing. Set the limit to 0 to prevent new model calls. Raise it deliberately for a large mailbox, or use local review instead.

The table refreshes automatically every ten seconds and includes clearly marked records needing review by default. You can hide them with the checkbox. **Export accepted CSV** includes only accepted transactions; the API supports explicit `includeReview=true` exports. On startup, this version also repairs previously saved model evidence positions locally, without additional Gmail or model requests.

## Implemented behavior

| Area | Behavior |
| --- | --- |
| Gmail | Read-only OAuth, PKCE, browser-bound one-time state, pinned owner, encrypted refresh token, explicit reauthentication state |
| Ingestion | Entire retained mailbox, including spam/trash; no keyword/sender filter or start date; durable page checkpoints and ID idempotency |
| Recovery | Captures history before backfill and replays it afterward; incremental history paging; exponential retry, quota backoff, full rescan on expired history |
| Accountability | Every discovered ID is pending, financial, non-financial, needs review, unavailable, or error; failures are visible |
| Sources | Immutable encrypted raw MIME with integrity hashes; append-only versioned documents; source downloads; normalization reruns locally |
| Attachments | Text/CSV and PDF text extraction; PDF work isolated with a 30-second time limit, memory limit, 100-page limit, and 15 MiB input limit; locked, scanned, invalid, oversized and other attachments flagged |
| Money | Integer minor units, original currency, source character offsets; common decimal formats; ambiguous amounts rejected; bare `$` follows the configured home-currency policy only when not contradicted by explicit currency |
| Dates | Explicit ISO and English month-name dates; receipt date falls back to Gmail's received date in your configured timezone; ambiguous date formats require review |
| Ledger | Purchases/charges, refunds, subscriptions, bills/dues, repayments, statements, transfers, income, fees, and installment-plan candidates |
| Installments | Separate principal/purchase candidates, obligations and explicit schedules; repayments are transfers; arithmetic checks; cross-sender purchase linking through review |
| Review | Source text, amount/date selection, exact evidence fields, corrections, shared entity keys, explicit acknowledged limitations, encrypted audit log; overrides survive reprocessing |
| Export | Authenticated paginated JSON and CSV; accepted transactions by default; include flagged candidates explicitly; no cross-currency summation |
| Quality | Disposition/scan reports, pending counts, open checks and a uniform random audit of excluded emails; a Wilson interval for the **miss rate among exclusions**, not a mislabeled overall recall claim |

### Accounting choices

- An order's purchase is spending once. Repeated receipts with the same sender and exact order reference become sources on the same expense. Shipment/delivery notices create no new charge.
- An issued bill is an obligation. Its confirmed payment is an expense, linked by its exact invoice reference. Merely paying **with** a Visa does not make that bill payment a transfer.
- A credit-card, loan, or installment repayment is a transfer, not another expense. Statement balances and minimum payments are not purchases.
- Refunds are separate inflows, never negative purchases guessed from a balance. Refunds without a linked purchase require review.
- A plan's full principal becomes a purchase **candidate** needing confirmation of the original purchase, and an obligation. Link the merchant receipt and provider email by assigning the same unique shared record key. This merges the purchase, leaving repayments separate. Incomplete schedules remain explicit review findings.
- Matching amount/date alone never merges two purchases. Possible duplicates are held for review. In this version exact keys are scoped to the sender address; receipts from different addresses need an explicit shared key.
- `accepted` means passed the implemented checks or reviewed by you. It is not an independently audited accuracy score. Human decisions can acknowledge a limitation with a note, but cannot bypass amount/date/reference grounding.

### Scope that still needs human review or further implementation

The supplied design is a reference, not a claim that its entire production roadmap is implemented. This personal version deliberately exposes these gaps:

- OCR for scanned PDFs/images, password entry for encrypted PDFs, multilingual templates, arbitrary numeric date formats, and complex HTML/forwarded content.
- Statement transaction-row extraction/reconciliation, complex multi-transaction emails, plan adjustments, fee allocation and full provider-specific lifecycle automation. Statement totals and evidence are available, but the line items are not silently imported as transactions.
- Automated schedule inference, subscription cadence-gap searches, universal merchant identity resolution, sender-parser generation, model adjudication/batches, automated precision audits, or validated recall targets. The model schema can express explicit schedules; generic rules do not infer them.
- Monthly closed-window reconciliation: this version does one unfiltered paginated enumeration with history replay. Month summaries are stored counts, **not independently reconciled month guarantees**. Gmail's mutable profile count is a sanity check, not an atomic snapshot. Deleted/missing messages are explicit gaps, and external deletions do not erase previously archived historical evidence.
- Cloud multi-tenancy, PostgreSQL/RLS, S3/KMS, distributed queues, push notifications/webhooks, cloud deployment, or public-service security verification. This is a single-process service bound to **127.0.0.1**. Use a fresh data directory and key for a different mailbox.

The expired-history fallback intentionally differs from the reference document: it rescans the **whole** mailbox, because older-dated imported mail could otherwise be lost. This follows [Gmail's synchronization guidance](https://developers.google.com/workspace/gmail/api/guides/sync). Enumeration follows the [Gmail messages.list API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).

## API

All `/api/*` endpoints require `Authorization: Bearer <SERVICE_API_KEY>`. `/health` and static console files are public on loopback. The OAuth callback is protected by its expiring state, browser-binding cookie and PKCE. Requests from other origins/hosts are rejected; no CORS access is enabled.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness; no private state |
| POST | `/api/oauth/start` | Get a Google authorization URL and set the browser-binding cookie |
| GET | `/oauth/callback` | Google authorization callback |
| POST | `/api/sync` | Queue incremental sync; body `{ "full": true }` requests full enumeration |
| GET | `/api/coverage` | Connection, scan progress, dispositions, quality limits, audit state |
| GET | `/api/ledger` | Transactions; excludes obligations/statements |
| GET | `/api/obligations` | Bills, dues, plans, upcoming obligations |
| GET | `/api/statements` | Statement evidence and extracted fields |
| GET | `/api/export.csv` | Transaction CSV; integer `amountMinor` plus `currency` |
| GET | `/api/reviews` | Open review findings |
| GET | `/api/messages` | All message IDs and dispositions |
| GET | `/api/messages/:id` | Source normalization, extraction, saved override |
| GET | `/api/messages/:id/source` | Download original `.eml` |
| POST | `/api/messages/:id/review` | Save a grounded correction and rebuild |
| POST | `/api/reprocess` | Retry saved messages; preserve human overrides |
| POST | `/api/rebuild` | Rebuild ledger from current documents and overrides |
| GET / POST | `/api/audit` | Read/create exclusion audit; creation body `{ "count": 100 }` |
| POST | `/api/audit/label` | `{ "messageId": "...", "financial": true }` |
| POST | `/api/disconnect` | Remove local Gmail credentials, retaining archive; retry if worker is busy |

List endpoints accept `limit` (1–1000, default 100) and `offset`. Ledger/obligations/statements/CSV additionally accept `includeReview=true`, `kind`, `currency`, `from=YYYY-MM-DD`, and `to=YYYY-MM-DD`. For example, after setting the API key as a shell variable:

```sh
curl -H "Authorization: Bearer $SERVICE_API_KEY" \
  'http://127.0.0.1:4318/api/ledger?currency=USD&from=2026-01-01&limit=100'

curl -H "Authorization: Bearer $SERVICE_API_KEY" \
  'http://127.0.0.1:4318/api/export.csv' -o transactions.csv
```

Review request shape (get the current `extraction` from the message endpoint first):

```json
{
  "extraction": "REPLACE WITH THE EXTRACTION OBJECT FROM THE MESSAGE ENDPOINT",
  "note": "Verified the original purchase and its payment plan",
  "entityKey": "my-unique-purchase-123",
  "acknowledgedIssues": [],
  "acknowledgedChecks": []
}
```

`extraction` is a strict object defined in `src/schema.mjs`, not a string. Amounts and dates refer to the normalized document's indexed mentions; merchant/reference/rail fields use exact source offsets. The console builds this object for ordinary edits and provides advanced fields for schedules and references. Acknowledging a limitation records your decision; it does not recover absent evidence.

### Import saved emails

```sh
npm run import -- /path/to/receipt.eml /path/to/statement.eml
```

Imports use content hashes as IDs and do not contact Gmail. Arbitrary EML files lack trusted Gmail received timestamps; transactions without explicit dates require review. Import and server processes should not run simultaneously against the same data directory.

## Storage and operations

`data/finance.sqlite` holds encrypted tokens, normalized/extracted content, ledger payloads, overrides and audit details. `data/blobs/` holds AES-256-GCM encrypted raw MIME, addressed by SHA-256. Encryption uses a random nonce and context-specific authenticated data. Gmail IDs, received timestamps, hashes, disposition codes, ledger kind/date indexes and review reason codes remain visible in SQLite; it is not whole-database encryption.

`.env` contains the local encryption key and API key. Keep it private and back it up separately from the database/archive. The directory is mode 0700, sensitive files are 0600, and process file creation uses umask 077. Anyone able to read both `.env` and the archive can decrypt it. There is no KMS/key rotation or backup crypto-erasure in this personal version.

Stop the service before copying `.env` and the **entire** data directory for a consistent backup. To remove all local history, stop the service and remove its dedicated data directory; revoke app access in your Google account if desired. Do not delete your encryption key while you still need the archive.

`HOME_CURRENCY` is a parsing policy, not FX conversion. Changing it or the timezone requires reprocessing. API/model keys are not logged; raw email HTML is never executed by the console; email is displayed as plain text. CSV string cells neutralize leading formula characters.

## Validation

```sh
npm test
npm audit --omit=dev
```

The isolated Node test suite covers real MIME/PDF normalization, amount precision and ambiguity, dates, hallucination rejection, arithmetic, expense/transfer separation, duplicates, overrides, plan linking, encrypted storage, audit semantics, pagination/crash recovery, expired history, quota retry, revocation, OAuth isolation and authenticated HTTP APIs. Fixtures are synthetic; these results do **not** establish live Gmail recall or provider-template accuracy. The HTTP test needs permission to bind loopback.

The service test filenames deliberately use `.node-test.mjs` so the parent application's Vitest suite does not discover them. Runtime source is native ECMAScript modules, so no build tool or parent TypeScript configuration is needed.

## Code map

`gmail.mjs` / `sync.mjs` handle authorization and ingestion; `store.mjs` handles encryption and persistence; `normalize.mjs` and the isolated PDF worker create source evidence; `schema.mjs` / `extract.mjs` validate extraction; `ledger.mjs` derives accounting records; `pipeline.mjs` applies reviews; `coverage.mjs` reports gaps/audits; `server.mjs` exposes the API/worker; `web/` is the review console.
