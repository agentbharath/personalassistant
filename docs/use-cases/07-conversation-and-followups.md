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
