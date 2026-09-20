# 04 · Public search and "out in the world" questions

Public search answers questions about things outside the person's own data: events, places, showtimes, facts. The hard parts are deciding **public versus personal**, knowing when a location is needed, and never sending private data to the search provider. Prefix `SR`.

Privacy rule: a search query may contain a place or an event name, never an email body, account number, or a person's private details.

## A. Events, showtimes, places

| ID | Someone might say | Reads as | Daylark should | Status |
| --- | --- | --- | --- | --- |
| SR-001 | what's playing at the movies saturday / movie times near me | web_search; topic=showtimes; date; place | Use the saved home area if there is one; otherwise ask "Which city or ZIP?" (once, then offer to save it) | ◐ |
| SR-002 | concerts this weekend / anything fun to do friday | events; date; place | Same; give sources | ◐ |
| SR-003 | is the warriors game on tonight / when does the game start | sports schedule | Public schedule with a source and time zone | ✅ |
| SR-004 | how long is dune 3 / runtime for that movie | fact about a public thing | Runtime with a source | ✅ |
| SR-005 | best pizza near me / good sushi in oakland | recommendation | Give a few options with sources; say it is not a personal recommendation | ✅ |
| SR-006 | is (place) open now / hours for costco | opening hours | Hours with the source and time; warn they can change | ? |
| SR-007 | how do i get to the airport / directions to x | directions | Driving time; cannot give live navigation | ◐ |
| SR-008 | weather tomorrow / will it rain saturday | weather | Public forecast for the place; state the place and time | ? |
| SR-009 | what's the news / what happened today in x | news | Sources and dates; say it is a snapshot | ? |
| SR-010 | who won the game / election result / stock price | current facts | Source and time; never guess | ? |

## B. General knowledge and how-to

| ID | Someone might say | Reads as | Daylark should | Status |
| --- | --- | --- | --- | --- |
| SR-020 | how many ounces in a cup / convert 5 miles to km | quick fact | Answer directly | ? |
| SR-021 | what's the capital of x | fact | Answer | ✅ |
| SR-022 | how do i file taxes / what's a 401k / how does escrow work | explainer | General explanation with a "not personal advice" line for finance, legal, medical | ◐ |
| SR-023 | recipe for x / how to fix a leaky faucet | how-to | Brief steps with sources if searched | ? |
| SR-024 | translate this to spanish | translation | Do it in chat | ? |
| SR-025 | write me a poem / help me write an essay | creative writing | Out of scope: redirect, never a bare refusal (`13`, RD-009, RD-015) | ✖ |
| SR-026 | is this medication safe with that / symptoms of x | medical | General information with a clear "ask a professional"; urgent language triggers the safety path | ◐ |

## C. Public versus personal (the router must not confuse them)

| ID | Someone might say | Correct reading | Why | Status |
| --- | --- | --- | --- | --- |
| SR-030 | what did amazon say about my order | **email** (personal) | "Amazon" here is the sender | ✅ |
| SR-031 | is amazon having a sale | **web** (public) | Same word, public question | ✅ |
| SR-032 | what's my flight number | **email** or **calendar** (personal) | "my" plus a personal record | ◐ |
| SR-033 | is flight ua 123 delayed | **web** (public) | A public flight status | ? |
| SR-034 | how much is a tesla | **web** (public) | Not "how much did I spend" | ✅ |
| SR-035 | how much did i spend on tesla | **finance** (personal) | Personal spending | ✅ |
| SR-036 | who is my landlord | **email/calendar** (personal) | Not a web query | ? |
| SR-037 | who is (celebrity) | **web** | Public | ✅ |
| SR-038 | meeting with apple next week | **calendar** | Apple is a meeting party here | ◐ |

## D. Location handling ("near me")

| ID | Someone might say | Daylark should | Status |
| --- | --- | --- | --- |
| SR-040 | near me / nearby / around here / close by | Use the saved home location; if none, ask for a city or ZIP and offer to save it. Use the device location only after a permission prompt (later) | ◐ |
| SR-041 | in san jose / by the airport / downtown | A place in the message beats the saved home | ✅ |
| SR-042 | near my office / near my mom's | Unknown place; ask, and offer to save it under a name | ✖ |
| SR-043 | open late / open now | Requires the current time and time zone | ? |
| SR-044 | a place that is halfway between me and sam | Two places; ask for the second, or say it is not supported | ✖ |

## E. Time-sensitive and unreliable answers

| ID | Situation | Daylark should | Status |
| --- | --- | --- | --- |
| SR-050 | Sources disagree | Say they disagree, cite two, and do not pick silently | ? |
| SR-051 | The search finds nothing | Say nothing was found and what was searched; never invent | ✅ |
| SR-052 | The question needs today's information and the search failed | Say the lookup failed and answer nothing that depends on it | ✅ |
| SR-053 | A source is an ad or a low-quality page | Prefer official sources; label the rest | ? |
| SR-054 | Age-restricted, illegal or dangerous request | Safety path (`08`) | ✅ |
