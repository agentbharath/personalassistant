# 03 · Money, spending and banking language

Daylark is **not connected to any bank or card account.** It knows only what the person typed, imported from an email or receipt, or approved. Everyday bank language ("what hit my card", "my balance", "the Chase thing") is therefore the biggest source of wrong answers: people assume Daylark can see their bank. The correct behaviour is to say what it can and cannot see, and to offer the nearest useful thing (usually bank **emails**). Prefix `FN`.

Rules that apply throughout: a **bill is not spending until it is paid** (R17); shipped mail is not a receipt (R4); bulk imports process candidates within the request budget and explicitly disclose incomplete scans; saving anything needs approval; money is shown with the currency; totals state which records they cover.

## A. Spending questions

| ID | Someone might say | Reads as | Daylark should | Status |
| --- | --- | --- | --- | --- |
| FN-001 | how much have i spent / what have i spent so far / total spending / where's my money going | finance_spending; window default | Total over the stated window, from saved records; say how many records and the date range | ✅ |
| FN-002 | how much did i spend on food / eating out / dining / restaurants | spending by category=restaurants | Map everyday words to the category; state the category used | ✅ |
| FN-003 | groceries / supermarket / costco run / trader joe's | category=groceries | Same | ✅ |
| FN-004 | gas / uber / lyft / parking / transit / commute | category=transport | Same | ✅ |
| FN-005 | how much on amazon / at starbucks / on iherb | spending by merchant | Total for that merchant; include aliases (amzn = Amazon) | ✅ |
| FN-006 | spending by category / breakdown / what am i spending on | category breakdown | Table with totals and shares | ✅ |
| FN-007 | this month vs last month / am i spending more than before | comparison | Two windows side by side; say the windows | ◐ |
| FN-008 | biggest purchase / most expensive thing / top 5 expenses | ranking | Top N with dates | ? |
| FN-009 | average per week / per month / daily | average over a window | State the divisor used | ? |
| FN-010 | how much did i spend last month / this year / since january | window variants | "Last month" = last 30 days (owner decision); year and month names are calendar windows | ✅ |
| FN-011 | do i spend too much on x / is that a lot | judgement | Give the numbers and a comparison to the person's own history; no moral judgement | ? |
| FN-012 | how much is left / what's my budget | budget | Budgets are not supported; offer totals | ✖ |
| FN-013 | spending in euros / convert to usd | currency | Show by currency; no silent conversion unless a rate source exists | ? |
| FN-014 | how much did I make / my income / did I get paid | income records | Income only if the person recorded it; otherwise say it has none | ◐ |

## B. Recording things

| ID | Someone might say | Reads as | Daylark should | Status |
| --- | --- | --- | --- | --- |
| FN-020 | i spent $12 at starbucks / paid 45 for gas / dinner was 80 bucks | finance_record; amount, merchant, date=today | Preview card (merchant, amount, date, category); ask approval | ✅ |
| FN-021 | i spent 30 on lunch yesterday / last friday | date resolution | State the date | ✅ |
| FN-022 | add a $200 expense for rent on the 1st | a fixed date | State the date | ✅ |
| FN-023 | got a refund of 25 from target | refund/income | Record as income or a negative expense; ask which | ? |
| FN-024 | split dinner with 3 people, my share is 27 | partial share | Record only the person's share | ? |
| FN-025 | paid john back / venmo'd sam 40 | person-to-person transfer | Ask whether it is spending; do not guess a category | ? |
| FN-026 | spent 20 euros in paris | foreign currency | Record with EUR; do not convert | ? |
| FN-027 | the same purchase twice | duplicate | Detect duplicates and say so instead of adding again | ✅ |
| FN-028 | delete that expense / remove the last one / that was wrong | delete a record | Deletion of a single record is not supported; say so and say how a duplicate or error can be handled | ✖ |
| FN-029 | change the amount to 15 / it should be groceries | edit a record | Editing is not supported except through the category learning; explain | ✖ |
| FN-030 | import my latest iherb receipts | import (cap 5) | Preview up to 5 with dedupe; ask approval | ✅ |
| FN-031 | (uploads a photo or PDF of a receipt) | receipt import | Extract merchant, amount, date; ask approval; do not store the file | ✅ |
| FN-032 | (uploads a blurry or unreadable receipt) | extraction failed | Say what could not be read; ask the person to type the amount | ◐ |
| FN-034 | import all my receipts from the last week / record everything I bought this week (no store named) | sweep import | Scan email in the requested window across senders and Gmail categories; include purchases and completed payments; preview deduplicated records for approval; disclose unread or skipped records | ✅ |
| FN-033 | add all my amazon orders from last year | bulk import | Process all selected candidates within the request budget; disclose remaining emails and offer continuation after approval | ✅ |

