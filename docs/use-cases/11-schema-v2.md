# 11 · Intent schema: what we have, what breaks, what to change

## 1. What exists today

Three separate places decide meaning, each with its own shape:

| Layer | Where | Shape | Decides |
| --- | --- | --- | --- |
| Router (`router-v6`) | `src/lib/orchestrator/router.ts` | One flat record: `operation` (25 values), `agents`, `sender`, `matter`, `merchant`, `paidOn`, `term`, `lesson`, `confidence`, `clarification`, `reading` | Which handler runs |
| Email interpreter (`email-v8`) | `src/lib/agents/email-interpreter*.ts` | `EmailRequest`: `action`, `topic`, `sender`, `days`, `calendar`, `unread`, `humansOnly`, `exclusion` | What the email search means |
| Calendar and finance parsing | `agents/calendar.ts`, `agents/finance.ts`, `feasibility.ts` | **Rules and regexes** (`getCalendarWindow`, `extractLocation`, `preciseStart`, amount and date parsing) | Dates, places, amounts |

## 2. What the use cases show is wrong or missing

| # | Gap | Use cases it breaks | Why it matters |
| --- | --- | --- | --- |
| G1 | **Dates and places are parsed by rules**, which contradicts R20 and fails on "the friday after next", "after my meeting", "end of the month", "4/5". | CA-070…082, EM-044…051, IQ-060…067 | Wrong dates are silent, high-severity errors, and they precede writes |
| G2 | **One intent per message.** `multi` exists but carries no structure: no segments, order, or dependencies. | XD-001…052, IQ-040 | Cross-domain asks lose steps or run in the wrong order |
| G3 | **No confidence per slot.** One `confidence` number covers the whole reading, so a right operation with a wrong sender looks "confident". | EM-002, EM-006, FN-005 | The decision to act versus ask needs to be per slot |
| G4 | **No alternatives.** The model returns one reading; ambiguity is invisible unless it chooses to ask. | EM-004, EM-105, CV-024 | Two close readings should trigger a question, not a coin flip |
| G5 | **References are only partly modelled** (email ordinals). No structure for anaphora, ellipsis, refinement, widening, pagination, or drill-down on calendar, finance, or search results. | CV-001…025 | Follow-ups are where the assistant feels smart or broken |
| G6 | **Conversation state exists only for email** (`email_state_ciphertext`). | CV-007…011, CV-017, CV-018 | "And saturday?" after a calendar answer has nothing to resolve against |
| G7 | **No assumption record.** When Daylark defaults (30 days, afternoon = 12–5, 3 = 3 pm), nothing carries that forward or shows it. | EM-047, CA-036, CA-074 | Silent defaults become silent errors |
| G8 | **Refusals are one bucket** (`unsupported`, `email_write_declined`). The reason is not structured, so the "what I can do instead" offer cannot be precise. | FN-060…075, MS-020…029 | Bank questions need different offers than booking questions |
| G9 | **Risk is not a field.** Read, write and destructive are implied by the operation name. | CA-051, FN-050, MS-066 | A generic guard should read the field, not a list of names |
| G10 | **No evidence spans.** We cannot see which words justified a slot. | Debugging every wrong reading | Cannot improve what cannot be inspected |
| G11 | **Entities have no type or canonical form.** "Amazon" is a string, so retail versus AWS relies on wording. | EM-002, EM-006, SR-030…038 | Canonical entities (with alias source) make follow-ups and learning safe |
| G12 | **Output preference is buried** (`action`: list, amounts, facts). | EM-021, EM-070 | Format needs its own slot across domains |

## 3. Design goals

1. **Correct or asked.** Every reading either passes validation with high per-slot confidence, or becomes a clarifying question. There is no third path where a shaky reading proceeds.
2. **The model reads; code validates.** Code never decides what someone meant. Code checks that what the model returned is well-formed, possible, and safe.
3. **Structure over prose.** Everything a handler needs arrives as typed fields, never as text to be re-parsed.
4. **Inspectable.** Each field can be traced to words in the message (`evidence`), and each default is recorded (`assumptions`).
5. **Migratable.** The new frame can be projected to today's router output, so handlers move over one at a time.

## 4. Proposed shape (draft, to be reviewed and then frozen as `frame-v1`)

