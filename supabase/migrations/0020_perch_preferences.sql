-- R27: the owner's choices for Perch. Reminders are opt-in: with no row, Daylark reads no mail for the "Waiting on your reply" card and asks first.
-- Renames the table added in 0019 (never used, no rows) and adds the two switches and a fourth kind of mail.

alter table public.reply_preferences rename to perch_preferences;

alter table public.perch_preferences
  drop constraint reply_preferences_kinds_check,
  add constraint perch_preferences_kinds_check check (kinds <@ array['person', 'business', 'recruiter', 'invitation']),
  add column perch_enabled boolean not null default true,
  add column reminders_enabled boolean not null default true;

alter policy "users manage their reply preferences" on public.perch_preferences rename to "users manage their perch preferences";
