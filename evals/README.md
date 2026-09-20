# Daylark evaluations

These versioned datasets exercise behavior rather than UI details.

- `routing.jsonl`: expected deterministic route and agent selection.
- `safety.jsonl`: read/write classification and mandatory approval boundaries.
- `email-parsing.jsonl`, `email-variants.jsonl` (one request, many wordings), `email-relevance.jsonl`, `email-followups.jsonl`, `email-learning.jsonl` (corrections), `email-terms.jsonl` (search terms shown), `email-ordinals.jsonl` ("import the second one"), `learning-commands.jsonl` (view/forget), `preferences.jsonl` (calendar and finance corrections), `email-import.jsonl`: rule-level cases for email understanding. Each row cites a rule ID from `RULES.md`.

A new bug adds a row here that cites its rule, or adds the missing rule to `RULES.md` first.

Run `npm run eval` before deployment. The gate is intentionally strict: every deterministic safety and routing case must pass. Provider contract tests remain in the normal `npm test` suite. Live-model quality evaluation will be a separate opt-in job so development does not incur unexpected cost or send private data.

## Growing the datasets without paying for it (R21)
- **Append freely.** A new behavior or a new bug adds rows to the right dataset, citing its rule. That costs nothing.
- **Live evals are on demand.** `npm test` and `npm run eval` never call the model. The live evals (`evals/router.jsonl`, and the email interpreter cases built from the email datasets) run only when asked.
- **They are incremental.** `evals/verified/*.json` records which cases have passed against the real model for the current prompt version. A live run sends only the cases that are new, edited, or belong to a prompt version that has changed.
- **Plan first.** `npm run eval:cost` prints how many cases are pending and an estimated ceiling on the cost, and calls nothing. `LIVE_EVAL_CONFIRM=yes npm run eval:live` runs the pending cases. Without the explicit yes it only prints the plan.
- **No repeat runs by default.** A repeatability check runs only with `LIVE_EVAL_REPEAT=<n>`.

## Turning bad answers into eval cases
Rate an answer "Bad" in the app (add a note saying what was wrong). Then run `npm run feedback:export`. It calls no model and costs nothing.
It writes `evals/candidates/feedback.jsonl` (git-ignored, because it holds your private text) with the question, the answer, and your note.
A candidate has `expect: null`: decide what the right behaviour was, cite the rule it breaks (or add the rule to `RULES.md` first), and copy the row into the right dataset above.
Live evals still run only on request, with the plan-first flow described earlier.
