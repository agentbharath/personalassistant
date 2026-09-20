# 10 · Everyday-word glossary

How ordinary people say things, mapped to the concept Daylark should read. This is **not** a lookup table for code (rules must not judge meaning, R20). It is material for prompt examples, for the eval sets, and for reviewing whether the model's reading is sensible. Prefix `GL`.

## Mail

| Concept | People say | Careful with |
| --- | --- | --- |
| An email | email, mail, message, note, "a thing from x", "what x sent", ping, "hit me up" | "message" may also mean texts; only Gmail is available |
| Inbox / all mail | inbox, mailbox, my mail, my emails, "what's come in" | Not folders or spam unless named |
| Received recently | new, latest, recent, fresh, "came in", "landed", "just now", "this morning" | "Recent" = the default window (30 days) unless "today" |
| Not read | unread, new, "haven't opened", "unopened", "missed" | "New" can mean unread or recent; prefer unread when the context is inbox triage |
| From a sender | from, sent by, "by x", "did x write", "x's email", "anything from x", "heard from x" | "Amazon" (retail) vs "Amazon Web Services"; "Uber" vs "Uber Eats"; "Apple" (the company) vs an Apple receipt |
| A proof of purchase | receipt, purchase confirmation, proof of purchase, "what i bought", invoice, "order email", "the charge email" | An order or shipping notice is not a receipt unless it shows a charge |
| A bill | bill, statement, invoice, amount due, "what i owe", "the electric", "the water thing" | A statement (balance) vs a bill (amount due) vs an invoice |
| A shipping notice | tracking, "where's my package", shipped, delivered, "on its way", out for delivery | Never a receipt |
| A booking | reservation, booking, confirmation, itinerary, e-ticket, boarding pass, "my trip" | Read-only |
| Security mail | verification code, OTP, 2FA, password reset, sign-in alert, "login thing" | Never surface codes or links |
| Marketing | promo, deal, sale, coupon, newsletter, "junk", "spammy stuff", "ads" | Not spam in the mailbox sense |
| Job mail | recruiter, job alert, linkedin, "hiring", "opportunity", "interview" | |
| A refund | refund, "money back", credit, reimbursement, return label | Do not claim the money arrived |
| Attachment | attachment, "the pdf", "the file", "the doc", "the photo" | Only readable receipts are extracted |

## Money and banks

| Concept | People say | Careful with |
| --- | --- | --- |
| Money spent | spent, paid, bought, "put down", "dropped", "shelled out", "cost me", charge, "hit my card" | "Charge" is not necessarily a purchase Daylark can see |
| Total | total, sum, all together, "how much overall", "damage", "tab", "running total" | State the window and record count |
| Category | food, eating out, dining, restaurants → restaurants; groceries, supermarket, "food shopping" → groceries; gas, uber, transit, parking → transport | "Food" is ambiguous (restaurants or groceries): state the mapping or show both |
| Subscriptions | subscriptions, recurring, "monthly stuff", auto-renew, memberships | There is no subscription list; derive it from records |
| A bill I owe | bill, "what i owe", due, unpaid, outstanding, pending, past due, overdue | Not spending until paid |
| Payment | paid, settled, "took care of", "sent it", done | "Sent it" (an email) is not payment |
| Autopay | autopay, automatic, "they pull it", "auto-debit", "direct debit", standing order | |
| Bank | bank, "my bank", chase, wells, bofa, "the credit union", citi, capital one, amex, discover | No bank is connected; emails only |
| Account | account, checking, savings, card, debit, credit, visa, mastercard, amex | Cards and accounts are not modelled |
| Balance | balance, "how much do i have", "money left", "am i good", "am i broke" | Not visible |
| Deposit | deposit, paycheck, "got paid", direct deposit, salary, refund landed | Not visible; can search payroll emails |
| Transfer | transfer, send money, zelle, venmo, cash app, paypal, wire, ach | Not supported |
| Fees | fee, overdraft, "atm fee", interest, apr, penalty, late fee | Only from emails or records |
| Dispute | dispute, chargeback, "wrong charge", fraud claim, "i didn't make this" | Status from emails only |
| Statement | statement, "monthly statement", "e-statement", "the pdf from the bank" | Read the email, not the PDF |
| Refund | refund, "money back", credit, return | Income or negative expense; ask |

## Calendar

| Concept | People say | Careful with |
| --- | --- | --- |
| An event | meeting, appointment, call, catch-up, sync, 1:1, standup, event, thing, "my 3pm", "the dentist", session, block, hold | "Hold" and "block" mean a placeholder |
| The calendar | calendar, schedule, agenda, "my day", "what's on", "what do i have", "plans", "booked", "diary" | |
| Free | free, open, available, "got time", "clear", "nothing on", "gap", "window", "slot" | Working hours assumed and stated |
| Busy | busy, booked, slammed, swamped, "full", "packed" | |
| Create | add, put, schedule, book (a slot), set up, block off, "pencil in", "mark", "hold" | "Book" with a business (a table, a flight) is not supported |
| Change | move, push, reschedule, shift, bump, "change to", "make it", postpone | |
| Remove | cancel, delete, remove, drop, "get rid of", scrap, clear | Cancelling a meeting is not telling attendees it is cancelled |
| Invite | invite, add (person), include, "bring in", "cc" | Attendee changes send invitations; say so |
| Recurring | every, weekly, daily, monthly, "each monday", "first friday" | |
| Part of day | morning, afternoon, evening, night, "after lunch", "before work", "after work", "lunchtime", "end of day" | Define the hours used |
| Relative day | today, tonight, tomorrow, "the day after", "next friday", "this weekend", "in two weeks", "end of the month" | State the exact date |

## Search

| Concept | People say | Careful with |
| --- | --- | --- |
| Look up | search, look up, find, google, "check", "what's", "is there", "who's", "how do i" | Public versus personal (`04`) |
| Nearby | near me, nearby, close, "around here", "in my area", walking distance, "on the way" | Needs a place |
| Events | what's on, what's happening, things to do, showtimes, tickets, "is x playing" | Public only; cannot buy |
| Places | restaurant, cafe, place to eat, spot, "somewhere for", bar, gym, store, pharmacy | Hours can change |
| Recommend | best, top, good, "worth it", recommended, "should i" | Say sources; not a personal recommendation |

## Actions and approvals

| Concept | People say |
| --- | --- |
| Yes | yes, yep, yeah, sure, ok, okay, do it, go ahead, confirm, sounds good, please do, 👍, "that works" |
| No | no, nope, nah, cancel, stop, don't, never mind, scrap that, forget it, "not yet", 👎 |
| Wait | wait, hold on, one sec, not yet, "let me think" |
| Change | "make it…", "actually…", "instead…", "but…", "change that to…" |
| Undo | undo, "take that back", "revert", "that was a mistake" |
