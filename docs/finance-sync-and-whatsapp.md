# Finance sync and the morning WhatsApp digest

This adapts the proposed plan to the existing Daylark architecture. It does **not** replace the finance schema or introduce a second ledger, LangGraph runtime, or model-generated SQL. Existing `finance_transactions`, `finance_transaction_sources`, bills, typed spending queries, encrypted workflow checkpoints and expiring approvals remain authoritative. Two-way WhatsApp chat is not implemented.

## What changed

- Migration `0024_finance_sync_and_digest.sql` adds sync state, pending/rejected/blocked candidates, a hashed sender registry, a daily digest delivery log, and one optional order-reference hash on transaction sources, plus an atomic ledger/source insertion function. Existing amounts, directions, bills and finance records are unchanged. Explicitly different order numbers remain separate purchases even at identical amounts/dates; creating a transaction and its first source is atomic. Approval history records user verification instead of adding a redundant `user_verified` column.
- Google connection queues initial full-history coverage when enabled. Spending questions only read saved transactions and coverage status; they do not scan mail or interrupt the answer with an approval. Workers process queued scans and queue incremental runs for idle accounts. Read-only searches never import anything.
- Discovery freezes a `before:<timestamp>` window for full history, adding `after:<timestamp>` for incremental windows with one day of overlap for late arrivals. Primary and Updates are prioritized, with other categories checked afterward; pages run newest first within each phase. Known message IDs are skipped before metadata reads, and classified candidates are checkpointed before full-body extraction. The worker classifies 20 summaries per call (the classifier accepts at most 50), with up to 30 seconds bounded by the request deadline. Gmail pacing, cooldown and pagination reuse the existing transport.
- Every sender remains eligible. Sender history is stored but deliberately **not a domain-wide exclusion**: a sender can send promotions and receipts. UPI remains excluded as requested. Shipping-only updates do not create transactions.
- Complete schema.org `Order` markup can supply a purchase without another model call, but must pass the same amount/date/currency/order validation. Incomplete markup and invoices use ordinary extraction. Ambiguous or ungrounded records stay visibly blocked on Perch. This sync path requires readable body evidence; statement emails whose amounts only exist in an attachment or behind a sign-in link can need manual review. The existing dues-import attachment flow remains available.
- The review identifies matching order/source evidence and proposed merchant/amount matches within two days. Confirm uses existing import approval handling; Cancel rejects only that displayed batch. Bills go to the existing dues table, refunds use the existing income direction with their refund type in the note/evidence, and card payments/remittances use transfer. Refunds are retained separately; existing spending totals remain gross expenses, not net-of-refund totals.
- Scan coverage advances only after discovery finishes and all candidates are approved, rejected or ignored as nonfinancial. Missing evidence blocks coverage until retried or explicitly excluded. Approval expiry leaves candidates available for a new review. Review batches contain at most 50 items. Perch offers progress, review, retry, explicit exclusion of unreadable records, and a resumable 90-day backfill. A new backfill never overwrites an unfinished scan.
- Google `invalid_grant` prompts reconnection. A transient token endpoint outage no longer incorrectly asks the user to reconnect. Gmail read access is unchanged; existing optional Gmail draft permissions are untouched.

## Enable finance sync on Vercel Hobby

1. Apply pending migrations, including **0023 and 0024**, before deploying this version. Run the existing migration validation first. These files being present does not mean the production database has been migrated.
2. Set `FINANCE_SYNC_ENABLED=true` in Vercel. Keep `CRON_SECRET` set to a strong secret.
3. In GitHub repository **Settings → Secrets and variables → Actions**, set repository variables `APP_ORIGIN` to the production HTTPS origin and `FINANCE_SYNC_SCHEDULE_ENABLED=true`; set repository secret `CRON_SECRET` to the same value as Vercel. The workflow `.github/workflows/finance-sync.yml` must be on the default branch. It invokes the authenticated worker every five minutes and can also be run manually. It does not run model evaluations.
4. Deploy and open Perch. “Check new email” queues a scan; “Scan last 90 days” queues the initial backfill. Neither changes the ledger. Review the finished batch in chat and choose Confirm or Cancel.

The worker takes a versioned lease so repeated schedules and interactive freshness checks cannot process the same scan concurrently. A crashed worker's lease expires after five minutes. It checks up to four users per invocation and checkpoints each bounded batch. Completion time depends on mailbox size, Gmail limits and the existing model budget. Requests remain bounded by the app's daily token and per-request cost limits. Provider failures keep progress; they never advance the watermark.

