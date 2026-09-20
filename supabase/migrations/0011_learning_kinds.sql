-- Calendar and finance learnings (R14): widen the allowed kinds.
alter table public.user_learnings
  drop constraint user_learnings_kind_check,
  add constraint user_learnings_kind_check check (kind in (
    'default_window', 'sender_alias',
    'calendar_duration', 'calendar_buffer',
    'merchant_category', 'merchant_alias'
  ));
