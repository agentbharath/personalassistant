# 05 · Requests that need more than one agent

The router must recognise that one message contains several needs, run them in a sensible order, pass results between steps, and say clearly when one step succeeded and another did not. Prefix `XD`.

Rule of thumb: **a later step may use an earlier step's result** (find the email, then check the calendar for that date). Steps that only read can run together. Any step that writes waits for approval, and approval covers exactly what was shown.

## A. Read + read

| ID | Someone might say | Steps | Daylark should | Status |
| --- | --- | --- | --- | --- |
| XD-001 | find the restaurant mark recommended last week and check if friday evening is free | 1 email (sender Mark, topic recommendation, 7 days) → extract restaurant; 2 calendar (Friday evening) | Answer both; if the restaurant is not found, still answer the calendar part and say what was not found | ◐ |
| XD-002 | what's my week look like and what bills do i owe | calendar week + bills | Two clear sections | ✅ |
| XD-003 | did i pay the pg&e bill and when is it due | bills + email (payment) | If the record and the email disagree, say so | ◐ |
| XD-004 | show my amazon receipts and how much did i spend there | email list + finance total | Note if email receipts and saved records differ (imports not yet done) | ◐ |
| XD-005 | when's my flight and what's the weather there | email/calendar → place, then web | Uses the destination from the first step | ? |
| XD-006 | anything from the dentist and when's my appointment | email + calendar | Two answers | ? |
| XD-007 | can i afford a $300 dinner this month | finance judgement | Show this month's spending; refuse to decide; no budget feature | ◐ |
| XD-008 | am i free saturday afternoon for a movie and what's playing | calendar + web | Free time first, then films inside it | ✅ |
| XD-009 | summarise my day: calendar, unread mail from people, anything due | calendar + email + bills | A short briefing; each part labelled; parts that failed are said to have failed | ? |

## B. Read then write

| ID | Someone might say | Steps | Daylark should | Status |
| --- | --- | --- | --- | --- |
| XD-020 | add my amazon order to my expenses | email (find) → finance_record | Preview the matched email, then ask approval; never import shipped mail | ✅ |
| XD-021 | put my dentist appointment from the email on my calendar | email (find) → calendar_create | Show the event parsed from the email; ask approval | ◐ |
| XD-022 | book the movie at 7 and add it to my calendar | web (find) → calendar_create | Cannot book; can add the event, and says so | ◐ |
| XD-023 | i paid the electric bill, log it and mark the bill done | bills_paid (one write) | One approval | ✅ |
| XD-024 | block friday afternoon and tell me what i'm cancelling | calendar (find conflicts) → create | List conflicts first; do not delete them; ask approval only for the block | ? |
| XD-025 | reschedule everything on friday to monday | calendar update × many | Show every move; explicit approval; cap stated | ? |

## C. Independent asks in one message

| ID | Someone might say | Daylark should | Status |
| --- | --- | --- | --- |
| XD-030 | what's on today and did amazon email me | Answer both, in the order asked | ✅ |
| XD-031 | how much did i spend on food and remind me to call mom | Answer the first; decline the reminder with an alternative | ◐ |
| XD-032 | show my receipts, delete the promos | Answer the first, decline the second | ✅ |
| XD-033 | three questions with numbering ("1. … 2. … 3. …") | Answer each under its number; if one fails, the others still answer | ? |

## D. Partial failure (must be said out loud)

| ID | Situation | Daylark should | Status |
| --- | --- | --- | --- |
| XD-040 | Email works, calendar connection needs fixing | Return the email part, then "I couldn't reach your calendar; fix it in Settings" | ✅ |
| XD-041 | The model budget is used up | Say what still works without the model (bills, totals) and what is paused | ✅ |
| XD-042 | One step is ambiguous and the other is clear | Answer the clear step, ask about the other | ? |
| XD-043 | A write step fails after approval | Say it failed and nothing changed; never say it worked | ✅ |

## E. Conflicts between sources

| ID | Situation | Daylark should |
| --- | --- | --- |
| XD-050 | The email says the appointment is at 3, the calendar says 4 | Show both, say which is newer, and do not silently pick |
| XD-051 | A receipt email amount differs from a saved record | Show both; do not overwrite |
| XD-052 | Two bills for one merchant | List both; ask which when marking paid |
