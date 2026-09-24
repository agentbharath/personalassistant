# 07 · Conversation, follow-ups and context

Most real conversations are not one clean question. People say "the second one", "same but for last month", "and Google?", "no, the other one". Context resolution is the main reason an assistant feels smart or stupid, so it gets the strictest treatment here. Prefix `CV`.

## Principles

1. **Resolve against state, not against the last sentence.** Daylark keeps the last request (domain, operation, filters, time window), the last results (with positions), and any pending approval. A follow-up is interpreted against that state.
2. **Say the reading when it matters.** "Showing the last 30 days for receipts from iHerb." A wrong resolution is then visible and fixable.
3. **When the reference is genuinely ambiguous, ask** with the candidates listed. When it is unambiguous, do not ask.
4. **State expires.** Results older than the conversation's recent turns are not resolved silently; ask.
5. **An approval card is a special state.** While one is pending, short answers ("yes", "make it 4", "cancel") refer to it first.

## A. Follow-up types

| Type | Meaning | Examples | State needed |
| --- | --- | --- | --- |
| Ordinal | Pick one of a list | "the second one", "#3", "the last one", "the first two", "number 2 and 4" | Numbered last results |
| Anaphora | A pronoun for a thing | "that", "it", "them", "those", "this bill", "that email" | Last mentioned entity |
| Ellipsis | Reuse the last request, change one thing | "and yesterday?", "what about google?", "same for last month", "only unread", "and the amounts?" | Last request |
| Correction | The last reading was wrong | "no, aws not amazon", "i meant adobe", "not that one", "the other one", "wrong sender" | Last request and sender |
| Refinement | Narrow | "only the ones over $50", "just from this week", "without amazon" | Last results and request |
| Widening | Broaden | "older ones", "all of them", "go back further", "show more" | Last request |
| Pagination | More of the same | "next", "show 5 more", "the rest" | Position in the list |
| Drill-down | More on one item | "what does it say", "open the second", "who sent it", "how much was that" | Last results |
| Explanation | About the answer | "why?", "how did you get that", "what did you search", "where does that number come from" | Last answer's search terms |
| Action on result | Do something with a result | "add it to my calendar", "import that", "mark it paid" | Last results, then approval |
| Repetition | Ask again | "again", "try again", "one more time", "same question" | Last request |
| Meta | About the conversation | "never mind", "start over", "forget that", "you misunderstood" | Conversation |

## B. Cases

| ID | Conversation | Correct resolution | Status |
| --- | --- | --- | --- |
| CV-001 | "show my iherb receipts" → "the second one" → "import it" | Ordinal picks result 2; "it" is that result; import needs approval | ✅ |
| CV-002 | "emails from amazon today" → "and yesterday?" | Same sender, window=yesterday | ✅ |
| CV-003 | "emails from amazon" → "what about google?" | Same request, sender=Google | ✅ |
| CV-004 | "receipts" → "with amounts" | Same request, action=amounts | ✅ |
| CV-005 | "receipts from amazon" → "only over $100" | Filter on amount after reading amounts | ◐ |
| CV-006 | "emails from amazon" → "no, aws" | Correction: sender=AWS; may teach an alias only if it is a name mapping | ✅ |
| CV-007 | "what's on friday" → "and saturday?" | Same operation, day changed | ? |
| CV-008 | "what's on friday" → "am i free at 3?" | Same day carried into the new question | ? |
| CV-009 | "what's on friday" → "add lunch at noon" | Date carried into a create | ? |
| CV-010 | "how much on food?" → "and last month?" | Same category, window changed | ◐ |
| CV-011 | "how much on food?" → "what about groceries?" | Category swapped | ? |
| CV-012 | "show my bills" → "i paid the first one" | Ordinal into a write; approval | ◐ |
| CV-013 | a list of 10 → "show more" | Next page | ◐ |
| CV-014 | any answer → "why did you say that" | Show the search terms and records used | ? |
| CV-015 | any answer → "that's wrong" | Ask what was wrong; offer to redo with the last window widened or the sender changed; the Bad-answer button is the signal | ? |
| CV-016 | "emails from sam" → "the other sam" | Correction to a different Sam; list candidates if unknown | ? |
| CV-017 | "movie times" → "the 7pm one" | Reference to a result item | ? |
| CV-018 | "movie times" → "put it on my calendar" | Create from a search result; ask approval | ◐ |
| CV-019 | user answers a clarification: "the first one" / "amazon" / "yes" | Fills the missing slot of the *asked* question | ✅ |
| CV-020 | topic switch: (email talk) → "what's on tomorrow" | New request; do not carry email filters | ? |
| CV-021 | A follow-up after a long gap or a new chat | Do not assume the old context; ask or restate | ? |
| CV-022 | Two references at once: "the second one from the first list" | If lists are not both live, ask | ? |
| CV-023 | "same but for aws" | Ellipsis with substitution | ? |
| CV-024 | "the same thing as before" | Ambiguous "before"; use the last request and say so | ? |
| CV-025 | "and?" / "so?" / "ok?" | Ask what they want; if a pending approval exists, treat it as unresolved | ? |

