# Bank connections in Daylark

Settings → Bank connections opens `/settings/banks`. This integration uses Plaid
Transactions only, requests up to 730 days of history on a new connection (the
institution may return less), and never calls an AI model or a payment
endpoint. No bank is linked until its owner completes Plaid Link. The history
window is only set when a connection is first created — reconnecting an
existing one re-authenticates the same Item without re-requesting history, so
widening this later means disconnecting and connecting that bank again.

## Setup

1. Apply `supabase/migrations/0028_plaid_bank_sync.sql` to the Daylark database.
   This adds server-only bank previews/tokens, atomic sync/import functions and a
   `bank_voided` flag so withdrawn bank records leave spending totals.
2. Set `PLAID_ENV=production` for Production Trial credentials, or `sandbox` for
   simulated data. Configure `PLAID_CLIENT_ID` and `PLAID_CLIENT_SECRET` (the alias
   `PLAID_SECRET` also works). There is deliberately no environment fallback.
3. Set `PLAID_REDIRECT_URI=https://YOUR-DAYLARK-HOST/settings/banks`. Add that exact
   URI in the Plaid Dashboard's allowed redirect URIs. Register/enable the OAuth
   institutions requested by Plaid. Production bank OAuth needs an HTTPS app URL;
   a local HTTPS tunnel is also suitable if both Daylark and the callback use it.
4. Open Settings → Bank connections. Connect one bank, then check its transactions.
   Plaid can need additional time to prepare historical data; check again later.
5. Review a posted transaction and choose **Save and keep synced**. Where a similar
   saved record exists, explicitly choose that record or a separate purchase.
   Matching uses amount/currency/direction and a three-day date window; similarity
   alone never silently merges bank transactions. Saved records enter the existing
   Supabase ledger used by Daylark's spending questions.

Sandbox previews cannot be imported into real spending totals. This avoids demo
data contaminating a personal account. Only USD records can currently enter the
existing cents-based ledger. Pending, removed, zero-value or unsupported amounts
remain visible but cannot be imported. Incoming credits retain the existing
income direction; this does not automatically subtract refunds from gross spending.

Saving a record authorizes subsequent bank corrections to its fields/status.
Records newly discovered later still need approval. A withdrawn or newly pending
saved record remains stored for history but is excluded from totals. Disconnecting
revokes the Plaid Item, deletes previews/tokens and retains already saved records.
Deleting spending data first disconnects banks, so sync cannot repopulate it.

## Background updates

Manual **Check transactions** works without a scheduler. The optional workflow
`.github/workflows/bank-sync.yml` calls `/api/ops/bank-sync` every four hours after
`BANK_SYNC_SCHEDULE_ENABLED=true` is set as a repository variable. It also needs
the repository variable `APP_ORIGIN` and secret `CRON_SECRET`, matching the deployed
app. The workflow must be on the default branch. It processes the four least
recently synced connections each invocation. GitHub schedules are best effort.
No scheduler is activated by adding environment keys locally.

Sync consumes Plaid's regular updates; it does not invoke the separately billed
`/transactions/refresh` endpoint. A leased worker collects all pagination results,
restarts from the original cursor on pagination mutation, and commits the complete
set of additions, modifications, removals and cursor in a database transaction.
Timeouts preserve the original checkpoint. Token payloads and provider transaction
details are encrypted using the existing application encryption key. Errors shown
to users do not include provider bodies or credentials.

Chase, Amex, Discover and Capital One access depends on the app's Plaid approval and
institution support. Apple Card automatic sync is not implemented: it requires an
iPhone/FinanceKit integration, separate from this browser flow. Gmail continues to
provide receipt and bill evidence; no automatic Gmail-to-bank matching is claimed.

## Validation

`npx vitest run src/lib/plaid src/app/api/finance/banks` uses synthetic responses,
not live accounts. `npm run check:migrations` checks migration ordering and RLS;
it does not apply the migration. Complete a real bank Link flow to verify account
coverage. Successful key validation alone is not a successful bank connection.