## C. Bills and payments

| ID | Someone might say | Reads as | Daylark should | Status |
| --- | --- | --- | --- | --- |
| FN-040 | what bills do i owe / what's outstanding / unpaid bills / what's due | bills_list | Outstanding bills with due dates; note that they are not counted as spending | ✅ |
| FN-041 | i got a bill of 150 from pg&e | new bill | Record as outstanding, not as spending | ✅ |
| FN-042 | i paid the pge bill / paid the electric / the pg&e one is done | bills_paid; merchant=PG&E | Ask approval; then it counts as spending; date paid = today unless stated | ✅ |
| FN-043 | i paid it on the 12th | paid date | Use the stated date | ✅ |
| FN-044 | pge is on autopay / it's automatic / they pull it out | bills_autopay | Bills of that merchant count as paid on the due date | ✅ |
| FN-045 | did i pay my rent / is my phone bill paid | status of a bill | Look at bills first; if none recorded, look at payment emails; never claim "paid" without evidence | ◐ |
| FN-046 | when is my next bill due | next due date | The soonest due date among outstanding bills | ✅ |
| FN-047 | pay my bill / pay the electric | pay | Not supported; Daylark cannot move money; can show the amount and due date | ✖ |
| FN-048 | set up autopay / schedule a payment | bank action | Not supported; can record that it is on autopay if the person says so | ✖ |
| FN-049 | what's overdue | bills past their due date | List with days late | ✅ |
| FN-050 | mark all bills paid | bulk approval | Show them all; require explicit approval | ? |

## D. Everyday bank and card language (no bank is connected)

The person may say any of these. Daylark should answer honestly, then offer the closest thing it can do.

| ID | Someone might say | What they probably want | Daylark should | Status |
| --- | --- | --- | --- | --- |
| FN-060 | what's my balance / how much is in my account / how much money do i have / am i broke | account balance | "I can't see your bank account." Offer: recent bank emails, or spending totals | ✖ |
| FN-061 | what hit my card / what did i just get charged / any charges today | recent card charges | Cannot see the card. Offer: bank alert emails from today, and receipts | ✖ |
| FN-062 | did my paycheck come in / has my direct deposit hit | deposit check | Cannot see the bank. **Search payroll and bank emails for a deposit notice** and say what the emails show (verified: the router reads this as an email search) | ◐ |
| FN-063 | show my transactions / bank statement / last statement | statements | Offer statement **emails**; can read amounts in those emails; cannot download the statement | ◐ |
| FN-064 | is there a charge from netflix / why was I charged / mystery charge | identify a charge | Search receipts and emails for that merchant and amount; if a bank alert email shows it, say so | ◐ |
| FN-065 | dispute this charge / i want to dispute / what's the status of my chase dispute | dispute status | Status from emails about the dispute (R18); cannot file one | ◐ |
| FN-066 | my card was declined / overdraft fee / why the fee | explain a bank event | Look for the related email; explain only what the email says | ? |
| FN-067 | transfer 200 to savings / send money to sam / zelle / venmo / wire | move money | Not supported; do not pretend to; say so once and offer to record an expense | ✖ |
| FN-068 | how much is my credit card bill / statement balance / minimum payment | card bill | If a statement email exists, read the amount and due date; otherwise say it is not visible | ◐ |
| FN-069 | what's my credit score / interest rate / apr | account data | Not visible; can search public information about rates | ✖ |
| FN-070 | how much did i pay in fees / interest / atm | fee analysis | Only from recorded records and bank emails | ? |
| FN-071 | freeze my card / report it stolen / lock it | urgent bank action | Say Daylark cannot do it and to contact the bank now; if the message suggests fraud in progress, be brief and practical | ✖ |
| FN-072 | is this a scam text / is my bank calling me | fraud check | General guidance, no account access; never ask for account numbers | ? |
| FN-073 | "the chase thing" / "that bank email" | vague reference | Ask which one; offer the most recent bank emails | ? |
| FN-074 | my other card / the visa / the amex | which account | Ask which; there are no accounts, so search bank emails by issuer | ? |
| FN-075 | how much did i deposit / cash back / interest earned | deposit info | Not visible; look for emails | ✖ |

