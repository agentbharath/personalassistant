# Daylark to-do

The UI is frozen from 2026-09-20. Everything below is functionality, unless marked (UI) and required by a feature.

## Intent quality programme (starts next)
Read `docs/use-cases/README.md` first. It holds 436 use cases, the schema proposal (`11-schema-v2.md`) and the quality bar (`12-quality-and-measurement.md`).
- [ ] Owner review of the use-case tables. Remaining open decisions are D-1 (drafting, explained in `12` §9), D-5 to D-10.
- [ ] **Remove every rule-based path that classifies or interprets a message (R20.5).** Today's code still has them: the rule fallback chain in `orchestrator/run.ts` (runs when the router fails), the email interpreter's message-based overrides (R20.4), ordinal and correction detection by pattern in `email-turn`, `getCalendarWindow`, `extractLocation` and `preciseStart` in the calendar and feasibility code, `parseLearningsCommand`, `parseBillsCommand`, `detectCorrection`, and `summarizeConversationTitle`. Replace each with a model-filled field validated for form. When no model is available, reply that requests can't be interpreted right now.
- [ ] Implement R22: ask when in doubt, with per-slot thresholds; keep the owner-defined 30-day default only for an unstated window.
- [ ] Implement R23: a `redirect` operation whose `pivot` is validated against the real capabilities, plus the RD evals (`docs/use-cases/13-scope-and-redirection.md`).
- [ ] Implement R24: never surface one-time codes or reset and sign-in links from email (extraction, summaries and quoting), with tests.
- [x] Clickable answer choices for clarifying questions (D-7 decided yes). **Built:** an optional `choices` list on the answer, shown as tap-to-answer buttons under a live question; the first source is the "Which one? Say a number" question (1 to 8 results). **Still to do:** the router returns choices with its clarifying question (needs a router version bump and a live eval, so credits and approval).
- [ ] **Email drafts (R25), decided, not built.** The permission trade-off (Google's `gmail.compose` also allows sending; only our code prevents it) is accepted (R25.6a). Steps: add the scope to sign-in and the connection check; an allow-list so only "create draft" and "edit a Daylark draft" can be called; the `email.draft` operation (router version bump and live eval); preview then approval; threading and recipients; rewrite the Privacy Policy, Terms, sign-in page and Settings text in the same release; ask existing users to reconnect; tests that a send is impossible.
- [ ] Later, from feedback: consider offering Send, as its own decision (confirmation, delay, undo).
- [ ] Draft reverting (R25.8): `email_drafts` table with saved versions; discard and restore-a-version, each after approval; compare the live Gmail draft with the last saved version before changing it, so the person's own edits are never overwritten; handle a draft that is gone or already sent; delete saved versions on discard and with the conversation. Cases: `docs/use-cases/01-email.md` §J.
- [ ] `compose.suggest_message`: chat-only wording for non-email messages.
- [ ] Turn the rows into eval cases in `evals/`, one or more per ID, starting with the 162 unverified rows.
- [ ] Freeze `frame-v1` after review; write the adapter to today's router output.
- [ ] Calendar first: replace rule-based date and place parsing with model-resolved, code-validated `TimeSpec`.
- [ ] Shadow-run frame-v1 against router-v6 (needs credits and an approved cost quote).
- [ ] Conversation state for calendar, finance, bills and search (today only email has it).

## Needs you
- [ ] Restart the dev server so it picks up `MODEL_DAILY_TOKEN_BUDGET=500000` and the legal-page environment values.
- [ ] Add Anthropic credits. Until then every model call fails and the app falls back to rules.
- [ ] Real-data pass in your own signed-in session (I could only test with mock data): streaming progress and Stop, pin (limit 5) and rename, the "Bad answer" note box, long chats, a failed send, delete then Undo, the new sign-in redirect (`/history` while signed out, then sign in).
- [ ] Try "Delete my account" on a throwaway test account before trusting it. It was only tested against a fake database.
- [ ] Have the privacy policy and terms read by a lawyer, and replace the placeholder operator name (currently "Daylark") with a real person or company. Confirm what text reaches Anthropic for email features, and update the policy wording if needed.
- [ ] Google OAuth verification for the restricted Gmail scope (needed before anyone else can use it).

## Model and quality (approval and cost quote first, R21)
- [ ] Set up a separate, spend-capped Anthropic API key for evals, plus an assistant-side cost prompt before any live run (offered earlier, not decided).
- [ ] Verify router prompt v6 with a live eval run.
- [ ] Convert the email interpreter and email turn to model-filled fields (R20.4), running live evals incrementally.
- [ ] Turn bad-answer ratings into eval cases: `npm run feedback:export`, then write the expected behaviour for each row.

## Location
- [ ] **Enable the Geocoding API** on Google Cloud project `YOUR_PROJECT_ID` (link: https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com?project=YOUR_PROJECT_ID). If the Maps key is restricted to specific APIs, add Geocoding to its allowed list too. Until then the "Use my current location" button shows a friendly "lookup isn't available" message (the API currently answers REQUEST_DENIED).
Done: the saved home location (Settings, encrypted like other preferences, migration 0016 applied), used to point movie and local searches at the area around home and to add the drive from home to a named place. Privacy policy updated.
- [ ] Set your home location in Settings and try "can I catch a movie Saturday at 2pm" with and without a place in the message.
- [ ] Say it in chat ("my home is Oakland", "forget my home location"). Interpreting that belongs to the model router (R20), so it needs credits and a router example, then a live eval with approval. Forgetting by chat already matches the learning.
- [ ] The public-search flow still asks "What city or ZIP code should I search around?" when it lacks a place. It should use the saved home location instead of asking. It lives in the rules fallback path; move it when the router takes over that flow.
- [ ] Travel origin could also be the previous calendar event's location, not always home.
- [ ] Later: use device location for "near me" questions, asking permission at that moment. Needs the model router to recognise "near me" (R20).

## Product gaps
- [ ] Schedule timeline card and a receipts card with a total. Needs the calendar and finance agents to return structured data as well as text.
- [ ] Turn the PG&E $146.30 expense into an outstanding bill (needs approval).
- [ ] iHerb August 15 record date fix or an edit path.
- [ ] Read due dates from PDF bill attachments.
- [ ] Do something with Good/Bad ratings beyond storing them (a review view, or feed the eval export).
- [ ] Make the pin-limit check atomic in the database (two devices could briefly exceed 5).
- [ ] Search inside message text (messages are encrypted, so this needs a design).

## UI, deferred
- [ ] Shared sidebar layout, so the sidebar never redraws between pages. Touches routing.
- [ ] A real logo file (the app shows the "Daylark" wordmark for now). Replace it in `Logo.tsx` and the icons in `public/` and `src/app/icon.svg`.
- [ ] First-run onboarding for a new user.
- [ ] Undo window and toast timing review once real usage shows what feels right.
- [ ] Unify chat-list "fit" measurement and loading frame if the shared layout lands.

## Done recently (for reference)
Sign-in gate moved to `src/proxy.ts` (it was not running), sign-in returns to the page you asked for, download and delete controls in Settings, live Google connection check, error and 404 pages, PNG app icons, `npm run ui:check`.
