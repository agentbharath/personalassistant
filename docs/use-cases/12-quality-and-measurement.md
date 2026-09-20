# 12 · The quality bar and how we measure it

The target from the owner: **99.99% for intent and understanding; latency and speed may suffer, quality may not.** This file says what that can honestly mean, how the system is built to reach it, and how we would know.

## 1. What "99.99%" can and cannot mean

An AI model reading free text cannot be *proven* 99.99% accurate on everything people might type. Two facts:

- **Statistics.** To show an error rate below 0.01% with 95% confidence you need about **30,000 independent test cases with zero errors** (the "rule of three": 3 ÷ 30,000 = 0.01%). Our current eval sets have hundreds of cases. A number like "99.99%" from that would be meaningless.
- **Language is open-ended.** New phrasings keep appearing. What we can guarantee is *structure*, not that every phrasing is read correctly.

**Owner instruction (2026-09-20): make the target the largest number possible.** So the targets below are set as high as they can be set honestly, and the claim Daylark makes about itself is always **the number we have demonstrated**, never the target. A target can be five nines; a claim needs the evidence.

### What each number costs to demonstrate

With zero errors observed in *n* independent trials, the 95% confidence lower bound on accuracy is about 1 − 3/n:

| Error-free trials | Demonstrated accuracy (95% confidence) |
| --- | --- |
| 300 | 99% |
| 3,000 | 99.9% |
| 30,000 | 99.99% |
| 300,000 | **99.999%** (five nines) |
| 3,000,000 | 99.9999% |

Every error found in a run moves the bound down and becomes a new regression case. A number above what the evidence supports is not reported.

### The tiers

| Tier | Statement | How it is achieved | **Target** | Demonstrated today |
| --- | --- | --- | --- | --- |
| **T0. Invariants** | No write without approval. Email never modified. One user never sees another's data. Text inside an email, page or file never triggers an action. Secrets never logged. Codes and links in email never shown (R24). | **By construction** (code gates, row-level security, structural separation of data from instructions), verified by property and adversarial tests | **100%, no exceptions.** One violation is a stop-ship bug | not yet measured |
| **T1. Never silently wrong on actions** | For any request that leads to a write or a statement of financial fact, the outcome is either **correct**, or Daylark **asked or declined**. | Frame → validate form → verify → (consensus) → ask (`11`) | **≥ 99.999%** "correct-or-asked" | not yet measured |
| **T2. Intent accuracy** | The operation chosen is the right one (decided by a model, R20.5). | Model router, strict schema, verifier | ≥ 99.9% on clean paraphrase sets; ≥ 99% on the hard set; per category, never averaged away | ~97% on the router set before credits ran out (106 cases) |
| **T3. Slot accuracy, exact values** | Dates, times, amounts, senders, merchants are exactly right. | Model resolves, code validates form, ambiguity forces a question | Dates ≥ 99.99%; amounts 100% when present in the source | not yet measured |
| **T4. Follow-up resolution** | "the second one", "and yesterday?", "no, aws" resolve correctly. | State per domain, explicit references, ask when unresolved | ≥ 99.9%; unresolved → asked | not yet measured |
| **T5. Clarification quality** | Asks when in doubt (R22). | Thresholds tuned on the labelled set | Missed necessary questions ≤ 0.01%. Unnecessary questions are **tracked, not capped**: the owner chose the safe side | not yet measured |
| **T6. Redirect quality** (`13`) | An unrelated or unanswerable message never gets a bare refusal; the pivot is a real capability; no pivot to a distressed person | Router `redirect` with a validated pivot | **100%** no bare refusals; **100%** real pivots; **100%** no pivot under distress; tone graded by rubric | not yet measured |

**The honest summary:** the largest numbers apply to T1, T0 and T6, and they are reachable because Daylark is allowed to say "I'm not sure, which do you mean?". Raw first-try understanding across all wording will be lower, and that is fine, because a question is not an error. What must never happen is a confident wrong answer or a wrong write. Five nines on T1 needs ~300,000 error-free cases; that is built in stages (see §4), and until each stage is run the demonstrated number stays where the evidence puts it.

## 2. How the system reaches it (design, not hope)