## C. Approval flow

| ID | Pending card | User says | Daylark should | Status |
| --- | --- | --- | --- | --- |
| CV-030 | create event | yes / yep / go ahead / do it / confirm / sure / ok / sounds good / 👍 | Approve | ✅ |
| CV-031 | create event | no / cancel / nah / never mind / don't / stop / scratch that | Cancel; say nothing was changed | ✅ |
| CV-032 | create event | wait / hold on / not yet | Keep pending; ask what to change | ? |
| CV-033 | create event | make it 4pm / change the title / add sam | Edit the card, do not approve | ✅ |
| CV-034 | create event | yes but at 5 | Apply the change, then ask again ("Confirm the new time?") | ? |
| CV-035 | create event | (asks an unrelated question) | Answer it; keep the card pending; remind once | ? |
| CV-036 | create event | (silence, then 2 hours later) "yes" | Expired card: say it expired and re-show it | ? |
| CV-037 | two pending cards | yes | Ask which, or approve the most recent if unambiguous and say so | ? |
| CV-038 | none pending | yes | Ask "yes to what?" | ✅ |
| CV-039 | delete card | "delete them all" | Re-show the full list for explicit approval | ? |

## D. Repair

| ID | Situation | Daylark should |
| --- | --- | --- |
| CV-040 | Daylark misread the request | The person says "no, I meant…"; apply the correction and never argue |
| CV-041 | Daylark asked a question and the user ignores it | Answer the new message; drop the old question |
| CV-042 | The user repeats the same message three times | Assume the answer was unsatisfying; change approach (ask, widen, or explain limits) |
| CV-043 | The user is frustrated ("this is useless", "wtf") | Brief acknowledgement, then a concrete next step; no defensiveness |
| CV-044 | The user says "you keep getting this wrong" | Offer the feedback note and the exact reading that was used |

### Conversation corrections (September 2026)

- Listing "Daylark's saved drafts" reads the user's saved draft records across conversations. It shows recipients and subjects, without claiming those drafts are still present or unsent in Gmail. Unconfirmed previews are not saved drafts.
- The router sees up to twelve recent turns, preserving both the beginning and end of long messages, plus the latest assistant turn separately. An answered clarification receives at most one model context review before another question is shown.
- Accepting an offered web search carries its subject forward. Declining an offer ("nah leave it") ends the topic rather than looking for an approval.
- General answers support translations, including Telugu, resume preparation, safe code, and ordinary supportive conversation. Practical requests receive practical answers; distress is not automatically met with a therapist disclaimer or an unrelated capability list.
- Quoted text supplied for translation is distinguished from a personal risk disclosure. Safe translation is fulfilled; independently indicated personal risk can receive a brief contextual check-in. Genuine immediate-risk disclosures retain the safety path.
- Blank generated text produces an explicit failure message. Service-unavailable notices do not include unrelated crisis resources. Retries are recorded as user turns so regenerated answers do not appear as unexplained consecutive assistant replies.

