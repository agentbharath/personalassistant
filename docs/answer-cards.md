# Daylark answer cards

`src/components/chat/cards/DaylarkCards.module.css` replaces `AnswerCard.module.css` and `ScoreCard.module.css`. It starts from the supplied final stylesheet. Suggestions, verdicts, scoreboards, sports roundups and news digests use it directly. Legacy single-game sports payloads render through the shared scoreboard.

The integration additions at the bottom of the stylesheet adapt the supplied design to existing app tokens and browser resets: scope the hero-name token to 20px (the app-wide token is 22px), lay out anchor chips like buttons, wrap long content without horizontal overflow, put team details below names on mobile, and suppress chip transforms under reduced motion. The assistant wrapper no longer applies a second arrival animation to cards.

Shared rendering lives in `CardParts.tsx`: tag meanings, source-domain links, up to four follow-up chips with at most one blue action, and a sport-independent competitor grid. Score payloads support variable score cells, ranks, on-strike markers, and an optional live-over strip. The strip is only rendered when actual ball data is supplied; the current ESPN summary adapter does not supply ball-by-ball data and no balls are fabricated. The development fixture demonstrates all ball states.

New suggestion/verdict extraction preserves each chip's complete executable text separately from its short label and classifies its purpose (narrow, deeper, act, widen). Stored string chips still render. Verdicts persist their prior subject so the chat can display “Replying to…” above the user's message; older verdicts can use the previous suggestion in the conversation.

Development previews:

- `/design/app?view=suggestion`
- `/design/app?view=verdict`
- `/design/app?view=sports-news` (mixed sports and multiple score columns)
- `/design/app?view=score` (finished and live cricket)
- `/design/app?view=digest`

Run `node scripts/check-answer-cards.mjs` with the development server running. It checks the real components at 1280, 390 and 320 pixels in light and dark themes, verifies computed padding/radii/fonts, checks overflow and accessibility, and captures cards plus follow-up chips in `ui-shots/answer-cards/`. It also checks reduced motion and that normal-motion cards have exactly one arrival animation. It uses local fixtures and does not invoke live model or sports APIs.

Validation: 36 browser captures passed with no browser errors or serious/critical accessibility violations. Full offline suite: 1,591 passed, 22 skipped. TypeScript and production build passed.
