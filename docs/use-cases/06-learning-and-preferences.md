# 06 · Learning, preferences and location

People teach Daylark by correcting it or stating a preference. The model must recognise a *lasting* instruction ("always…", "from now on…", "X means Y") apart from a one-off request, and must confirm what it learned. Prefix `LP`.

Rules: only **explicit** corrections teach Daylark (R11); every lesson is confirmed in one sentence; the person can view and forget lessons (R15); "forget everything" needs a confirmation.

## A. Teaching

| ID | Someone might say | Lesson | Daylark should | Status |
| --- | --- | --- | --- | --- |
| LP-001 | always search 90 days / from now on look back 3 months / default to a year | default_window | Confirm, with the topic it applies to | ✅ |
| LP-002 | for receipts always show amounts / i always want totals | receipts_show_amounts | Confirm; say how to get a plain list ("just list them") | ✅ |
| LP-003 | when i say amzn i mean amazon / "bank" means chase | sender_alias | Confirm the mapping | ✅ |
| LP-004 | i meant adobe (after a wrong search) | sender_alias (correction) | Re-run with Adobe and confirm the lesson | ✅ |
| LP-005 | my meetings are 30 minutes by default / lunch is an hour | calendar_duration | Confirm; applies to events with no end time | ✅ |
| LP-006 | add 15 minutes for parking / i always run late | calendar_buffer | Confirm; applies to "can I make it" answers | ✅ |
| LP-007 | iherb is health / starbucks is coffee not restaurants | merchant_category | Confirm; applies to new records | ✅ |
| LP-008 | record "whole foods market" as whole foods | merchant_alias | Confirm | ✅ |
| LP-009 | the electric bill is autopay | autopay | Confirm; explain it counts as paid on the due date | ✅ |
| LP-010 | i live in oakland / my home is 94612 / set my home to x | home_location | Confirm; use as the default place for searches and drive times | ◐ (Settings field works; chat path needs the router) |
| LP-011 | i work at 500 howard st | work location | Not supported yet; offer to save it as a named place later | ✖ |
| LP-012 | i prefer mornings for meetings | soft preference | Not supported; explain what can be saved | ✖ |
| LP-013 | call me sam / my name is x | name | Not stored; Daylark reads the name from the account | ✖ |

## B. One-off versus lasting (the model must separate them)

| ID | Someone might say | Correct reading | Status |
| --- | --- | --- | --- |
| LP-020 | show the last 90 days | One-off. **Do not** teach | ✅ |
| LP-021 | always show the last 90 days | Lesson | ✅ |
| LP-022 | this time show amounts | One-off | ✅ |
| LP-023 | that was wrong, i meant adobe | Correction; teaches only if it is a name mapping | ✅ |
| LP-024 | yes always do that (answering an offer to remember) | Accepts the pending offer | ? |
| LP-025 | actually never mind, don't remember that | Cancels the pending lesson | ? |
| LP-026 | no, next time i want the last 7 days | Ambiguous: lasting? ask "Should I always use 7 days?" | ? |

## C. Seeing what was learned

| ID | Someone might say | Daylark should | Status |
| --- | --- | --- | --- |
| LP-030 | what have you learned about me / what do you know / what did i teach you / show my preferences | List by group (Email, Calendar, Finance, Location) | ✅ |
| LP-031 | do you remember my home / what's my default window | Answer the specific one | ? |
| LP-032 | what do you know about my spending habits | Not a stored lesson; explain the difference between lessons and records | ? |
| LP-033 | do you store my emails | Plain answer from the privacy policy: mail is read on request, not stored | ? |

## D. Forgetting

| ID | Someone might say | Daylark should | Status |
| --- | --- | --- | --- |
| LP-040 | forget adobee / stop treating x as y | Remove that alias; confirm | ✅ |
| LP-041 | forget the calendar buffer / drop the 15 minutes | Remove; confirm | ✅ |
| LP-042 | forget my home location | Remove; confirm | ✅ |
| LP-043 | forget everything / reset / start over / wipe what you learned | Ask for explicit confirmation, then delete all lessons; state that records and chats stay | ✅ |
| LP-044 | delete my data / delete my account | This is not a lesson; point to Settings → Your data | ✖ |
| LP-045 | forget it (with no antecedent) | Ask what to forget, offering the list | ? |

## E. Location specifically

| ID | Situation | Daylark should | Status |
| --- | --- | --- | --- |
| LP-050 | A search needs a place and none is saved | Ask once; after the answer, offer "Save Oakland as your home?" | ✖ (planned) |
| LP-051 | The message names a place | It wins over the saved home | ✅ |
| LP-052 | "near me" while travelling | Ask, or use device location after permission (later) | ✖ |
| LP-053 | The saved place is wrong or old | Settings field; or say "my home is now x" | ◐ |
| LP-054 | The place is ambiguous (Springfield) | Ask which | ? |