Verification: targeted live router cases are in `evals/router.jsonl` under `context-fix-`; live response checks are in `src/lib/evals/conversation-live.test.ts`. These are opt-in and bounded by the existing live-evaluation spend controls.


Saved place-search recall is available across the user's conversations for 30 days (up to 10 recent saved lists from 30 conversations). The router and answerer receive dated historical records and earlier conversation summaries. Recalling yesterday's suggestions does not run a fresh search or claim that old opening hours are current. Same-conversation recall has no age expiry. Email and place lists are also archived as encrypted snapshots so later searches do not overwrite their identities or order. Existing latest lists are archived before replacement; lists overwritten before this feature cannot recover source IDs unless those IDs were already saved.

Email requests preserve specific content search terms independently of sender and broad category. Home-maintenance queries can use maintenance/work-order/repair-request alternatives without inventing a sender. The full intended subject is preserved separately from expanded search keywords. Semantic relevance checks use that intent: apartment work orders match home-maintenance updates, while banking-system maintenance does not. Empty results never broaden into unrelated inbox mail. Search scope remains visible; the generic correction/default-window tutorial is no longer appended to every result.

Email follow-ups now send the actual recent conversation, preceding assistant turn, and summary to the interpreter; these also participate in its cache key. Identical “yes” replies to different offers cannot share an interpretation. A bounded model review checks proposed clarification against the previous exchange. Agreement to one offered search executes that search; agreement to an either/or question still requires the missing choice. Specialist choice buttons are preserved by dispatch.

The search executor compiles the model's structured sender, topic, date, inclusion and exclusion fields directly. It does not reparse a rendered sentence. Semantic result selection uses a cached model review of retrieved evidence with strict candidate-ID validation; an unavailable review does not fall back to arbitrary inbox results. Search checks 50 candidates initially, supports five-result pages via structured offsets (up to 200 candidates), and keeps displayed-page ordinals in conversation state. Import validation, evidence grounding, deduplication and confirmation remain enforced in code.


Conversation retention applies across topics, including calendar discussions, drafts, code, decisions, personal details and unfinished tasks. Original encrypted messages remain stored until the chat is deleted. When recent turns and the compact summary are insufficient, the router supplies a retrieval query, the server searches that conversation’s stored originals and saved result sets, and routing runs again with relevant excerpts and adjacent turns. Resolved follow-ups carry supported details into specialist execution. This is bounded, keyword-ranked retrieval, not loading an unlimited transcript into every model call or a guarantee of perfect recall; partial/unavailable reads are identified explicitly. Old factual claims remain historical, and saved context never renews expired approvals. Persistent account preferences remain separate from chat history.

Offline regressions cover old messages beyond the first retrieval page, cross-topic recall, ownership isolation, failed reads, months-old references, archived list selection after newer searches, and the home-maintenance intent passed into relevance review. These mocked tests verify the implementation contract; live model behavior requires separate opt-in evaluation.

### Saved question choices and loop protection

Migration 0025 retains encrypted assistant answer choices with the message, restores them on reopening, and exports them with chat history. Router, email, calendar and conversational responses receive the latest question/answer exchange. Selecting an exact saved option is recorded as a selection; a bare yes to multiple alternatives is not. A pending approval must not override a newer unrelated question.

The router and email interpreter get one bounded context repair before returning an unnecessary clarification. If the repaired question still repeats an exactly answered option, or repeats the same unresolved question for a third time, the request stops without dispatching an action or caching that failed interpretation. This is a defensive check for matching/closely reworded questions, not a guarantee of semantic correctness for every model response. Existing approval validation and expiry still apply. Verification uses mocked models only.