1. **The model interprets, into a strict schema** (`frame-v1`), with today's date, the user's time zone, conversation state, learned aliases and saved places in context.
2. **Deterministic validation of form only** rejects impossible or malformed readings: non-existent dates, negative amounts, ordinals beyond the list, mismatched risk. It never reads the message and never reclassifies (R20.6). **Every judgement about meaning, including the verifier and the consensus readings, is made by a model; there are no classification rules and no rule-based fallback (R20.5).**
3. **An independent verifier** re-reads the message and the frame and reports mismatches. It runs for every write, every low-confidence slot, every multi-part message, and a sampled share of the rest.
4. **Self-consistency** (extra independent readings) runs only when the verifier disagrees or confidence is low. A disagreement on any result-changing slot becomes a question.
5. **Abstain thresholds per slot.** A slot below its threshold is asked about; it is never filled by a guess. Thresholds are tuned on the labelled set so that "wrong and answered" is driven toward zero.
6. **Every default is stated in the answer** ("last 30 days", "afternoon = 12–5 pm") so a wrong assumption is visible and correctable, and the correction can become a lesson.
7. **Approval gates are code, not model**: a write cannot proceed without the approval state, whatever the model says.
8. **The model never sees instructions from data**: email, web and file text is passed as clearly delimited data.

## 3. Error severity

| Level | Definition | Example | Policy |
| --- | --- | --- | --- |
| **S0** | A wrong write, or a confident wrong financial or date fact, or a data-boundary violation | Deleted the wrong event; said a bill is paid when it is not; ran a write with no approval | Zero tolerated. Stop-ship. Add a regression case immediately |
| **S1** | Confident but wrong read-only answer | Listed the wrong sender's mail without saying so | Counted in T1's wrong-answered rate |
| **S2** | Wrong but flagged (stated assumption was wrong) or an unnecessary question | Asked "which Amazon?" when only one exists | Counted in T5 |
| **S3** | Awkward wording, verbose, formatting | | Tracked, never blocks |

## 4. Datasets

| Set | Purpose | Contents | Rules |
| --- | --- | --- | --- |
| **Golden** | The regression gate | Hand-written from the use-case tables (each ID → ≥ 1 case, several wordings) with expected frame or expected behaviour | Every bug adds a row citing its rule and use-case ID (R10, R21) |
| **Paraphrase** | Robustness to wording | Each golden case expanded ×20–50: synonyms, slang, typos, voice-style, other languages, word order | Generated with the model, **reviewed by a person**, deduplicated |
| **Adversarial** | Break it on purpose | Injection, ambiguity, near-miss senders, vague follow-ups, date traps, conflicting sources, oversize input | Grows with every incident; includes property tests for T0 |
| **Held-out** | Honest measurement | A slice of each set that is **never** used to tune prompts or examples | Locked; used only to report |
| **Real traffic (opt-in)** | What people actually type | Sampled from consenting users' history, labelled by a person | Private; never committed; message text not kept unless the owner opts in |

Size plan (starting points; the goal is coverage of every use-case ID, then depth where errors cluster):

| Domain | Use-case IDs today | Golden cases (≥) | With paraphrases (≈) |
| --- | --- | --- | --- |
| Email | 75 | 300 | 6,000 |
| Calendar | 66 | 300 | 6,000 |
| Money and banking | 64 | 250 | 5,000 |
| Search | 36 | 120 | 2,400 |
| Cross-domain | 26 | 100 | 2,000 |
| Learning and location | 35 | 100 | 2,000 |
| Conversation and follow-ups | 40 | 250 | 5,000 |
| Meta, safety, injection | 43 | 200 | 4,000 |
| Input quality and locale | 51 | 150 | 3,000 |
| **Total** | **436** | **≈ 1,770** | **≈ 35,400** |

That is roughly 4 golden cases per row on average, and more where one row stands for many wordings (follow-ups, dates, bank language). The 436 rows are a **starting catalogue, not a complete one**: the first shadow run and real traffic will add rows, and every S0 or S1 error adds one.

Reaching ~30,000 cases is what makes a T1 statement statistically defensible. It costs real model spend, so it is built and run **incrementally** with cost quotes and approval (R21). Deterministic checks (validation, T0 property tests, schema conformance) run free on every change.

## 5. Labelling guidelines

