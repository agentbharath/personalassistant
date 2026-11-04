# Daylark

**Your day, in one conversation.** A private personal assistant that understands my calendar, email, and spending together, and never changes anything without my approval.

**Live:** [personalassistant-delta.vercel.app](https://personalassistant-delta.vercel.app) (sign-in is restricted to me, since it runs on my real Gmail, calendar, and finances) ·

<p align="center">
  <img src="https://github.com/user-attachments/assets/9314d207-7682-424d-908c-cd03c087ea7b" width="30%" alt="Home" />
  <img src="https://github.com/user-attachments/assets/df24badd-691f-46f6-8a29-4280cf8138ff" width="30%" alt="Styled answer card" />
  <img src="https://github.com/user-attachments/assets/1a7d0212-ca9a-4b14-9b4b-c3079c0a0698" width="30%" alt="Perch spending view" />
</p>


---

## What it does

Ask in plain language, across domains, in one message:

- *"Can dinner fit before my 7:30 meeting?"* → checks the calendar, finds a 2h 10m window, says when to leave
- *"How much did I spend on food last month, and do I have any bills due this week?"* → two agents run in parallel, one answer
- *"Find my iHerb receipts and import the second one"* → searches Gmail, parses the receipt, asks before writing it to finances
- *"Add a dentist appointment Friday at 3"* → drafts the event, shows an approval card, writes only on confirm

**Perch** is the day-at-a-glance view: today's meetings, mail worth attention, and upcoming dues.

## Architecture

```
               user message
                    │
        ┌───────────▼────────────┐
        │  Deterministic pipeline │  safety → scope → pending approvals
        │  (RULES.md R1)          │  → normalize → writes → reads
        └───────────┬────────────┘
                    │  model router only when no rule matches
        ┌───────────▼────────────┐
        │      Orchestrator       │  intent, dependency planning, parallel
        │                         │  dispatch, retries, cost budgets
        └──┬───────┬───────┬───┬─┘
           │       │       │   │
      ┌────▼──┐ ┌──▼───┐ ┌─▼───▼──┐ ┌────────┐
      │ Email │ │ Cal. │ │Finance │ │General │   each agent gets only
      └───┬───┘ └──┬───┘ └───┬────┘ └───┬────┘   its own clause + tools
          │        │         │          │
     Gmail (RO)  Google    Supabase    web, weather,
                 Calendar  ledger      maps, stocks
                    │
          ┌─────────▼──────────┐
          │ Approval + idempotency gate │  every state change
          └────────────────────┘
```

**Key design decisions**

- **Rules before models.** A deterministic pipeline handles safety, scope, approvals, and routing for everything it can recognize. The LLM router is the fallback, not the default. This makes behavior predictable and cheap to test.
- **Constrained agents.** Four agents (General, Calendar, Email, Finance), each with a narrow tool set. Multi-part requests are split so each agent sees only its clause.
- **Grounded answers.** Amounts and claims in a reply are checked against the source data before they're shown (`amount-grounding`, `claim-grounding`).
- **One ledger.** Gmail imports, typed entries, PDFs, and images all flow into a single transaction table with deduplication.
- **Cross-chat memory.** Facts and corrections I give it are extracted, stored, and applied in later conversations, and can be viewed or forgotten by command.

## Safety and privacy

- Email access is **read-only**. Email writes are declined.
- Calendar and finance writes require an **explicit approval**, with idempotency keys so a retry never double-writes.
- No destructive agent tools exist in the runtime.
- External content (emails, web pages) is treated as **untrusted data**, never as instructions.
- Conversations are **encrypted at rest**. PII used for lookups is HMAC'd.

## Evals: rules → datasets → CI gate

Behavior is specified in [`RULES.md`](RULES.md) (R1–R21). Every bug fix follows the same loop: **fix or add the rule → add eval rows citing the rule ID → change the code.**

- **~770 eval cases** across 25 versioned datasets in [`evals/`](evals): routing, safety boundaries, email parsing and relevance, ordinals ("import the second one"), time windows, drafts, memory, trips, and more.
- **Deterministic evals gate every push** (`npm run ci`): secrets check, migration validation, evals, unit tests, typecheck, build. Every safety and routing case must pass.
- **Live-model evals are incremental and cost-aware.** `npm run eval:cost` prints pending cases and a cost ceiling without calling anything. Only new or changed cases, or cases whose prompt version changed, are sent to the model.
- **Feedback loop.** Rating an answer "Bad" in the app becomes an eval candidate via `npm run feedback:export`.

## Tech stack

| Layer | Tools |
|---|---|
| App | Next.js, React, TypeScript |
| Models | Anthropic Claude (Haiku for routing and extraction, larger models for harder reasoning) |
| Data | Supabase (Postgres, 30+ migrations), Upstash Redis cache |
| Validation | Zod |
| Observability | Sentry, OpenTelemetry (`@vercel/otel`) |
| Testing | Vitest, Playwright + axe-core UI and accessibility checks |
| CI/CD | GitHub Actions quality gate, Vercel deploys, scheduled finance-sync jobs |

## Project layout

```
src/lib/orchestrator   routing pipeline, dispatch, multi-agent planning, safety
src/lib/agents         email, calendar, finance, bills agents + grounding checks
src/lib/tools          calendar, email, finance, weather, maps, stocks, sports
src/lib/memory         cross-chat memory extraction and store
src/lib/evals          eval runners (deterministic and live)
evals/                 versioned eval datasets
docs/                  design system, use cases, deploy, test plans
RULES.md               behavior spec cited by every eval row
```

## Local setup

1. Copy `.env.example` to `.env.local` and add provider credentials.
2. Run `npm run secrets:fill` to populate application-security values.
3. `npm install`
4. Apply the migrations in `supabase/migrations/` to your Supabase project.
5. `npm run dev`

Run the full gate locally with `npm run ci`.

## Status

Personal project, single user, actively developed. Built and maintained by [Bharath Vaddineni](https://www.linkedin.com/in/bharath-kumar-vaddineni/).
