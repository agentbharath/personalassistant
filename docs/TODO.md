# Daylark to-do

The UI is frozen from 2026-09-20. Everything below is functionality, unless marked (UI) and required by a feature.

## Intent quality programme (starts next)
Read `docs/use-cases/README.md` first. It holds 436 use cases, the schema proposal (`11-schema-v2.md`) and the quality bar (`12-quality-and-measurement.md`).
- [ ] Owner review of the use-case tables. Remaining open decisions are D-1 (drafting, explained in `12` §9), D-5 to D-10.
- [x] **Rule chain removed from the orchestrator (R20.5a, 2026-09-20):** no rule fallback; when no model is available Daylark says so and does nothing; Confirm and Cancel use an explicit `uiAction`; unused `bills-turn`, `status-turn`, `graph` deleted; 917 tests pass.
- [ ] **Still rule-based (R20.5), to convert with the model and remove:** the now-unused classifiers in `orchestrator/intent.ts`, `scope.ts`, `safety.ts` and `classifyWithClaude`; `learning/commands.ts` parsers still used by handlers; `summarizeConversationTitle`. Each conversion needs eval cases first, then a small live re-run within R21.6 and R21.7.
- [ ] Implement R22: ask when in doubt, with per-slot thresholds; keep the owner-defined 30-day default only for an unstated window.
- [ ] Implement R23: a `redirect` operation whose `pivot` is validated against the real capabilities, plus the RD evals (`docs/use-cases/13-scope-and-redirection.md`).
- [ ] Implement R24: never surface one-time codes or reset and sign-in links from email (extraction, summaries and quoting), with tests.
- [x] Clickable answer choices for clarifying questions (D-7 decided yes). **Built:** an optional `choices` list on the answer, shown as tap-to-answer buttons under a live question; the first source is the "Which one? Say a number" question (1 to 8 results). **Still to do:** the router returns choices with its clarifying question (needs a router version bump and a live eval, so credits and approval).
- [x] **Email drafts, foundation built (2026-09-20), switched off.** Migration 0017 (`email_drafts`, and the `email_drafts` connection type); `tools/email/gmail-drafts.ts` (an allow-list of exactly create, read, update and delete of a draft, checked before every request); `drafts/service.ts` (create, edit, restore a version, discard, list versions; never overwrites the person's own edits; handles a draft that is gone or sent; only drafts Daylark created); RFC 2822 building with header-injection checks; sign-in requests `gmail.compose` only when `NEXT_PUBLIC_DRAFTS_ENABLED=true`; drafts are included in account export and deletion. 21 tests, plus a test that scans all source for any Gmail send or write call or send-capable permission.
- [ ] **Email drafts, still to do (R25):** the `email.draft`, `email.edit_draft`, `email.discard_draft`, `email.revert_draft` operations in the router (a version bump and a live eval, so credits and approval); preview then approval in the chat (a draft card with Save, Cancel and choices); recipients and reply threading from the email being answered (needs a way to read a message's Message-Id and thread); reconnect prompt and a Settings row for the drafts permission; rewrite the Privacy Policy, Terms, sign-in page and Settings wording **in the same release** as turning the switches on (`DRAFTS_ENABLED`, `NEXT_PUBLIC_DRAFTS_ENABLED`); ask existing users to reconnect. Original plan follows for reference:
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
- [ ] **Set up a separate, spend-capped Anthropic API key for evals (now recommended firmly, R21.9).** Create it in the Anthropic console with a monthly limit (for example $5), put it in `.env.local` as `ANTHROPIC_EVAL_API_KEY`, and I will point the live evals at it. The app and the evals share one key today, so the console cannot separate their spend. The offer to add an assistant-side cost prompt before any live run is now built into the runner (R21.6, R21.7).
- [x] Router v7 written (free): drafts, redirect, choices, ask-when-in-doubt (threshold 0.8); 84 new router cases (190 total) covering drafts, redirects, not-available asks, email codes, asks with choices and calibration cases that must not become questions; the grader is tested. 901 tests pass.
- [x] **Router v7 verified live: 193 of 193 (2026-09-20).** One full pass (176 of 190), then only failures and changed cases were re-run (about $1.4 at most in total; your Anthropic console has the exact figure). The router is now given the saved home location.
- [ ] **Recommended before release, needs your approval, stated limit and a small case count (about 45 cases, at most 45 per run):** a sample re-run of the highest-risk groups (approvals and denials, forgetting, clarifying questions, the "clear requests must not become questions" group, drafts) because the prompt changed after the first 176 passes. About 45 cases, roughly $0.30. Not a full-set run.
- [ ] The router's redirect replies and pivots are read by dispatch, but a pivot's follow-up (the search, the calendar look) only happens when the person says yes; that loop is verified for one example. Add more follow-up cases as redirects grow.
- [ ] Remove the rule-based fallback and the remaining rule-based interpretation (R20.5): the email interpreter overrides (calendar dates are done, see R20.5b).
- [ ] (Superseded: verify router v6. v7 replaces it.)
- [x] **Email interpreter email-v8 verified live: 127 of 128 (2026-09-20)**, final full run, measured $0.37. **No more full evals** (owner decision).
- [x] (Done, 128 of 128: the case had one result but said "those"; the test was fixed and re-run for $0.0031.) One interpreter miss to fix later, in a single-case re-run you approve first (about half a cent): `follow-up: state-please-import-those`, "please import those" with several listed results read as `import`, expected `import_all`. Low severity: the approval card shows what would be imported before anything is saved.
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

## Daily view (R26)
- [x] `/today`: meetings, bills (overdue, today, 7 days), weekly spending habit; mock preview at `/design/today` in `npm run ui:check`.
- [ ] Reminders: needs a store (`reminders` table, create/edit/cancel with approval, shown on Today), a router operation and eval cases. Today says plainly that it has none.
- [ ] Chat entry: "what's my day" / "any bills this week" answered from the same data (needs a `daily_view` router operation, so a new router version and a re-run of the router set).
- [ ] Optional weekly email or push digest of the spending habit (needs a scheduler and consent wording).
- [ ] Email interpreter v9 live re-verification (148 cases, needs an owner-stated dollar limit and `LIVE_EVAL_MAX_CASES=148`).