## E. Status of a matter with a company (R18)

| ID | Someone might say | Reads as | Daylark should | Status |
| --- | --- | --- | --- | --- |
| FN-080 | what's the status of my chase dispute / did my refund go through / where's my return | status_lookup; matter, company | Search that company's mail for the matter; report the latest update and its date; say when there is none | ✅ |
| FN-081 | any update from the insurance about my claim | status_lookup | Same | ? |
| FN-082 | has my package shipped / where's my order | shipping status | Read shipping mail; state carrier and date | ◐ |
| FN-083 | did i hear back from the landlord about the deposit | status by person | Same | ? |

## F. Categories and names (learning-linked)

| ID | Someone might say | Daylark should | Status |
| --- | --- | --- | --- |
| FN-090 | iherb is health / put whole foods under groceries | Learn the category; applies to new records | ✅ |
| FN-091 | amzn means amazon | Learn an alias | ✅ |
| FN-092 | why is starbucks under shopping | Explain the mapping; offer to change it | ◐ |
| FN-093 | what categories do you have | The ten categories: restaurants, groceries, transport, shopping, utilities, entertainment, software, health, housing, other | ✅ |
| FN-094 | make a new category for pets | Custom categories are not supported today | ✖ |

### Spending import scan

“Import all my spendings in the last 30 days” searches received Gmail messages in that rolling window without restricting sender, subject keywords, or Gmail categories. Archived mail is included; sent mail, drafts, chats, spam and trash are excluded. Summaries are read with bounded concurrency and cached per user, then classified in model batches. Only candidates need full message reads; clear USD order receipts use deterministic extraction. Supported attachments are read when the body cannot supply a usable record.

Completed merchant payments, rent, utilities, subscriptions, and purchase alerts from banks or payment providers are eligible. Credit-card repayments are imported as transfers and excluded from spending totals. Incoming credits, unpaid statements and scheduled payments are excluded. Matching order numbers from different merchants are kept separate.

The synchronous chat request has a 270-second budget (under a 300-second route ceiling) and scans at most 2,000 email summaries. It no longer stops after 15 extracted items. Metadata failures, search truncation, unread candidates and extraction skips are disclosed; a partial scan must never be described as complete. Large mailboxes can require a smaller date range or another request after confirming the preview. The scan gets up to 120 seconds for Gmail summaries and reads candidates until 240 seconds, reserving time to save a review. This is not a background import job. Model selection and extraction can still miss records; live spending-picker evaluations are opt-in.


### All dues and reminders

“Show all my dues” lists saved outstanding bills and scans the last 90 days of email (or the requested rolling window) for credit-card, utility and other payable statements across senders. Statement extraction reads the full amount due, issuer, statement date and payment due date, including supported attachments. It never substitutes a minimum payment or follows sign-in links. Missing amounts or dates are reported; payment status from an old statement is explicitly unverified. Existing recorded statements, including paid ones, are excluded from new previews.

