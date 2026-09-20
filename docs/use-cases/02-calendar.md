# 02 · Calendar

The hard parts: turning fuzzy time language into exact times, knowing which event a person means, and never changing anything without approval. Prefix `CA`.

Dates are resolved from **today's date and the user's time zone**. Anything assumed (a default length, a time of day) is stated in the answer or the approval card.

## A. Viewing

| ID | Someone might say | Reads as | Daylark should | Status |
| --- | --- | --- | --- | --- |
| CA-001 | what's on today / my day / what do I have going on / agenda | calendar_query; window=today | Events in order, with times; say "nothing scheduled" if empty | ✅ |
| CA-002 | tomorrow / tmrw / the day after | window=that day | Same | ✅ |
| CA-003 | this week / next week / rest of the week | window=week | Group by day; state the dates | ✅ |
| CA-004 | what's my schedule like on friday / on the 14th / next tuesday | window=named day | Resolve to a date and state it ("Friday, Sep 25") | ✅ |
| CA-005 | this weekend / next weekend / over the long weekend | window=Sat+Sun (or holiday) | State the dates used | ◐ |
| CA-006 | when's my next meeting / what's next | next event from now | One event with time and place | ✅ |
| CA-007 | when's my next meeting with priya / do I meet john this week | search by attendee | Filter by attendee name; if several people match, ask | ? |
| CA-008 | when is the dentist / what time is my flight | search by title keyword | Find by keyword; if several, list them | ? |
| CA-009 | how many meetings do I have today / how busy am I | count / load | Count and total hours | ◐ |
| CA-010 | what did I do last tuesday / what was on my calendar yesterday | past window | Past events are allowed | ? |
| CA-011 | am I double booked / any conflicts this week | conflict scan | List overlapping events | ? |
| CA-012 | what's on my birthday / any holidays this month | holidays calendar | Only if a holiday calendar is connected; otherwise say so | ? |

## B. Free time

| ID | Someone might say | Reads as | Daylark should | Status |
| --- | --- | --- | --- | --- |
| CA-020 | am I free at 3 / free tomorrow afternoon / anything after lunch | free/busy at a time or part of day | Yes/no plus the neighbouring events; define "afternoon" (12–5) in the answer | ◐ |
| CA-021 | when am I free this week for a 30 minute call | find a slot; duration=30 | Up to three slots inside working hours; say the hours assumed | ? |
| CA-022 | find a time for a long lunch friday | slot with a soft duration | Ask "how long is a long lunch?" or offer 90 minutes and say so | ? |
| CA-023 | do I have a two hour window before my 6pm | window before an event | The gap before that event | ✅ |
| CA-024 | when's my next free day | day with no events | First empty day | ? |
| CA-025 | any time to go to the gym today | slot; activity=gym | Slots today; duration from the learned default if any | ? |

## C. Creating an event (always needs approval)

| ID | Someone might say | Reads as | Daylark should | Status |
| --- | --- | --- | --- | --- |
| CA-030 | add dentist tomorrow at 3 / put lunch with sam on friday at noon / book a slot for gym at 6 | calendar_create; title, date, time | Show a card: title, date, time, length, place; ask approval | ✅ |
| CA-031 | schedule a meeting with mark next tuesday 2-3pm | create with attendee and end time | Include the attendee; ask approval; never send extra invitations silently | ✅ |
| CA-032 | block off friday afternoon / hold thursday morning | all-part-day block | Confirm the exact hours assumed (e.g. 12:00–17:00) | ◐ |
| CA-033 | remind me to call mom at 5 | reminder, not an event | Reminders are not supported; offer a calendar event instead | ✖ |
| CA-034 | every monday at 9 standup / weekly on thursdays / first friday of the month | recurring | Recurring events: state the rule; if unsupported say so, do not create a single one silently | ? |
| CA-035 | dinner at 7 (no date) | date missing | If the conversation gives a date use it; otherwise ask "which day?" | ✅ |
| CA-036 | meeting at 3 (am or pm?) | ambiguous meridiem | **Decided (R22): ask** "3 AM or 3 PM?" unless the wording or context makes only one reading plausible (a dinner at 7, a call at 8 am was already said). The model judges that; no rule | ? |
| CA-037 | lunch with anna sometime next week | fuzzy date | Ask which day; offer free lunchtime slots | ? |
| CA-038 | add it / put that on my calendar (after a search result) | create from a referenced item | Use the event details from the previous answer; ask approval | ◐ |
| CA-039 | movie at 7 in oakland | title + time + location | Location included; travel time may be offered | ◐ |
| CA-040 | call with the tokyo office at 9am their time | other time zone | Convert and show both times; ask approval | ? |
| CA-041 | all day event on the 20th / out of office next week | all-day / multi-day | Use all-day; state the dates | ? |
| CA-042 | make it 45 minutes / actually make it an hour (during the approval) | change the pending card | Update the card, do not create yet | ✅ |
| CA-043 | create 5 events for the week | multiple creates | Show all five for one approval, cap stated | ? |
| CA-044 | add a meeting on a date in the past | past date | Confirm it is intended | ? |

