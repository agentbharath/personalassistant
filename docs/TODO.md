# Daylark to-do

The UI is frozen from 2026-09-20. Everything below is functionality, unless marked (UI) and required by a feature.

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
