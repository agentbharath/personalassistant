# Daylark behavior rules

Every behavior change starts here. A bug is a missing or wrong rule: fix the rule, add rows to the eval datasets in `evals/`, then change code. Rule IDs are cited by the eval rows, so `npm run eval` shows which rule broke.

Decided by the owner (second round of rules: R5.7, R6.4, R11, R12; third round: R13, R14, R15; fourth round: R5.8, R11.7, R13.7; fifth round: R16; sixth round: R11.8; seventh round: R17; eighth round: R18; ninth round: R19, R20; tenth round: R21):
- "last month" means a rolling 30 days.
- Shipped and delivered mail is **not** a receipt.
- Ambiguous or unknown input gets a clarifying question.
- Bulk import is capped at 5 orders per request.

## R1. Pipeline order (first match wins)
1. **R1.1 Safety and crisis**: deterministic, always first.
2. **R1.2 Scope**: out-of-scope topics are declined. Money stress, boredom and similar are redirected to a Daylark capability.
3. **R1.3 Pending approvals**: only exact confirm/cancel replies resolve a pending approval.
4. **R1.4 Normalize**: repair domain typos (R2) before any routing below this line.
5. **R1.5 Writes**: calendar and finance writes go through an approval. Email writes are declined (R7.3).
6. **R1.6 Reads**: email, calendar, finance and web search. A multi-part request runs each part in parallel, and each agent receives only its own clause.
7. **R1.7 Model fallback**: only when nothing above matched.
8. **R1.8** Any message that parses as an email request (a receipt, promotion or recruiter topic, an unread or real-people filter, or a sender with an email noun) is routed to email by rule, never by a model. Spending words send it to finance instead.

## R2. Language
- **R2.1** Typos are repaired only for a fixed vocabulary of lowercase domain words (invoice, receipt, statement, email, total, amount, promotion, recruiter, billing). Brand names are never rewritten.
- **R2.2** Singular and plural are equivalent everywhere (receipt/receipts). Casing and punctuation never change meaning.
- **R2.3** A phrase after skip, exclude, except, without, ignore, not or no is an exclusion, never the topic.

## R3. Entities
- **R3.1 Sender or merchant** is one of: `from X`, an email address, or a brand beside a document noun ("iherb receipts", "my Amazon order").
- **R3.2** A sender is never a pronoun, determiner, adjective or time phrase ("my", "the", "duplicate", "recent", "last 30 days").
- **R3.3 Topic precedence**: recruiter, then receipt, then promotion, then general. A receipt noun beats "promotion" in the same sentence.
- **R3.4 Time**: today, yesterday and this week are calendar windows. "last/past N days/weeks/months/years" is a rolling window (a month is 30 days, a year is 365, capped at 365). "unread" adds an unread filter.
- **R3.5** Requested sender names are matched fuzzily (one or two edits) against real senders. They are never matched as a substring of an unrelated address.
- **R3.6** Exclusion terms never include words from the requested sender's own name.

## R4. What counts as a receipt (single definition for search and import)
- **R4.1** A receipt needs a signal (receipt, invoice, order confirmation, "Ordered:", statement, payment confirmation) and hard evidence (a dollar amount, an order/invoice number, or a billing-style sender).
- **R4.2** Bulk-mail senders (`mail@`, `promos@`, `news@`, `noreply@` alone) and bulk-mail subdomains (`email.`, `mail.`, `info.`) are marketing unless the message carries an order/invoice number, an amount, or an "Ordered:" subject.
- **R4.3** Marketing wording (reward, credit to use, next order, % off, coupon, sale, financing, APR, pre-approved, limited time) disqualifies a message unless it has both an amount and a billing sender.
- **R4.4** Shipped, delivered, out-for-delivery and tracking mail is **not** a receipt. It is never returned for a receipt query and never imported.
- **R4.5** Confirmation, shipping and delivery mail for one order share an order number. A receipt list shows one row per order, preferring the confirmation.
- **R4.6** A receipt search asks Gmail for confirmation-style subjects (confirmed, confirmation, receipt, invoice, ordered, order, statement, bill, payment) and looks at up to 50 candidates, not Gmail's default 20 newest. Promo and shipping mail from the same store must not be able to push real receipts out of the window.

