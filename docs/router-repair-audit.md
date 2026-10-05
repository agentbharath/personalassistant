# Router repair audit — 2026-09-30

Router v56 addresses the reported routing mismatches. The 31 cases added before this repair and the searchKind grader remain intact. No live verification is claimed here; the v55 verification ledger is unchanged.

## Expectation corrections

These changes follow the existing routing policy rather than accepting whichever answer the model returned:

- `learn-show-2`: `learning_show` → `memory_show`.
- `unsupported-1`: `general_answer` → `redirect`.
- `v7-redirect-6`: `redirect` → `web_search`.
- `v7-redirect-7`: `redirect` → `general_answer`.
- `v7-redirect-11`: `general_answer` → `redirect`.
- `v7-redirect-13`: `general_answer` → `redirect`.
- `v7-redirect-14`: `general_answer` → `redirect`.
- `v7-stay-6`: `web_search` → `clarify`.
- `v7-stay-7`: `web_search` → `general_answer`.
- `web-weather-no-home`: `web_search` → `clarify`.
- `web-not-local`: `web_search` → `general_answer`.
- `context-fix-resume`: `general_answer` → `redirect`.
- `context-fix-code`: `general_answer` → `redirect`.
- `trip-place-carries-1`: `web_search` → `plan`.
- `multi-general-query-1`: `multi` → `plan`.
- `multi-general-query-2`: `multi` → `clarify`.

Deliverable generation follows R39. Open-ended memory uses memory_show; operational settings use learning_show. Financial guidance follows the current router policy: stable principles are general_answer, current market advice requires web_search. Stable facts can be answered directly. Weather needs a known location. Trip planning uses plan. The mixed calendar/email case needs AM/PM for “at 3”.

The laptop/accessory case has a unique ID, `compound-search-dependent-accessory`, and keeps its original single-search expectation: the accessory depends on the selected laptop. The iPad/Kindle decision keeps its original single-comparison web search expectation.

## Routing repairs

- Search-window follow-ups retain the active email search; only lasting defaults become lessons.
- Calendar buffers use structured lessons; calendar attendees go to the handler that resolves the current event.
- Payment-date interpretation receives seven calendar-accurate date/weekday anchors.
- Undo specifies the previous draft version; bulk deletion requests clarification.
- Existing redirect boundaries take priority over general-answer guidance; homework explanations remain supported.
- Recommendations use search, while booking remains an unavailable action.
- Missing bank names and locations still need clarification when accepting an offer.
- Dependent accessories stay with their primary item; independent searches remain split.

## Request failures

The 21 HTTP 400s were consecutive dataset rows 282–302. The prior logs retained status/type but omitted the provider reason, so malformed inputs are **not established as their cause**. Offline fixture validation passes for all 333 rows. The eval now retains the provider reason and request ID with the case ID, stops after a batch containing a provider rejection, and supports exact ID selection. The API cause remains pending a live diagnostic.

## Other audit repairs

- Suggestions require an explicit relevance judgment and a valid evidence citation for each displayed option; rejected options never enter recall.
- US and soccer date tiles use the configured user time zone, including UTC month-boundary crossings.
- Card text truncates on word boundaries with an ellipsis.
- Unknown or malformed card fences use their readable prose fallback; internal JSON is hidden.
- Recent and targeted answer recall share RECALL_ANSWER_CHARS (1000).
- A low-confidence operation that asks a question no longer passes as an executed operation.

## Validation

- Full offline suite: 1,585 passed; 22 live/optional tests skipped.
- TypeScript: passed.
- Targeted live plan: 48 cases, estimate $2.31 (not a ceiling). A $3 run is awaiting owner approval under R21.4/R21.6. No full-set run is planned.

Exact case selection (`LIVE_EVAL_CASE_IDS`):

```text
email-followup-0,learn-show-2,cal-attendees-1,unsupported-1,paid-last-friday,lesson-buffer,v7-draft-11,v7-draft-14,v7-redirect-2,v7-redirect-5,v7-redirect-6,v7-redirect-7,v7-redirect-9,v7-redirect-11,v7-redirect-12,v7-redirect-13,v7-redirect-14,v7-redirect-21,v7-redirect-22,v7-stay-5,v7-stay-6,v7-stay-7,v7-na-10,v7-ask-7,v7-follow-3,web-weather-no-home,web-not-local,context-fix-real-risk,context-fix-resume,context-fix-code,trip-place-carries-1,trip-place-carries-2,list-saved-searches-1,list-saved-searches-2,list-saved-searches-neg-1,memory-remember-1,memory-remember-2,memory-show-1,memory-forget-1,memory-neg-learning-1,memory-neg-casual-1,compound-search-split-1,compound-search-split-2,compound-search-no-split-decision,compound-search-dependent-accessory,compound-search-split-3,multi-general-query-1,multi-general-query-2
```