```ts
type TurnFrame = {
  version: "frame-v1";
  /** One entry per independent ask, in the order to run them. */
  segments: Segment[];
  /** Set when the whole turn needs a question first. */
  clarification: Clarification | null;
  /** Anything the model assumed that the user did not say. Shown in the answer. */
  assumptions: Assumption[];
  /** Overall reading in one plain sentence, for the answer's "I read this as…" line and for logs. */
  reading: string;
  /** Second-best reading when it is close; empty when the top reading is clear. */
  alternatives: AlternativeReading[];
  overall: number; // 0..1, calibrated
};

type Segment = {
  id: string;
  dependsOn: string[];               // other segment ids whose result this one needs
  domain: "email" | "calendar" | "finance" | "bills" | "web" | "memory" | "conversation" | "meta" | "refusal" | "safety";
  operation: Operation;              // see §5
  risk: "read" | "write" | "destructive"; // written by the model, re-derived and enforced in code from the operation table
  slots: Slots;                      // discriminated by `operation`
  time: TimeSpec | null;
  refs: Reference[];
  entities: Entity[];
  output: "list" | "count" | "amounts" | "facts" | "summary" | "table" | "single";
  confidence: Record<string, number>; // per slot name, plus "operation"
  evidence: Record<string, string>;   // slot name -> the words in the message it came from
};

type TimeSpec = {
  kind: "instant" | "range" | "recurring" | "relative_to_event";
  start?: string;                    // ISO 8601 with offset
  end?: string;
  granularity: "minute" | "hour" | "day" | "week" | "month" | "year" | "part_of_day";
  timezone: string;                  // IANA, the user's unless the message says otherwise
  source: "explicit" | "resolved" | "defaulted";
  phrase: string;                    // exactly what the user said
  recurrence?: { freq: "daily" | "weekly" | "monthly" | "yearly"; interval: number; byDay?: string[]; until?: string };
  anchorEventId?: string;            // for "after my meeting"
  ambiguous?: { readings: string[] };// e.g. 4/5 as two dates: forces a question
};

type Reference = {
  type: "ordinal" | "anaphora" | "ellipsis" | "correction" | "refinement" | "widening" | "pagination" | "drilldown" | "explanation" | "action_on_result" | "repetition" | "meta";
  target: { kind: "results" | "last_request" | "approval" | "entity" | "conversation"; list?: "email" | "calendar" | "finance" | "bills" | "web"; positions?: number[]; id?: string };
  resolved: boolean;
  candidates?: string[];             // when unresolved and several fit
};

type Entity = {
  type: "person" | "company" | "merchant" | "category" | "bank" | "location" | "event" | "amount" | "date" | "topic";
  text: string;                      // as written
  canonical?: string;                // "Amazon Web Services"
  variantOf?: string;                // "Amazon"; retail vs web services are distinct canonicals
  source: "message" | "context" | "learned_alias";
};

type Clarification = { question: string; options?: string[]; slot: string; whyNeeded: string };
type Assumption = { slot: string; value: string; reason: string; // e.g. window=30 days (default)
                    userVisible: true };
```

### Slots per operation (each is its own small type)

Every operation has an exact slot type, so an invalid combination cannot be expressed. Examples:

```ts
type EmailSearchSlots  = { sender?: EntityRef; topic?: Topic; unread?: boolean; humansOnly?: boolean; hasAttachment?: boolean;
                           exclude?: EntityRef[]; amountFilter?: { op: ">"|"<"|"between"; min?: number; max?: number; currency?: string } };
type CalendarCreateSlots = { title: string; where?: string; attendees?: EntityRef[]; allDay?: boolean; reminderMinutes?: number };
type FinanceQuerySlots = { category?: Category; merchant?: EntityRef; compareTo?: TimeSpec; metric: "total"|"average"|"count"|"top"|"breakdown" };
type FinanceRecordSlots = { amount: { minor: number; currency: string }; merchant: EntityRef; category?: Category; note?: string; direction: "expense"|"income"|"refund" };
type RefusalSlots = { reason: "email_write"|"payments"|"bank_data"|"reminders"|"booking"|"messaging"|"other_account"|"other"; offer: string };
```

## 5. Operation set (replaces the flat 25)

| Domain | Operations |
| --- | --- |
| email | `email.search`, `email.count`, `email.read`, `email.facts`, `email.import`, `email.status_lookup` |
| calendar | `calendar.view`, `calendar.find_free`, `calendar.create`, `calendar.update`, `calendar.delete`, `calendar.attendees`, `calendar.feasibility` |
| finance | `finance.query`, `finance.record`, `finance.import` |
| bills | `bills.list`, `bills.mark_paid`, `bills.autopay` |
| web | `web.search` |
| memory | `memory.teach`, `memory.show`, `memory.forget`, `memory.forget_all` |
| conversation | `convo.approve`, `convo.deny`, `convo.edit_pending`, `convo.repeat`, `convo.explain`, `convo.undo`, `convo.never_mind`, `convo.more` |
| meta | `meta.greeting`, `meta.thanks`, `meta.capabilities`, `meta.about`, `meta.data_privacy` |
| refusal | `refuse.unsupported` (with `reason`), `refuse.unsafe` |
| safety | `safety.crisis`, `safety.emergency` |
| clarify | `clarify` (only when no segment can proceed) |

