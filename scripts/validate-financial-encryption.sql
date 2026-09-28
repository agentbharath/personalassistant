-- Run only after the converter reports zero remaining legacy rows.
-- Validation scans the data; failure leaves the constraint enforcing new writes.
begin;
alter table public.finance_transactions validate constraint finance_transactions_encrypted_only;
alter table public.finance_bills validate constraint finance_bills_encrypted_only;
alter table public.bank_connections validate constraint bank_connections_encrypted_only;
alter table public.bank_transactions validate constraint bank_transactions_encrypted_only;
commit;