- One expected frame per case (operation, slots, time, references), or an expected behaviour (`ask`, `decline`, `approve_first`).
- Where two readings are truly reasonable, the case expects a **question**, not either reading.
- Two people label a sample; disagreements are resolved and the guideline is updated. Track agreement.
- Dates are labelled against a **fixed "today"** and time zone stored with the case.

## 6. Release gates

A change to a prompt, schema, validator or handler ships only if:

1. T0 property tests pass (all of them, no exceptions).
2. The golden set has **no regressions** and no new S0.
3. Held-out results are not worse beyond the confidence interval; per-category floors hold (no category is hidden by an average).
4. Live evals ran on the changed cases only, after a cost quote and owner approval (R21), and their result is recorded in `evals/verified/`.

## 7. Production monitoring

| Signal | Use |
| --- | --- |
| "Bad answer" ratings with notes | Straight into `npm run feedback:export`, then labelled and added to golden |
| Clarification rate, by operation | Rising rate means thresholds or prompts drifted; falling to zero means guessing |
| Verifier disagreement rate | Early warning that the primary reading is drifting |
| Fallback-to-rules rate | Should be near zero when credits and the model are healthy |
| Approval-card cancel rate | A high cancel rate means the card showed something the person did not mean |
| Per-step latency and cost | Keeps the accepted slowness bounded and measurable |

## 8. Latency and cost, honestly

Frame plus verify is at least two model calls per turn, plus two more on hard turns. That is slower and costs more than today. It is accepted by design. The actual numbers must be measured on the first shadow run (no figures are claimed here), and the daily token budget (R9) will need to be re-set from those measurements.

## 9. Decisions

Decided by the owner on 2026-09-20 (now in `RULES.md` as R20.5, R22, R23, R24):

| # | Decision | Outcome |
| --- | --- | --- |
| D-2 | One-time codes and reset links in email | **Leave them alone.** Never shown, quoted or acted on (R24). Stated in the Privacy Policy and Terms |
| D-3 | Ambiguous asks: default or ask? | **Always ask when in doubt** (R22). The owner-defined 30-day default for an unstated window stays (R22.1) |
| D-4 | "3 o'clock" with no am or pm | **Ask**, unless the context makes only one reading plausible; the model judges that |
| n/a | Rules to classify queries | **Never** (R20.5): no rules, no rule-based fallback. Models only |
| n/a | The 99.99% target | **As high as possible**: T1 target ≥ 99.999%, with the claim limited to what is demonstrated |
| n/a | Unrelated or unanswerable messages | **Redirect, never a bare refusal** (R23, `13`) |

Still open:

| # | Decision | Why it matters | Recommendation |
| --- | --- | --- | --- |
| D-1 | Drafting: see the explanation below | EM-091 | Draft in chat only, for mail and calendar related messages |
| D-5 | Which languages are required at launch? | IQ-050…054 | English first, then Spanish |
| D-6 | Store an opt-in interpretation log for measurement, and how long? | `11` §8 | Opt-in, hashed, 90 days, no message text unless the owner opts in |
| D-7 | Clickable answer choices for clarifying questions (small UI addition) | `11` §10 | Yes: "always ask" makes questions frequent, so one tap beats typing |
| D-8 | Week starts Monday or Sunday by default? | EM-042, IQ-062 | Follow the user's locale (Sunday in the US) |
| D-9 | Who labels the real-traffic set? | §4 | The owner, on a small sample, plus a second reviewer |
| D-10 | Budget for building the 30,000 to 300,000-case measurement set | §4 | Build in stages; each stage needs a cost quote and approval (R21) |

### What "drafting" means (D-1)

It is about **the words in the chat window**, for any message, not the Gmail drafts folder. Daylark is signed in with Gmail's **read-only** permission, so it cannot create a Gmail draft, and it cannot send. If someone asks "help me reply to this" or "write a message to my landlord about the leak", the choices are:

1. **No drafting.** Daylark declines and offers to summarise the email being replied to.
2. **Draft in the chat.** Daylark writes the wording in its reply; the person copies it into Gmail or a text and sends it themselves. Nothing is created or sent. Suitable when the message is about the person's mail or calendar.
3. **Create a real Gmail draft.** Needs a broader Gmail permission (`gmail.compose`), a heavier Google review, and a change to the "we cannot change your email" promise in the Privacy Policy and Terms. Not recommended.

Until decided, behaviour is option 1.
