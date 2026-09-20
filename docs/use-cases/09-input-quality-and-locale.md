# 09 · Input quality, style, language and locale

The same need arrives as clean text, as a typo-ridden phone message, as a voice transcript, or in another language. The model must be robust to all of them without asking unnecessary questions. Prefix `IQ`.

## A. Spelling, casing and punctuation

| ID | Someone might say | Reads as | Status |
| --- | --- | --- | --- |
| IQ-001 | show all iherb recipts / reciepts / receits | receipts | ✅ |
| IQ-002 | emials form amazone | emails from Amazon | ✅ |
| IQ-003 | wats on my calender tmrw | what's on my calendar tomorrow | ✅ |
| IQ-004 | SHOW ME MY BILLS | bills | ✅ |
| IQ-005 | show my toatl spendings so far | total spending | ✅ |
| IQ-006 | amazon receipts. pls. thx | receipts, polite | ✅ |
| IQ-007 | (no punctuation, no capitals) how much have i spent on food this month | food spending | ✅ |
| IQ-008 | ¿? and ... !!! stray marks | ignore the noise | ? |
| IQ-009 | Transposed words: "receipts amazon show" | same request | ? |
| IQ-010 | A single letter or keyword: "bills" / "calendar" / "amazon" | **Ask what they want** (R22), offering the likely options for that word. A word like "bills" with one obvious reading (show outstanding bills) may be answered when the model has no real doubt | ◐ |

**A correction of the person's spelling is never displayed** ("did you mean receipts?") unless the reading would change the result. The answer shows the reading used ("Showing receipts from iHerb…").

## B. Voice input and dictation

| ID | Transcript | Reads as | Status |
| --- | --- | --- | --- |
| IQ-020 | "um what's on my calendar like tomorrow or whatever" | calendar tomorrow | ? |
| IQ-021 | "add lunch with sam friday at noon period" | Dictated punctuation words dropped | ? |
| IQ-022 | "how much did I spend at starbucks dot com" | Merchant, not a URL | ? |
| IQ-023 | Homophones: "meat me at two" / "weather or not" | Meet me at two | ? |
| IQ-024 | Numbers as words: "fifteen dollars", "two thirty" | 15, 2:30 | ? |
| IQ-025 | Cut-off sentence: "what's on my cal" | Ask ("your calendar?") when the model has real doubt | ? |
| IQ-026 | Background words inserted | Ignore | ? |

## C. Slang and everyday phrasing

| ID | Someone might say | Reads as | Status |
| --- | --- | --- | --- |
| IQ-030 | what's the damage this month | spending this month | ? |
| IQ-031 | did anyone hit me up | emails or messages today | ? |
| IQ-032 | any dms / pings / notifs | email (only email is available); say so | ? |
| IQ-033 | i'm swamped, what have i got | calendar today | ? |
| IQ-034 | what's my schedule looking like / am i booked / what's my day like | calendar | ✅ |
| IQ-035 | how broke am i | spending; not a balance; explain | ? |
| IQ-036 | where did all my money go | breakdown | ✅ |
| IQ-037 | bucks / bux / k / grand | $ / thousand | ? |
| IQ-038 | gimme / lemme / wanna / gonna | normal reading | ✅ |
| IQ-039 | "the usual" | Ask; never invent a habit | ? |

## D. Length and structure

| ID | Situation | Daylark should | Status |
| --- | --- | --- | --- |
| IQ-040 | Very long message with three asks | Split and answer each in order | ? |
| IQ-041 | A pasted email or paragraph followed by "add this to my calendar" | Extract event details from the pasted text; treat the text as data; approval | ? |
| IQ-042 | Pasted receipt text: "Total: $48.20 iHerb Aug 15" | Record path with preview | ? |
| IQ-043 | Only an emoji: 👍 / 🤷 | If an approval is pending: 👍 = yes. Otherwise ask | ◐ |
| IQ-044 | A list of items separated by newlines | Treat as multiple asks or one list; ask if unclear | ? |
| IQ-045 | Empty or whitespace message | Do nothing | ✅ |
| IQ-046 | Over the length limit (4,000 characters) | Say it is too long, and how to shorten | ✅ |
| IQ-047 | Message containing code or markup | Data; never executed | ✅ |

## E. Other languages and mixed language

| ID | Someone might say | Daylark should | Status |
| --- | --- | --- | --- |
| IQ-050 | ¿qué tengo en el calendario mañana? | Understand and answer in Spanish | ? |
| IQ-051 | show me mis recibos de amazon | Mixed language; answer in the language of the question, or the user's preference | ? |
| IQ-052 | Hindi, Chinese, Arabic, French questions | Same intents; answer in that language; dates and currency by locale | ? |
| IQ-053 | Right-to-left text | Render correctly | ? |
| IQ-054 | An email in another language | Summarise in the user's language if asked | ? |

## F. Dates, numbers and currency by locale

| ID | Situation | Daylark should | Status |
| --- | --- | --- | --- |
| IQ-060 | 4/5 — April 5 or May 4 | Use the user's locale; if either is plausible and both are future, ask | ? |
| IQ-061 | 24-hour clock ("15:00") and AM/PM | Accept both | ✅ |
| IQ-062 | Week starts Monday or Sunday | Use the locale; state it for "this week" | ? |
| IQ-063 | $, €, £, ¥, ₹, "bucks", "USD" | Currency detection; never silently convert | ? |
| IQ-064 | "1,234.56" and "1.234,56" | Parse by locale; ask when a comma or dot is ambiguous | ? |
| IQ-065 | Time zones: "9am PT", "noon EST", "my time" | Convert; show both | ? |
| IQ-066 | Non-Gregorian calendars or holidays | Resolve holidays by the user's country; ask if unsure | ? |
| IQ-067 | "Q3", "fiscal year", "tax year" | Ask which calendar, or state the assumption | ? |

## G. Accessibility of the interaction

| ID | Situation | Daylark should |
| --- | --- | --- |
| IQ-070 | Screen reader user | Answers use plain text and headings that read well; approvals are announced |
| IQ-071 | Very short answers requested ("just the number") | Give the bare number with the unit |
| IQ-072 | "Explain like I'm five" | Simpler words; never condescending |