`risk` is looked up from this table in code and **compared** with what the model wrote. A mismatch is an error, never resolved in favour of the model.

## 6. The pipeline (quality over speed)

```
message + state
   │
   ▼
1  FRAME       model call, structured output (frame-v1), today's date and time zone, conversation state,
   │            learned aliases, saved places. Few, representative examples.
   ▼
2  VALIDATE    code: zod schema; operation-slot fit; dates real and ordered; amounts positive;
   │            ordinal within the list; risk equals the table; entities canonical or flagged
   │            failure → one repair attempt with the error text, then abstain
   ▼
3  VERIFY      second model call, different prompt, sees message + frame (not the first reasoning):
   │            "Does this frame correctly capture what the person asked? List any mismatch."
   │            for: every write, every low-confidence slot, every multi-segment turn (and a sampled share of the rest)
   ▼
4  CONSENSUS   only when 3 disagrees or `overall` < threshold: 2 more independent frames; majority per slot;
   │            any disagreement on a slot that changes the result → clarify
   ▼
5  GATE        code: ABSTAIN if any slot the operation needs is below its threshold; ASK if alternatives are close;
   │            require approval for write/destructive; never skip
   ▼
6  EXECUTE     handlers receive typed slots only; handlers never see raw text for meaning
   ▼
7  ANSWER      includes "how I read this" (reading + assumptions) whenever a default or an assumption was used
```

Every step's outputs are logged (without message text in error tracking) so failures can be traced to a step.

### Where each step earns its cost

| Step | Catches | Cost |
| --- | --- | --- |
| Validate | Impossible dates, wrong slot shapes, out-of-range ordinals | None (code) |
| Verify | Confident-but-wrong readings (wrong sender, wrong person, wrong date) | One extra model call |
| Consensus | Genuinely borderline readings | Two more calls, only when triggered |
| Abstain/ask | Everything that remains uncertain | A question to the user (which we accept) |

## 7. Conversation state (generalising `email_state_ciphertext`)

```ts
type ConversationState = {
  updatedAt: number;
  lastSegment: Segment | null;               // the last executed segment, full frame
  lists: { email?: ListState; calendar?: ListState; finance?: ListState; bills?: ListState; web?: ListState };
  pendingApproval: { id: string; kind: string; card: unknown; expiresAt: number } | null;
  lastAssumptions: Assumption[];
  recentEntities: Entity[];                  // most recent first, for anaphora
  clarificationAsked: { slot: string; question: string } | null;
};
type ListState = { items: Array<{ id: string; label: string; position: number }>; page: number; total: number; producedBy: string };
```

Stored encrypted, one row per conversation (`conversation_state_ciphertext`), with an expiry after which references are asked, not resolved.

## 8. Database implications

| Change | Why |
| --- | --- |
| `conversation_state_ciphertext` (generalises email state) | Follow-ups on every domain (G6) |
| `saved_places` (kind: home, work, named; encrypted) replacing the single `home_location` lesson | "near my office", "from mom's" (SR-042) |
| `interpretation_log` (opt-in; frame hash, operation, validation result, step outcomes; **no message text by default**) | Measuring quality in real use without keeping private text |
| `feedback` already exists; add `frame_hash` so a bad rating points to the reading that produced it | Turning ratings into eval cases |
| `entity_aliases` (canonical, alias, source, user-confirmed) folded from `sender_alias` and `merchant_alias` lessons | One canonical-entity model for email, finance and calendar |

## 9. Migration plan

1. **Freeze `frame-v1`** after review of this document and the use-case tables.
2. **Adapter**: `frameToRouterDecision(frame)` produces today's `RouterDecision` so all handlers keep working.
3. **Calendar first**: replace the rule-based date and place parsing with the model's `TimeSpec` plus code validation (largest current gap, G1).
4. **Shadow mode**: run frame-v1 next to router-v6 on the eval sets and log disagreements. Needs Anthropic credits and an approved cost quote (R21).
5. **Cut over one domain at a time** (calendar → finance → email → the rest). Each cutover passes the eval gates in `12-quality-and-measurement.md`.
6. Retire router-v6 and the rule-based paths once every domain has cut over.

## 10. Open questions for the owner

1. Is a per-request latency of several seconds acceptable (frame + verify, sometimes consensus)? The design assumes yes, per your instruction.
2. Do we store an opt-in interpretation log for measurement, and with what retention?
3. Which languages must be first-class at launch (see `09`)?
4. Should clarifying questions offer clickable choices in the UI (a small UI addition), or stay as plain text?