## R5. Context
- **R5.1** A fragment ("from. last month", "only unread", "what about last week?") re-runs the previous email query and changes only the part it names, keeping sender, topic and exclusions.
- **R5.2** Refinements chain back to the original query.
- **R5.3** "how about X" swaps the sender and keeps the earlier topic. X may be typo-corrected against senders already seen in the conversation.
- **R5.4** A standalone query, or a fragment in a non-email conversation, is never rewritten.
- **R5.5** A refinement keeps the previous *action*: a list stays a list, a facts question stays a facts question, and an import stays an import (it produces a new approval, never a search result).
- **R5.6** Follow-ups edit a structured request (action, topic, sender, window, unread, exclusion), never rewrite text. A fragment is recognised by a follow-up marker ("how about", "only", "from", "and"), a period or "unread" word, or "import them"; a message starting with a verb (find, show, did, import + noun) is standalone. Rendering a request and parsing it back must give the same request.
- **R5.7 Context is state, not scrollback.** After every email turn Daylark saves the structured request (and the top results) for the conversation. A follow-up edits that saved request. When it is missing or older than 30 minutes, Daylark falls back to the last email request in the messages. With saved state, a bare name of two or three words ("netflix?") counts as a sender swap.
- **R5.8 Corrections re-read the last search.** "I meant X", "no, X" and "I didn't mean Y, I meant X" apply X to the saved request: what they name (amounts, a topic, a window, a sender) changes, and everything else stays. "I meant" followed by a sender-like name is a sender correction (R11.4); followed by a document or amount word it is never a sender.

## R6. No-result replies (in this order)
1. **R6.1** Nothing in the requested window: show the most recent match outside it.
2. **R6.2** Mail from that sender exists but is the wrong kind: say so and show the closest one.
3. **R6.3** Otherwise: "couldn't find", naming what was searched, including the window.

**R6.4** Every no-result reply is written in Daylark's voice: one to three sentences that say plainly nothing matched, mention what was searched in natural words, and offer one concrete next step or one specific question. It never uses the stock sentence "I couldn't find matching email in the connected Gmail account", never invents an email, and never sounds like a system message. A near miss (R6.1, R6.2) is shown as a plain list under the sentence, and the exact search terms follow (R11.2).

## R7. Side effects
- **R7.1** Read-only: search, summaries, spending questions.
- **R7.2** Approval required: calendar changes and finance imports. One approval may cover a batch. Duplicates are skipped when the approval is confirmed.
- **R7.3** Never: sending, deleting, forwarding, archiving or labelling email. Gmail access is read-only **until R25 ships**; after that the only mailbox change is creating a draft, with approval, and nothing is ever sent.
- **R7.4 Clarify, don't refuse**: empty or unclear model output becomes a clarifying question. Only the deterministic safety rules (R1.1, R1.2) decline. A refusal from the model is kept as a backstop for harmful content only.

## R8. Finance
- **R8.1** Spending is only what was told to Daylark or imported. Nothing is inferred from another source.
- **R8.2** A merchant question ("how much did I spend on X", "…spend X") filters by merchant, defaulting to the last 12 months. A missing merchant never falls back to an unfiltered total.
- **R8.3** With no recorded spending for a merchant, offer an email import. Never invent a total.
- **R8.4 Bulk import cap**: at most 5 orders per request. Each is read from the email body, and the reply says when more remain.
- **R8.5** Bulk import searches by confirmation-style subject (confirmed, confirmation, receipt, invoice, ordered) over up to 50 candidates, so promo and shipping mail cannot crowd out older orders. A period in the request ("last 30 days") narrows the search.