New statements are previewed for confirmation before saving as bills. Confirmed dues appear under **Perch → Reminders → All dues**, including overdue, due today, the next seven days, later dates, and unknown due dates. Totals include every group and stay separate by currency. The **Find statements in email** link opens a prefilled chat request; opening Perch itself does not run a mailbox scan. These are in-app reminders, not push or email notifications.

Credit-card bills retain their payment direction in their encrypted evidence so paying a confirmed card statement is a transfer, not a new expense. Utility payments remain expenses. No database migration is required for this metadata.


Email import corrections:
- UPI transactions are excluded from searches, summary selection, and full-message imports (owner preference). This does not delete existing records.
- Payment notices are scanned before general mail, so older credit-card payments, including Discover, are less likely to be hidden by an incomplete broad scan.
- Remitly updates are reconciled by explicit transfer reference and labeled sender amount/currency. Recipient-side conversions are not separate transactions. Ambiguous references or sender amounts are skipped for review rather than guessed.
- Generic transfers are labeled transfers; only identified card repayments use the card-payment label. Rerun an import to replace a preview created before these rules changed.

Resumable email scans:
- Primary and Updates are scanned first using Gmail's documented [category search operators](https://support.google.com/mail/answer/7190). Payment notices are checked first within those categories, then the remaining categories are checked.
- Each scan freezes its original date window and stores page tokens, unfinished message IDs, selected candidates, and extracted results in the existing encrypted workflow checkpoint store. Progress can be resumed in the same conversation for 7 days; an approval preview still expires after 30 minutes and is refreshed on continuation.
- While the chat stays open, saved batches advance automatically with one progress indicator. Gmail cooldowns are honored; three batches without progress or 30 automatic continuations pause safely. Intermediate batches do not create approval previews. Stop requests a server pause. The current batch saves its progress and releases its lease before Continue becomes available. During a Gmail cooldown, Stop ends the wait immediately. Message-specific extraction failures are attempted at most three times, then disclosed as skipped so later records can be reviewed. Bill settlement requires an exact amount, matching currency/account, and a unique outstanding bill; partial or ambiguous payments are recorded separately. Closing the tab stops automatic continuation; **Continue scan** resumes saved work when the user returns. The final review still requires confirmation.
- **Continue scan** resumes saved work without importing transactions. **Import reviewed items** confirms the current preview separately. Previously confirmed records are deduplicated when a later preview is built.
- Gmail cooldowns persist across requests. Pressing Continue early reports the remaining wait and makes no Gmail requests. A versioned lease prevents concurrent continuations, and abandoned requests become resumable after five minutes.
- Work runs in bounded requests initiated by the user. There is no autonomous background worker or automatic continuation while the chat is closed. Reopening the conversation preserves the Continue action and saved progress.
- Old previews created before this change have no scan checkpoint; start a new scan once to use continuation.

### Requested financial guidance

Daylark can answer requested budgeting, saving, debt, credit, earning and investment-education questions directly. This includes follow-ups to requested advice. Routine ledger, receipt and dues queries do not trigger unsolicited advice. The shared answer policy avoids boilerplate credential disclaimers while requiring explicit assumptions, material risks, and evidence for personal financial claims. Advice alone never authorizes a write or money movement.

Stable explanations use the conversation's supplied facts; time-sensitive financial rules and product comparisons route to web research using public queries without personal financial details. This does not add bank connectivity or claim the saved ledger is a complete financial picture. These are routing and response instructions, tested offline with mocked models; model judgment is not guaranteed by those tests.

### Transaction-list reads

The finance dispatcher explicitly selects read or record mode; a read cannot fall through to transaction extraction. A structured query resolves inclusive date ranges, merchant/category filters and transaction-list versus spending-summary intent. Named months take precedence over a broad year qualifier; disjoint months retain separate ranges. All-transactions views include expenses, income/refunds and transfers with per-currency, per-direction totals. The ledger reader paginates beyond 1,000 records, and list rendering does not truncate to the five largest entries. Query interpretation failures preserve the read-only boundary.
