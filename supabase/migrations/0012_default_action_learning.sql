-- R11.8: a learned default for what a request means (receipts show amounts).
alter table public.user_learnings
  drop constraint user_learnings_kind_check,
  add constraint user_learnings_kind_check check (kind in (
    'default_window', 'sender_alias', 'default_action',
    'calendar_duration', 'calendar_buffer',
    'merchant_category', 'merchant_alias'
  ));
