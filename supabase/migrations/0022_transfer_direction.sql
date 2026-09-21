-- Credit card bill payments are recorded as transfers: they settle a card bill, but they are not new spending, so they never count in spending totals
-- (the purchases on the card are the spending). Every total already filters on direction = 'expense', so a transfer is left out of them.

alter table public.finance_transactions
  drop constraint finance_transactions_direction_check,
  add constraint finance_transactions_direction_check check (direction in ('expense', 'income', 'transfer'));
