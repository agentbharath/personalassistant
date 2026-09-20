# 12 · The quality bar and how we measure it

The target from the owner: **99.99% for intent and understanding; latency and speed may suffer, quality may not.** This file says what that can honestly mean, how the system is built to reach it, and how we would know.

## 1. What "99.99%" can and cannot mean

An AI model reading free text cannot be *proven* 99.99% accurate on everything people might type. Two facts:

- **Statistics.** To show an error rate below 0.01% with 95% confidence you need about **30,000 independent test cases with zero errors** (the "rule of three": 3 ÷ 30,000 = 0.01%). Our current eval sets have hundreds of cases. A number like "99.99%" from that would be meaningless.
- **Language is open-ended.** New phrasings keep appearing. What we can guarantee is *structure*, not that every phrasing is read correctly.

So the bar is split into things that **can** be guaranteed and things that are measured:

| Tier | Statement | How it is achieved | Target |
| --- | --- | --- | --- |
| **T0. Invariants** | No write happens without approval. Email is never modified. One user never sees another's data. Text inside an email, page or file never triggers an action. Secrets are never logged. | **By construction** (code gates, row-level security, structural separation of data from instructions), verified by property tests and adversarial tests | **100%, no exceptions.** A single violation is a stop-ship bug |
| **T1. Never silently wrong on actions** | For any request that leads to a write or a statement of financial fact, the outcome is either **correct**, or Daylark **asked or declined**. | Frame → validate → verify → (consensus) → abstain (see `11`) | **≥ 99.99% "correct-or-asked"**, reported with a confidence interval on a large adversarial plus real set. Wrong-and-confident is S0 |
| **T2. Intent accuracy** | The operation chosen is the right one. | Model-first router with structured output and verification | ≥ 99.5% on clean paraphrase sets; ≥ 98% on the hard set; per category, never averaged away |
| **T3. Slot accuracy, exact values** | Dates, times, amounts, senders, merchants are exactly right. | Model resolves; **code validates** (real dates, ordering, ranges); ambiguous dates force a question | Dates ≥ 99.9% exact on the date set; amounts 100% when present in the source |
| **T4. Follow-up resolution** | "the second one", "and yesterday?", "no, aws" resolve correctly. | Conversation state per domain, explicit references, ask when unresolved | ≥ 99% on the follow-up set; unresolved → asked |
| **T5. Clarification quality** | Asks when it must; does not ask when it need not. | Thresholds tuned on the set | Missed necessary questions: ≤ 0.1%. Unnecessary questions on read-only asks with a sensible default: ≤ 3% |

**The honest summary:** the 99.99% figure applies to T1, and only because Daylark is allowed to say "I'm not sure, which do you mean?". Raw first-try understanding across all wording will be lower, and that is fine, because a question is not an error. What must never happen is a confident wrong answer or a wrong write.

## 2. How the system reaches it (design, not hope)

1. **The model interprets, into a strict schema** (`frame-v1`), with today's date, the user's time zone, conversation state, learned aliases and saved places in context.
2. **Deterministic validation** rejects impossible or malformed readings: non-existent dates, negative amounts, ordinals beyond the list, mismatched risk.
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

## 9. Decisions needed from the owner

| # | Decision | Why it matters |
| --- | --- | --- |
| D-1 | May Daylark **draft text** in chat for the person to send (still not sending)? | EM-091 |
| D-2 | One-time codes and reset links in email: **never** surface, or surface with a warning? | EM-027, EM-095 |
| D-3 | Ambiguous read-only asks: **answer with a stated default**, or **always ask**? The doc assumes the former; the latter is slower and safer | T5, EM-047, CA-074 |
| D-4 | "3 o'clock" with no am/pm: assume working hours and state it, or always ask? | CA-036 |
| D-5 | Which languages are required at launch? | IQ-050…054 |
| D-6 | Store an opt-in interpretation log for measurement, and how long? | `11` §8 |
| D-7 | Clickable answer choices for clarifying questions (small UI addition)? | `11` §10 |
| D-8 | Week starts Monday or Sunday by default? | EM-042, IQ-062 |
| D-9 | Who labels the real-traffic set, and is the owner comfortable reading their own messages for that? | §4 |
| D-10 | Approval for spend: a budget for building the ~30,000-case measurement set | §4 |