Hobby permits only daily cron expressions, so `vercel.json` contains only the two daily digest schedules. Frequent finance work uses GitHub Actions instead. GitHub schedules are best effort, may be delayed, and can be disabled after 60 days without activity in a public repository; this is not a strict five-minute completion guarantee. Watch Actions failures if a scan remains queued. A private repository's Actions allowance also applies. Sources: [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [GitHub scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Set up WhatsApp

This is a single-owner, outbound template digest. No messages are sent by tests, migrations, builds, or disabled configuration.

1. In Meta, create/configure the business app and WhatsApp product, connect the WhatsApp Business Account, and verify your recipient number. For the test number, add yourself to its permitted recipients.
2. Create a system-user token with the appropriate WhatsApp business messaging/management permissions and access to the app/account. Store it in deployment secrets; do not paste it into chat or commit it. Use a supported Graph API version from your Meta dashboard.
3. Submit a `daily_digest` template in `en_US` for approval. Request Utility categorization; Meta controls approval and category. Use this exact four-variable body (variable 2 is a full sentence so unavailable/partial email checks never become a false zero count):

   > Good morning. Today you have {{1}}. {{2}} {{3}} See your day: {{4}}

   Example values: `2 calendar events, first timed event at 10:00 AM`; `3 emails may need your reply.`; `Including PG&E and Alex.`; `https://your-app.example/perch`.

4. Set Vercel environment variables:

   | Variable | Value |
   | --- | --- |
   | `WHATSAPP_DIGEST_ENABLED` | `true`, only after setup is complete |
   | `WHATSAPP_DIGEST_USER_ID` | Your Supabase user UUID |
   | `WHATSAPP_ACCESS_TOKEN` | System-user token (secret) |
   | `WHATSAPP_PHONE_NUMBER_ID` | Meta sender phone-number ID |
   | `WHATSAPP_RECIPIENT` | Your verified international number, digits only |
   | `WHATSAPP_GRAPH_VERSION` | Supported version, e.g. `vNN.0` replaced with a real version |
   | `WHATSAPP_DIGEST_TEMPLATE` | Approved template name; defaults to `daily_digest` |
   | `APP_ORIGIN` | Production HTTPS origin |
   | `CRON_SECRET` | Same strong bearer secret used by the worker |

5. Deploy. Vercel calls the digest at 14:00 and 15:00 UTC; code only sends during the 7 AM hour in `America/Los_Angeles`. On Hobby, execution can occur later within that hour, so this is **not an exact 7:00 AM alarm**. The daily claim prevents the two slots or simultaneous retries sending twice. [Vercel scheduling and authentication](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [Meta template request reference](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).

Perch and the digest share `buildDaySummary`/`loadDaySummaryParts`; Perch still streams its reply section independently. The digest respects Perch enablement, reply reminder opt-in, selected categories and dismissed threads. Missing service data is described as unavailable, and partially checked reply lists are labeled “so far.” All template parameters are single-line. Meeting/reply bodies and credentials are not written to `digest_log`.

Delivery is at-most-once attempt per user/day, not guaranteed delivery. `sent` means Meta accepted a message ID. A timeout after submission is `unknown` and is not retried automatically because Meta may already have accepted it. `failed` means no successful submission is known. A stale `claimed` row may indicate a process interruption. Check the provider before manually clearing any delivery claim; there is intentionally no automatic replay that could send duplicates.

## Validation and remaining setup

Offline tests use fake Gmail, model, Meta and database services. They check classification IDs, evidence grounding, order matching, source skips, lease contention, partial scans, watermark gates, approval candidate resolution, reconnect behavior, DST, template parameters and duplicate/ambiguous delivery. No live AI evaluations run.

The real 200-email labeled set is **not populated**. `evals/finance-sync/README.md` describes the private JSONL format, and `scripts/finance-sync-metrics.mjs` computes precision, recall, amount/date/merchant accuracy and dedup error from local labels/predictions. Do not treat mocked tests as measured model accuracy.

Meta provisioning/template approval, deployment environment values, repository scheduler configuration, database migration application, and deployment remain external setup steps. Turning off either feature flag stops new work for that feature without changing existing finances.

Initial sync now queues full mailbox history on Google connection, excluding spam, trash and UPI; repeated sign-ins preserve the active scan. Subsequent idle worker runs queue incremental scans with a one-day overlap. Finance questions only read saved totals and coverage; they do not start scans or replace the answer with review. Local activation does not enable the deployment scheduler. Pending review/blocked runs must still be resolved before the next incremental run.
