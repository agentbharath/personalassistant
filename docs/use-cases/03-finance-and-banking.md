# 03 · Money, spending and banking language

Daylark is **not connected to any bank or card account.** It knows only what the person typed, imported from an email or receipt, or approved. Everyday bank language ("what hit my card", "my balance", "the Chase thing") is therefore the biggest source of wrong answers: people assume Daylark can see their bank. The correct behaviour is to say what it can and cannot see, and to offer the nearest useful thing (usually bank **emails**). Prefix `FN`.

Rules that apply throughout: a **bill is not spending until it is paid** (R17); shipped mail is not a receipt (R4); imports are capped at 5 (R13); saving anything needs approval; money is shown with the currency; totals state which records they cover.

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
| FN-034 | import all my receipts from the last week / record everything I bought this week (no store named) | sweep import | Search purchase and payment emails from any sender in the window; newest 5 with dedupe; ask approval; offer the next batch | ✅ |
| FN-033 | add all my amazon orders from last year | bulk over the cap | Explain the cap of 5; import the newest 5; offer the next batch | ✅ |

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
| FN-093 | what categories do you have | The nine categories: restaurants, groceries, transport, shopping, utilities, entertainment, health, housing, other | ✅ |
| FN-094 | make a new category for pets | Custom categories are not supported today | ✖ |
