-- A saved home location (city or ZIP), used as the default place for travel and local searches.
alter table public.user_learnings
  drop constraint user_learnings_kind_check,
  add constraint user_learnings_kind_check check (kind in (
    'default_window', 'sender_alias', 'default_action',
    'calendar_duration', 'calendar_buffer',
    'merchant_category', 'merchant_alias', 'autopay',
    'home_location'
  ));
