# Deploying Daylark to Vercel (and adding it to an iPhone)

Written for the owner. Names of settings only: never paste a secret into this file, a commit or a chat. Secrets live in Vercel's Environment Variables screen and in `.env.local` on your machine.

## 1. Before the first deploy

- The code is on GitHub (`agentbharath/personalassistant`). Vercel deploys from there.
- The database is the **same Supabase project** you use locally, so the migrations are already applied (0001 to 0021). Do not run migrations from Vercel. If you later add a migration, apply it from your machine (`supabase db push`) **before** deploying code that needs it.
- Apply `0023_conversation_references.sql` before deploying durable conversation references. It adds encrypted result-list snapshots with user-scoped access and deletion cascading from the conversation. The migration is checked into the repository; do not assume it is already applied remotely.
- Decide whether drafting should be on in production (see step 4).

## 2. Create the Vercel project

1. Vercel, New Project, import the GitHub repo. Framework: Next.js (detected). Leave the build and output settings as they are.
2. Add the environment variables below **before** the first deploy. `NEXT_PUBLIC_*` values are baked in at build time, so if you add or change one later you must redeploy.
3. Set them for **Production** (and Preview if you want preview deployments to work).

### Needed

| Group | Names |
| --- | --- |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` |
| Model | `ANTHROPIC_API_KEY`, `MODEL_DAILY_TOKEN_BUDGET` |
| Security | `APP_ENCRYPTION_KEY`, `PII_HMAC_KEY`, `INTERNAL_TOKEN_SIGNING_KEY`, `CRON_SECRET` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY` |
| Search | `TAVILY_API_KEY` |
| Cache | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| Errors | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` |
| Behaviour | `DEFAULT_USER_TIMEZONE` (for example `America/Los_Angeles`) |
| Legal pages | `NEXT_PUBLIC_LEGAL_OPERATOR`, `NEXT_PUBLIC_LEGAL_EMAIL`, `NEXT_PUBLIC_LEGAL_JURISDICTION` |

Use the **same** `APP_ENCRYPTION_KEY` and `PII_HMAC_KEY` as local if you want production to read data you already saved. A different key makes existing encrypted data unreadable. Never change them once real data exists.

### Optional

`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (readable error traces from source maps), and the `OTEL_*` values if you use tracing.

### Leave out (only your machine uses them)

`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_DB_PASSWORD`, `GOOGLE_CLOUD_PROJECT_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`, `HF_TOKEN`, `OLLAMA_BASE_URL`, `TEMPORAL_ADDRESS`, `VERCEL_TOKEN`, `GRAFANA_*`, `ANTHROPIC_EVAL_API_KEY` (evals run locally).

## 3. Tell Supabase and Google about the new address

1. **Supabase, Authentication, URL Configuration:** set **Site URL** to your production address (for example `https://daylark.example.com`). Add `https://<your-address>/**` to **Redirect URLs**. Keep `http://localhost:3000/**` for local work. Sign-in goes Daylark, Supabase, Google, Supabase, Daylark, so Supabase must know the address.
2. **Google Cloud, OAuth client:** the authorised redirect URI stays Supabase's own callback (`https://<project>.supabase.co/auth/v1/callback`), which already works. Nothing to add for a new site address.
3. **Google Cloud, OAuth consent screen:** the app stays in **Testing** until Google verifies it, so only listed **test users** can sign in. Make sure your own Google account is listed.
4. **Google Maps key:** restrict it by **API** (Geocoding, Routes), **not by IP address**. Vercel's outgoing addresses change, so an IP restriction will break drive times and location lookup.

## 4. Drafting in production (optional)

- Google Cloud consent screen must list `https://www.googleapis.com/auth/gmail.compose`.
- Set **both** `DRAFTS_ENABLED=true` and `NEXT_PUBLIC_DRAFTS_ENABLED=true`, then redeploy.
- Sign out and in once on the production address and approve the drafts permission. A "Gmail drafts" row shows in Settings.
- If sign-in breaks after this, remove `NEXT_PUBLIC_DRAFTS_ENABLED`, redeploy, and everything returns to read-only.

## 5. Check it works

1. Open `https://<your-address>/api/health`. Expect `{"status":"ok",...}`.
2. Open the address, sign in with Google. You land in the chat.
3. Send "what's my day look like". Expect the day view.
4. Open Perch, Settings (Connections show Connected), and History.
5. Watch Sentry for new errors for a day.

## 6. Add it to an iPhone

1. Open the production address in **Safari** (not Chrome).
2. Share, Add to Home Screen, Add.
3. Open it from the home screen and **sign in again inside that app**: a home-screen app keeps its own login, separate from Safari.
4. If Google sign-in misbehaves inside the home-screen app, sign in once in Safari, then open the app again.

It opens full-screen, with the Daylark icon and name. There is **no offline mode and no push notifications** (no service worker yet), and it is not an App Store app.

## 7. Limits to know about

- **Request time:** the chat route has a 300-second ceiling. Ordinary queries stop at 20 seconds; spending imports, statement scans and batch confirmations can extend to 270 seconds, with progress heartbeats every 10 seconds. Enable Vercel Fluid Compute to support the configured duration; receipt reading and the data export have 60; Perch has 30. Vercel's plan decides whether these are honoured, so check the function limits for your plan.
- **Free plan:** Vercel's Hobby plan is for non-commercial use only.
- **Without Redis** (if the Upstash values are missing) caching falls back to memory inside each serverless instance, so repeated questions are re-answered and cost more.
- **Cost:** every model call is capped per request (`QUERY_MAX_COST_USD`). `MODEL_DAILY_TOKEN_BUDGET` adds a per-user daily cap on top of that; set it to `0` for no daily cap (spend is still logged, just never blocked), or a token count to enforce one. Set a monthly limit in the Anthropic console as well.
- **Monitoring** (scheduled SLO checks, alerts, an uptime monitor on `/api/health`) is not set up yet. Add a Sentry alert rule and an uptime monitor before others use it.

## 8. Rolling back

Vercel keeps every deployment. In the Deployments list, open the last good one and choose Promote to Production. Database migrations are not rolled back this way, so keep migrations additive.

## Optional finance sync and WhatsApp digest

See [Finance sync and WhatsApp setup](finance-sync-and-whatsapp.md) before enabling either feature. Apply migration **0024**, including its atomic transaction/source function, before deploying this version. The existing finance ledger is retained. Both features default off; no WhatsApp messages are sent until configured and enabled. On Vercel Hobby, the two daily digest schedules use Vercel Cron; frequent finance processing uses the separately enabled GitHub Actions workflow. The real-email evaluation set remains a private, manual labeling task; no live AI evaluations run automatically.

Migration **0025** enables structured, encrypted answer choices and an atomic message/context insert function. Reads remain compatible before it is applied; if the function is missing, new choices are saved as encrypted text with the answer. Applying the migration enables restored choice buttons. Previously unsaved buttons cannot be recovered.
