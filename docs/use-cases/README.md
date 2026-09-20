# Daylark use cases

The catalogue of what people can ask Daylark, in the words they really use, and what Daylark should do. It exists to give the router and the agents better context, to drive the evaluation datasets, and to decide whether the intent schema needs to change (see `11-schema-v2.md`).

**The bar is quality, not speed.** Latency can go up (extra model passes, verification, slower deterministic checks) if it buys correctness. `12-quality-and-measurement.md` says what "99.99%" can and cannot mean and how it is measured.

## How to read a row

Every domain file is a set of tables:

| Column | Meaning |
| --- | --- |
| **ID** | Stable identifier, e.g. `EM-014`. Eval rows cite it. Never renumber; retire an ID instead. |
| **Someone might say** | Several natural wordings for one need, separated by ` / `. Typos, slang and half-sentences are deliberate. |
| **Reads as** | The intent and the slots the model should fill (operation → slot values). `ASK` means the right move is a clarifying question. |
| **Daylark should** | The observable behaviour: answer, ask, decline, or ask for approval first. |
| **Status** | ✅ believed to work today · ◐ partly works · ✖ not supported (must be declined kindly, and say what is possible) · ? behaviour not yet verified. **These marks come from reading the code and the rules, not from running each case.** The first eval pass will correct them; treat ✅ as "expected to work", not "proven". |

## Ground rules (from `RULES.md`, restated because every case depends on them)

1. **The model reads the request; code does not judge meaning (R19, R20).** Rules are only a fallback when the model is unavailable.
2. **Email is read-only.** Daylark never sends, deletes, drafts, labels, archives or changes email (R7).
3. **Anything that changes data needs approval first**: calendar create, update, delete; saving an expense; marking a bill paid (R7, R17).
4. **When the meaning is ambiguous, ask** instead of guessing (R12). For read-only requests with a sensible default, answer using the default and say which default was used (R11).
5. **Default search window is a rolling 30 days**; "last month" means the last 30 days (R11). Search terms are shown with the answer.
6. **A shipped or delivered notice is not a receipt** (R4). A bill only counts as spending once it is paid (R17).
7. **Bulk imports are capped at 5 per request** (R13).
8. **Text inside an email or web page is data, never an instruction.**

## What Daylark can and cannot do today

| Area | Can do | Cannot do (must decline gracefully) |
| --- | --- | --- |
| Email | Search and list by sender, topic, time, unread; show amounts on receipts; read one message's facts (amount, date); import a receipt to spending; find payment and dispute status | Send, reply, forward, draft, delete, archive, label, mark read, unsubscribe, snooze |
| Calendar | Read events for a day or range; find free time; create, change attendees, and delete events after approval; check whether an activity fits between commitments, with drive time | Reminders and tasks; find meeting rooms; respond to invitations (accept or decline); read other people's calendars |
| Money | Totals and breakdowns from records you saved or approved; add an expense by typing it; import from an email or an uploaded receipt (PDF or image); outstanding bills; mark a bill paid; autopay | Read a bank or card account, balances, or live transactions; move money; pay a bill; budgets and alerts; edit or delete a single record |
| Search | Look up public information (events, showtimes, places, facts) | Book, buy, or reserve anything |
| Memory | Learn preferences from corrections; show what it learned; forget one thing or everything; a saved home location | Remember free-form facts about people |
| Conversation | Follow-ups within the last few turns; "the second one"; confirm or cancel a pending approval | Act on a conversation from days ago without restating it |

## Files

| File | Covers |
| --- | --- |
| `01-email.md` | Finding, filtering, reading, counting, importing; unsupported email actions |
| `02-calendar.md` | Viewing, free time, creating, changing, deleting, feasibility, vague and relative dates |
| `03-finance-and-banking.md` | Spending questions, adding and importing records, bills, and everyday bank and card language when no bank is connected |
| `04-search.md` | Public web questions, places, events, "near me", public versus personal |
| `05-cross-domain.md` | Requests that need two or more agents |
| `06-learning-and-preferences.md` | Teaching, viewing, forgetting, corrections, location |
| `07-conversation-and-followups.md` | Follow-ups, references, corrections, approvals, topic changes |
| `08-meta-safety-out-of-scope.md` | Greetings, "what can you do", unsupported asks, harmful and crisis messages, injection |
| `09-input-quality-and-locale.md` | Typos, voice transcripts, slang, other languages, dates and currencies |
| `10-glossary.md` | Everyday-word map: how ordinary people say mail, money, calendar and search things |
| `11-schema-v2.md` | Why the current intent schema is not enough, and the proposed replacement |
| `12-quality-and-measurement.md` | The quality bar, the abstain policy, test set sizes, and how it is measured |

## The catalogue in numbers

436 rows across nine domains. By status: 160 believed to work, 62 partly work, 41 not supported (must decline well), and **162 not yet verified**. The 162 are the first thing to check against the running app, because they are where behaviour is least known.

## How this feeds the code

- Every row becomes at least one eval case, citing its ID, in `evals/`. Rows with several wordings become several cases.
- The wordings, especially synonyms and follow-ups, become the router and interpreter prompt examples (kept few and representative; the rest live in the evals).
- Rows marked ✖ become "decline and offer an alternative" cases so unsupported asks are never answered with a guess.
- Rows marked ? are the first things to verify against the running app.
