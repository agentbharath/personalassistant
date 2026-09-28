# Private financial deployment

This change is a hardening implementation, not a certification or a claim of perfect security. Do not deploy the application independently of the database migration and backfill below.

## Storage boundary

AES-256-GCM encrypts financial values in the application before database transport. New transaction and bill envelopes use authenticated context containing the table and owner ID. Copying those envelopes between users or tables fails authentication. Existing token/evidence ciphertext remains compatible with the original encryption key.

Encrypted: amounts, currencies, transaction dates/directions/categories, bill statement/due/payment dates and status, merchant names and notes, provider payloads and account details, bank identity and Plaid item IDs, access tokens, sync cursors, stored conversation text and financial approval payloads. Bank pending state is read from the encrypted provider payload.

Visible operational metadata remains: random record/user IDs, relationships, creation/update/sync times, row counts, source types, import classification, connection/processing/removal flags, and keyed hashes used for deduplication. This leaks some activity and equality patterns. It is not an encrypted database filesystem or an end-to-end encrypted service. The authenticated app must decrypt data in memory to answer questions and render it over HTTPS. A user-requested account export is intentionally readable and is protected by authentication, owner restrictions, rate limits and no-store headers; protect the downloaded file yourself.

Because dates and amounts are encrypted, financial filtering and matching now happen in server memory after owner-scoped, paginated reads. This suits a personal account but will need a measured indexing strategy before large multi-user deployment. No shared plaintext ledger cache is used. Original evidence, merchant names and bank credentials retain the compatible v1 envelope; new structured financial fields use v2 owner/table binding.

## Cutover (maintenance window)

1. Preserve the **existing** APP_ENCRYPTION_KEY and PII_HMAC_KEY in a separate secure backup. Do not generate replacement keys. The migration cannot recover data encrypted with a lost key. Both secrets must be independent, randomly generated and at least 32 bytes long. Store production secrets in the deployment secret manager, never NEXT_PUBLIC variables.
2. Configure DAYLARK_ALLOWED_USER_IDS with your immutable Supabase auth user UUID. Production denies application access when this is unset. Verify the UUID against the owner of the four existing bank connections. Enable MFA/passkeys for Google, Supabase, hosting, GitHub and Plaid administrative accounts. This change does not enroll MFA automatically.
3. Stop the app's writers and scheduled jobs before migration. A live old worker will be rejected by the new encryption constraints. Take a restorable, encrypted database backup and verify that it can be restored without exposing its contents in logs.
4. Apply migrations 0029 and 0030 to the intended database. They preserve old rows for conversion but reject new plaintext financial writes. Migration 0029 revokes direct anon/authenticated-role access to financial tables; only the authenticated server handles them.
5. Run `node --env-file=.env.local scripts/encrypt-financial-data.mjs` for a read-only audit against that database. It prints counts only; exit code 2 means legacy rows remain. Then run the same command with `--apply`. The converter checks the current encryption key, encrypts in memory, uses optimistic comparisons, reads each write back and stops on an error. It is resumable. No plaintext backup is created by the script.
6. Run the audit again: zero legacy rows must remain. Execute `scripts/validate-financial-encryption.sql` to validate all encryption constraints against the entire database. Do not claim the conversion is complete before both checks pass.
7. Deploy this application version with the owner allowlist. Resume jobs only after checking sign-in, all four bank connections, balance/spending results, bill reads, sync, and exports. Verify actual HTTPS, no-store, CSP, HSTS and frame-denial headers in the deployed app. API rate-limit storage failures deny operations rather than bypassing limits.
8. Existing snapshots, backups, database WAL and logs can still contain old plaintext until the hosting provider's retention periods expire. Review backup access and retention. SQL nulling does not securely erase historical database pages or backups.

If cutover fails, keep writers stopped and retry the converter. Do not roll back only the code: old writers cannot satisfy the new constraints. Restore the matching pre-migration database/code pair only from your protected backup when a rollback is necessary.

## Other protections and limits

- Production requests require a verified Supabase user on the private allowlist. Bank routes and exports verify the user again. OAuth callbacks do not store provider credentials for an unapproved user.
- Atomic PostgreSQL counters limit bank reads, writes, link exchanges and exports across instances. They fail closed on database failure. They do not replace hosting-level DDoS protection.
- A fresh script nonce is generated per dynamic page. CSP blocks untrusted inline scripts, framing, plugins and base URL changes. Inline CSS remains allowed for the existing UI and Plaid. Plaid domains follow [Plaid's web SDK CSP guidance](https://plaid.com/docs/link/web/). HTTPS is enforced by the production host; HSTS is emitted by production builds. Local HTTP is for development only.
- Financial responses/pages are no-store. Long-lived Plaid tokens never go to browser responses. Request bodies are bounded before JSON/multipart parsing.
- Sentry error events are rebuilt from a small allowlist. Messages, requests, user identities, contexts, tags, extras and breadcrumb payloads are omitted. Tracing exports and OTLP registration are disabled. No session replay is configured. The restrictive connect-src also prevents browser telemetry to unlisted destinations.
- A server compromise can still expose decrypted data and encryption keys. Encryption here chiefly protects database-only compromise and accidental database disclosure. External KMS/HSM-backed envelope keys, credential rotation, tested disaster recovery and an independent review are additional deployment work, not provided by setting an environment variable.
- Financial questions can send relevant data to the configured model provider. Encryption at rest does not prevent this necessary processing. Review the provider's retention settings. Avoid displaying actual transactions in LinkedIn screenshots or demos.

## Verification

`npm test`, `npm run typecheck`, `npm run check:migrations`, `npm run check:secrets`, and `npm run build` are the repository checks. The PostgreSQL integration suite uses an isolated in-memory PGlite instance, synthetic credentials and synthetic financial records; it does not contact live banks or the production database. It exercises legacy conversion, plaintext-write rejection, role permissions, cross-user attempts, sync/import/correction/removal, stale previews and atomic rate limits.