- **R8.6** A bulk import card always says what it searched (the window and the span of dates found) and lists every skipped email with its reason (not a purchase record, no total, no date, couldn't be read).
- **R8.7** If the model can't find a total, a labeled total in the body ("Total: $26.06") is used. If it can't find a date, the email's own date is used and the card marks it "(email date)". A missing amount is never guessed.
- **R8.8** Finance requests that are neither a spend, a spending question nor an import get a clarifying question, never a canned capability sentence.

- **R8.9** Email body text is decoded (HTML entities such as `&#36;`, invisible characters, comments and head content) before any amount is read. Amounts may be written `$12.34`, `US$12.34`, `USD 12.34` or `12.34 USD`. A "no total" skip says how much text was read and how many price-like numbers it contained.

- **R8.12** "So far", "all time", "overall", "to date", "altogether" and "in total" mean everything recorded, not this month. "Last 60 days" and similar are rolling windows. A broad period (so far, this year, the last 12 months, 60+ days) adds a category breakdown, the biggest transactions, and for "so far" the span of dates recorded. The default with no period is still this month.
- **R8.10** Tracking links are collapsed before reading, and up to 150,000 characters of the body are kept for deterministic checks. The model gets at most 18,000 characters: the start of the email plus windows around money words (total, amount, charged, paid), so a total deep in a long email is never cut off.
- **R8.11** An order confirmation with a readable total is imported with no model call: amount from the email's labeled total, date from when it arrived, merchant from the sender's display name. Anything unclear falls back to the model, and the model's reading of an email is cached per email, so the same email is never read twice. This keeps imports repeatable and inside the daily model budget (`MODEL_DAILY_TOKEN_BUDGET`, 100,000 tokens by default).

## R9. Model budget
- **R9.1** Deterministic: routing, dates, senders, evidence, dedupe.
- **R9.2** Small model: amount/date extraction, casual replies.
- **R9.3** Larger model: web synthesis and genuinely ambiguous requests.
- **R9.4** No model call for anything a rule can decide.

## R10. Evals
Each rule above has rows in `evals/` (`email-parsing.jsonl`, `email-variants.jsonl` (the same request in many wordings), `email-relevance.jsonl`, `email-followups.jsonl` (checked on structure, not on rewritten text), `email-import.jsonl`, plus the existing `routing.jsonl` and `safety.jsonl`). A new bug adds a row citing its rule, or adds a new rule here first.

## R11. Default window, visible search terms, learning
- **R11.1** An email search with no window searches the last 30 days. The window is marked "(default)" wherever it is shown.
- **R11.2** Every email answer ends with the search terms Daylark actually used (topic, sender, window, filters, exclusions), so the user can see what was searched and correct it.
- **R11.3** If a search finds nothing in the default or requested window, Daylark looks back up to a year and says so (R6.1). A "facts" question (amount, billing date) continues with that older match and says the window was widened.
- **R11.4 Learning.** Daylark remembers two kinds of correction, per user, encrypted at rest:
  - a default window: "always search 90 days", optionally for one topic ("for receipts");
  - a sender alias: after a search for X, "I meant Y" (or "no, Y", "it's Y", "should be Y") makes X mean Y from then on.
- **R11.5** A correction is confirmed in one line, and the last search is re-run with it. Learned values are applied before defaults, and an explicit window in the message always wins.
- **R11.6** Learning is only triggered by explicit corrections. Daylark never learns from ordinary questions.
- **R11.7** "All", "every" or "each" with no window means the longest window (365 days), not the 30-day default, and is shown as an explicit window.
- **R11.8 Learning what a request means.** When the user corrects how a receipt request was read ("I didn't mean the confirmation emails, I meant the amount receipts") or states it ("always show amounts for receipts"), Daylark remembers that plain receipt requests mean the amounts list. It applies to any receipt request that does not say "emails", "messages" or "just list", and the answer says it did so and how to undo it. It is shown under "What I've learned" and removed with "forget receipt amounts".

## R12. Interpretation and clarification
- **R12.1** Interpret first: typos, shorthand and fragments are read using the conversation before anything is refused or questioned.
- **R12.2** When the interpretation is a guess (an unfamiliar brand, a bare word, two plausible readings), say how it was read and ask one specific question that names the likeliest alternative.
- **R12.3** Ask when the answer would change the result. Otherwise proceed with the most plausible reading and show it (R11.2).
- **R12.4** Never refuse because input is unclear or misspelled.

## R13. Ordinal references
- **R13.1** Email results are shown numbered (1., 2., …). "The second one", "#2", "2nd", "the first", "the last one" and "the latest/newest/oldest one" refer to that list, which is the saved state from R5.7.
- **R13.2** The verb picks the action: import, record or save imports that email; amount, total, how much or billing date reads its amount and date; show, open, read, details, or no verb at all shows the email.
- **R13.3** "it", "that one" and "this one" mean the only result. With several results, Daylark asks which number.
- **R13.4** A number beyond the list says how many results there were. With no saved list (or a stale one), Daylark says there is nothing to point at and offers to search again.
- **R13.5** Importing a referenced email still needs approval (R7.2). The user pointed at it, so the "does this look like a receipt" heuristics are skipped, but the model's transaction check still applies.
- **R13.7 Amounts list.** A plural receipt request that asks for amounts ("show the amounts on my iherb receipts", "I meant the amount receipts") lists each receipt with its amount and date, and a total when every amount was read. "Latest" or a singular noun asks for one invoice's details instead.

## R14. Learning beyond email
- **R14.1 Calendar.** Two learnable preferences: a default event length (used only when the event has no end or length) and a buffer in minutes (added to "can I make it" answers).
- **R14.2 Finance.** Two learnable corrections: merchant to category ("iHerb is health") and merchant alias ("amzn means Amazon"). They apply to every new record or import preview (typed, email, receipt, bulk) and are not retroactive.
- **R14.3** Triggers are explicit: "by default", "always", "from now on" for calendar preferences; "X is <category>", "categorize X as <category>", "put X under <category>", "X means Y" for finance. Each is confirmed in one line.
- **R14.4** Categories come from a fixed set (restaurants, groceries, transport, shopping, utilities, entertainment, health, housing, other). Synonyms map to it; anything else is not learned and Daylark asks which category was meant.

## R15. Seeing and forgetting what was learned
- **R15.1** "What have you learned", "what do you remember" and "show my preferences" list everything, grouped, in plain words.
- **R15.2** "Forget X" removes every learned item that mentions X, and says what was removed. "Forget the default window", "forget the calendar buffer" and "forget my default event length" remove those.
- **R15.3** "Forget everything" changes nothing and asks the user to say "yes, forget everything". Only that phrase deletes.
- **R15.4** With nothing learned, Daylark says so and shows how to teach it.
- **R15.5** Learned items are per user and encrypted at rest. Listings show only what the user said.

## R16. One interpreter for email (determinism over speed)
Decided by the owner: consistent behavior matters more than latency; roughly 600 ms per interpreted message is acceptable.
- **R16.1 One path.** Every message that looks like email, and every message while a fresh email search is saved (R5.7), is interpreted by one model call. Rules and the model never both interpret the same message, because two interpreters can disagree.
- **R16.2 The model only fills a fixed form.** It receives the message, the saved request, the numbered results and known sender names, and returns the structured request (domain, action, topic, sender, window, unread, real-people, exclusion, confidence, one clarification question, a one-line reading). It has no tools and cannot search, import or change anything.
- **R16.3 Repeatable.** Temperature 0, a JSON schema, and a versioned prompt. Nothing that changes from day to day (dates, clocks) is in the prompt. The result is cached per user by the exact message, the saved request and the prompt version, so the same input in the same context resolves the same way every time.
- **R16.4 Code has the last word.** The result is canonicalized before use, so anything that could vary from run to run is decided by code and not by the model:
  - A sender can never be a pronoun, verb, document word or window phrase (R3.2), and it keeps the casing the user typed.
  - A filter (unread, real people), a window (days or calendar) or an import can only be set if the message says so or the saved search already had it. The model can never invent one.
  - Windows are integers from 1 to 365; "all" without a window becomes 365 days (R11.7); imports and amounts imply the receipt topic.
  - Facts versus amounts follows the plural and "latest" rule (R13.7); amounts or facts need an amount word.
  - The exclusion clause is taken verbatim from the message, or carried from the saved search, never from the model's paraphrase.
  - Confidence is kept only as sure or unsure (the 0.7 line), and the clarification wording is dropped when sure.
  The defaults, learned values, Gmail search, receipt evidence, dedupe and approvals stay rule-based (R4, R7, R11).
- **R16.5 Ask when unsure.** Confidence below 0.7 with a clarification sends the question to the user, naming the likeliest readings, and searches nothing (R12).
- **R16.6 Not email means not email.** When the model says the message is about something else, it falls through to normal routing.
- **R16.7 Failure is visible in the logs.** If the model call fails, the older rule-based interpretation is used and the source is logged as "rules". It is never mixed with a model result.
- **R16.8 Gated by evals.** Changing the prompt means bumping its version and passing the live eval (`npm run eval:live`): every case in the email datasets must resolve as expected, and each case is run twice to prove the request is identical. The model still varies at decision boundaries (a genuinely ambiguous message can land either side of "sure"), so the per-user cache (R16.3) is what makes a given input stay resolved the same way.

## R17. Bills, payments and what counts as spending
Decided by the owner: a bill counts as spending only when it is paid; unpaid or unknown bills are shown separately as outstanding. Paid status can come from a matching payment email, from the user, from a declared autopay, and from asking on the due date.
- **R17.1 Three kinds of document.** By subject: a *bill* ("statement is ready", "bill is available", "amount due", "payment due"); a *payment* ("payment received", "payment confirmation", "we've received your payment"); anything else with a total is a *purchase* (order confirmation, receipt).
- **R17.2 A bill is stored as a bill, not an expense.** Its import card says it is not counted as spending until paid. It keeps the statement date, the amount, and the due date when the email states one ("due date", "payment due", "pay by").
- **R17.3 Totals count expenses only.** Paid bills become expenses when paid. Every spending answer adds one line when bills are outstanding: "Not counted yet: 1 unpaid bill, $146.30 (PG&E, due Oct 5)."
- **R17.4 A payment settles a bill.** A payment email from the same merchant, after the bill's statement date, for the same amount (within $1 or 1%), marks that bill paid and creates one expense dated on the payment. It never creates a second expense. The import card says "This pays your <merchant> bill of $X". A payment with no matching bill imports as a plain expense (rent). Card-issuer payments and card or bank statements are never imported (R8.1).
- **R17.5 The user can say it.** "I paid the PG&E bill" (optionally "on Sep 20") marks the oldest outstanding PG&E bill paid, recorded as an expense on that date, or today.
- **R17.6 Autopay.** "PG&E is on autopay" is learned per merchant. Its bills with a known due date count as paid on that date. Without a due date they stay outstanding and Daylark asks.
- **R17.7 Ask on the due date.** An outstanding bill past its due date with no payment found is listed as past due, with the question "Did you pay it? Say 'I paid the PG&E bill'".
- **R17.8 Asking about bills.** "What bills are outstanding", "what do I owe" and "my bills" list outstanding bills, past due first, with a total. Before listing, Daylark looks for a matching payment email for up to 5 bills and tells the user what it found, so they can confirm.
- **R17.9 Never guess.** A bill whose amount cannot be read is not imported.

## R18. Status of a matter with a company
- **R18.1** A question about the status, progress or latest news of a named matter with a named company ("what's the status of my Chase dispute", "any update on my Amazon refund", "where is my Uber claim") is an email lookup. It is decided by rule and needs no model, so it works even when the model budget is used up.
- **R18.2** Daylark searches that sender's mail for the matter word (dispute, claim, case, refund, return, application, ticket, request, complaint, chargeback) over the last 365 days, newest first, and shows the latest email with the start of its text, plus up to three earlier ones with dates.
- **R18.3** It says what it is: what the latest email said, as of its date. It is not the company's live status, and Daylark says to check with the company for that.
- **R18.4** With no match it says so, names what was searched, and asks whether the company or wording is different, or whether the matter was handled by phone or letter.
- **R18.5** When the model token budget is reached, the reply says so plainly and names the setting (`MODEL_DAILY_TOKEN_BUDGET`), instead of a generic failure.

## R19. Model first: one router decides intent, agents do the work
Decided by the owner: intent is classified by a model before any agent is chosen. Rules no longer decide what a message means.
- **R19.1 Nothing judges the message before the router.** Safety, crisis, unsafe requests, approvals ("yes", "go ahead", "don't do that") and casual chat are all decided by the router, in any wording. The router is told whether an approval is pending. Fixed, careful texts (the crisis reply, the refusal) are what is shown once the router has decided; they are not re-decided by rules.
- **R19.2 One router call for everything else.** It receives the message, the last few turns, and a summary of the saved email search (request and numbered results). It returns one operation, its arguments, a confidence, and a clarifying question. It has no tools and changes nothing.
- **R19.3 Operations.** `email` (search, list, amounts, import, follow-ups), `status_lookup`, `finance_spending`, `finance_record`, `bills_list`, `bills_paid`, `bills_autopay`, `learning_show`, `learning_forget`, `learning_teach`, `calendar_query`, `calendar_create`, `calendar_delete`, `calendar_attendees`, `schedule_feasibility`, `web_search`, `multi` (with the agents involved), `email_write_declined`, `casual`, `unsupported` and `clarify`.
- **R19.4 Agents receive a decision, not a guess.** Each operation calls the existing deterministic handler with the router's structured arguments. Search, extraction, dedupe, bills, learning, approvals and every write stay in code.
- **R19.5 Code checks structure, never meaning.** The router's result is validated against its schema: known operation, required fields present (a bill's merchant, a lesson's values, at least two agents for a multi-step request), numbers in range, dates in ISO form. A missing required field becomes a question to the user. Code does not receive the user's message here, so it cannot override how the model read it.
- **R19.6 Unsure means ask.** Below 0.7 confidence the router's one question is asked and nothing runs (R12).
- **R19.7 Repeatable.** Temperature 0, a schema, a versioned prompt (`router-vN`), and a per-user encrypted cache keyed by the message, the last turns and the saved state. The same input in the same context resolves the same way.
- **R19.8 Fallback (superseded by R20.5).** ~~Only when the router call fails does the older rule chain run.~~ Since 2026-09-20 there is no rule-based fallback: see R20.5.
- **R19.9 Evals.** `evals/router.jsonl` holds one row per operation and wording. Changing the router prompt means bumping its version and passing `npm run eval:live`.

## R20. Rules never judge what a user means
Decided by the owner, and it overrides earlier rules that say otherwise: a model interprets the user's words, including dates, places, typos and paraphrase. Code and rules never decide what a query means, never veto or rewrite the model's reading of it, and never gate a model decision on whether a word appears in the message.
- **R20.1 What code may do:** validate structure (schema, allowed values, ranges, required fields), run deterministic work on the model's structured result (search, arithmetic, dedupe, storage), and require the user's approval before a write.
- **R20.2 Where determinism comes from:** a versioned prompt, temperature 0, worked examples, a per-user cache of the model's reading, and live evals that must pass before a prompt changes. Not from vetoes.
- **R20.3 (superseded by R20.5).** ~~Rules remain only as the fallback when the model cannot be used.~~
- **R20.5 No rule-based classification, anywhere, including as a fallback.** Decided by the owner on 2026-09-20 (restated, in capitals: DO NOT USE RULES TO CLASSIFY THE USER QUERY, USE MODELS). What a message means, its intent, its dates, places, senders, merchants, and whether it is in scope or off-topic are decided only by a model. When no model can be used (no credit, budget used up, provider down), Daylark says it cannot interpret requests right now and does nothing; it does not guess with patterns. The only non-model paths are explicit interface actions that are not free text (the Confirm and Cancel buttons, a menu choice), which carry a fixed value and need no interpretation.
- **R20.6 Validators check form, never meaning.** A validator may reject a model result that is malformed or impossible (a date that does not exist, a negative amount, a position past the end of a list). It may not change the operation, may not read the user's message to do so, and may not override the model's reading. A validator failure becomes a repair attempt, then a question (R22).
- **R20.4 Not yet converted (tracked; must now also be removed, not only converted):** the email interpreter (R16.4) still overrides the model with message-based checks (filters, windows, imports, "all", facts versus amounts, the exclusion clause), and the email turn still detects ordinal references and corrections with patterns. These are to be replaced by fields the model fills, and verified with the live eval.

## R21. Evals grow for free and run on demand
Decided by the owner, after live evals used about $10 of API credit: datasets are appended as behavior is added, and the model is not run against them every time.
- **R21.1** Every new behavior or bug adds rows to the datasets. Rows are cheap; runs are not.
- **R21.2** `npm test` and `npm run eval` never call the model. Live evals run only on request.
- **R21.3** A live run is incremental: it sends only cases that are new, edited, or for a changed prompt version, using `evals/verified/*.json`.
- **R21.4** A live run is preceded by a plan (`npm run eval:cost`): pending count and an estimated cost. It needs an explicit `LIVE_EVAL_CONFIRM=yes`, and Daylark's assistant asks the owner before running one.
- **R21.5** Repeatability checks run only when asked for, on a sample.

## R22. When in doubt, ask
Decided by the owner on 2026-09-20: if there is real doubt about what the person means, Daylark **asks a clarifying question** instead of answering with a stated default or guessing. Doubt means more than one plausible reading that would give a different result, or a required detail the person did not give and that cannot be defined from the request. This supersedes any earlier line that says to answer an ambiguous read-only request with a default and mention it.
- **R22.1 What is not doubt:** a value the owner has already defined as the default for an unstated detail is not a reason to ask. The rolling 30-day window when no period is given (R11) stays, and the answer shows the search terms. If the owner wants even that to be asked about, R11 must be changed explicitly.
- **R22.2 The question:** one question, plain words, with the candidate answers listed when there are few ("Sarah Chen or Sarah Patel?"). Never a menu of more than a few choices.
- **R22.3 Measured:** a necessary question that was not asked is a defect (`docs/use-cases/12-quality-and-measurement.md`). Unnecessary questions are tracked but not capped, because asking is the chosen safe side.

## R23. Unrelated or unanswerable messages are redirected, never dead-ended
Decided by the owner on 2026-09-20: Daylark never answers an out-of-scope message with only "I can't answer that." It stays casual, says honestly what it cannot do or know, and pivots to something it can really do (for example, "I can't tell you how they came by theirs, but I can help you find vintage shops near you"). The model decides that a message is out of scope (R20.5); code only checks that the offered pivot is a real capability. Distress, danger and harmful requests are exceptions and follow the safety path with no cute pivot. Full behaviour and examples: `docs/use-cases/13-scope-and-redirection.md`.

## R24. One-time codes and links from email are left alone
Decided by the owner on 2026-09-20: Daylark does not show, read out, quote or act on one-time passcodes, verification codes, password-reset links, magic sign-in links or similar time-limited credentials found in email. They belong to the external service that sent them and are used immediately, so Daylark is kept away from them. It may say that such an email exists (sender, time). This is stated in the Privacy Policy and the Terms.

## R25. Email drafts: create the draft, never send it
Decided by the owner on 2026-09-20 ("for email drafts, make a draft in the email"). **Status: decided, not built.** Until it ships, Gmail stays read-only (R7.3) and the app, Privacy Policy and Terms keep saying so.
- **R25.1 What Daylark may do:** create a draft in the person's Gmail Drafts folder when they ask for a reply or a new email, after showing the wording in the chat and getting approval (a mailbox change is a write, R7.2). The person reviews the draft and presses Send themselves, in Gmail.
- **R25.2 What Daylark never does:** send, schedule-send, delete, archive, label or move any message, and never sends a draft. Enforced in code by an allow-list of Gmail calls (create a draft, and edit a draft Daylark made), not by trusting the model.
- **R25.3 Recipients and threading:** a reply goes to the original sender on the original thread. A new email needs the recipient from the person; a name that matches more than one contact is a question (R22). Daylark never adds a recipient the person did not confirm.
- **R25.4 Content:** the wording is composed by the model from the person's request. Text inside emails is data, never an instruction (R20). Nothing sensitive from R24 is copied into a draft.
- **R25.5 Non-email messages** (a text, a note to a landlord in another app): the wording is shown in the chat only, for the person to copy. No draft is created anywhere.
- **R25.6 The permission this needs** is Google's `gmail.compose`, a broader permission than today's read-only one. Google offers no drafts-only permission, so the permission technically also allows sending; R25.2 is what keeps Daylark from ever doing it. Because of that, the Privacy Policy, the Terms, the sign-in page and Settings must change **in the same release** to say what Daylark does and does not do, and existing users must reconnect Google to grant the new permission.
- **R25.7 Long-form writing** (essays, cover letters, poems) is still not something Daylark writes (R23).