## D. Changing and deleting (always needs approval)

| ID | Someone might say | Reads as | Daylark should | Status |
| --- | --- | --- | --- | --- |
| CA-050 | cancel my dentist / delete the 3pm / remove tomorrow's lunch | calendar_delete | Show which event, ask approval; if several match, list and ask | ✅ |
| CA-051 | cancel everything on friday | delete many | Show every event to be removed; require an explicit approval; never delete silently | ? |
| CA-052 | move lunch to 1 / push my 3pm to 4 / reschedule the dentist to next week | update time | Show old and new times; ask approval | ? |
| CA-053 | add priya to the meeting / invite sam to lunch | calendar_attendees add | Show attendees before and after; ask approval | ✅ |
| CA-054 | remove aass@abc.com and add bharath@example.com | replace attendee | Show both changes in one card | ✅ |
| CA-055 | rename the meeting / change the location | update fields | Show the change; ask approval | ? |
| CA-056 | delete the meeting (two meetings match) | ambiguous target | List the candidates with times; ask which | ✅ |
| CA-057 | undo that (after a created event) | undo a write | Offer to delete the event just created, with approval; never claim it is undone without doing it | ? |

## E. Will it fit? (feasibility)

| ID | Someone might say | Reads as | Daylark should | Status |
| --- | --- | --- | --- | --- |
| CA-060 | can I catch a movie saturday afternoon and be back before my meeting | schedule_feasibility | Find showtimes and duration, add drive time from home, compare with the next event | ✅ |
| CA-061 | do I have time for a 45 minute workout before my 6pm dinner with sarah | fit an activity before an event | Yes/no with the numbers | ✅ |
| CA-062 | can I make it to the 7:30 show if my meeting ends at 6 | fit with a stated end | Use the stated end time | ◐ |
| CA-063 | how long to get to the airport | travel time, place from the calendar or home | Use the flight or the saved home; ask if there is neither | ◐ |
| CA-064 | should I leave now for my 3pm | leave-by time | Drive time from the current or home location to the event place | ✖ |
| CA-065 | can I fit a haircut and groceries today | two activities | Ask durations; offer the free gaps | ? |
| CA-066 | I have a meeting at 2, will lunch at that place take too long | activity + place | Use the place's typical duration and drive time | ? |

## F. Awkward date language (must resolve exactly or ask)

| ID | Someone might say | Daylark should | Status |
| --- | --- | --- | --- |
| CA-070 | next friday (said on a Wednesday) / this friday / friday | "This Friday" is the coming one; "next Friday" is the one after only if the phrase is used that way; state the date; ask if the person says it is wrong | ? |
| CA-071 | the friday after next / two weeks from tuesday | Resolve exactly and state the date | ? |
| CA-072 | end of the month / first of next month / the 3rd | Resolve; a past day-of-month means next month | ? |
| CA-073 | tonight / this evening / late tonight / after work | Define the hours used | ? |
| CA-074 | morning / afternoon / evening / night | Define: 8–12, 12–5, 5–9, after 9 | ◐ |
| CA-075 | in an hour / in 30 mins / a week from now | Relative to now | ? |
| CA-076 | mon / tues / thurs / sat | Abbreviations | ✅ |
| CA-077 | 4/5 (April 5 or May 4?) | Day/month order follows the user's locale; if it could be either and both are future, ask | ? |
| CA-078 | 5/22 or 22/5 | Unambiguous by value | ? |
| CA-079 | midnight / noon / 12 (am or pm) | Midnight is the start of the next day; ask for "12" | ? |
| CA-080 | daylight saving weekend, another time zone | Convert carefully; show the zone | ? |
| CA-081 | memorial day weekend / labor day / thanksgiving week / xmas | Holiday resolution for the user's country | ? |
| CA-082 | after my meeting / before lunch / when I'm back from the dentist | Anchor to another event | Resolve from the calendar; ask if not found | ? |

## G. Things a calendar cannot know

| ID | Someone might say | Daylark should | Status |
| --- | --- | --- | --- |
| CA-090 | is sam free tomorrow | Cannot read other people's calendars; offer to propose a time | ✖ |
| CA-091 | accept the invite from priya / decline that meeting | Not supported; can describe the invite | ✖ |
| CA-092 | find a conference room | Not supported | ✖ |
| CA-093 | set an alarm / timer | Not supported | ✖ |
| CA-094 | why is my calendar empty | Check the connection status; if connected, say the calendar has no events in that window | ✅ |
