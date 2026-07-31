-- 061: tighten the custom loss-reason pill to 24 characters.
--
-- 060 borrowed the tags limit (40) without asking what a reason pill is
-- for. It is not a tag: it renders as a CHIP beside the built-ins and as a
-- BAR LABEL in the analysis card and on /stats, where a long one truncates
-- to nothing or shoves the count off the row. The longest built-in is
-- "They were just better" at 20, so 24 leaves headroom and still refuses a
-- sentence — a pill only earns its place by recurring across matches, and
-- a sentence never recurs.
--
-- The app caps the input at the same number (MAX_CUSTOM_REASON_LEN in
-- scorecard.ts); this is the backstop for anything that isn't the app.
--
-- Safe to run on existing data: 060 shipped hours earlier and no label
-- longer than 24 characters exists. The trim keeps it safe regardless —
-- a row that would violate the new bound is shortened rather than
-- blocking the migration.
update public.loss_reason_labels
set label = btrim(left(btrim(label), 24))
where char_length(btrim(label)) > 24;

alter table public.loss_reason_labels
  drop constraint if exists loss_reason_labels_label_check;

alter table public.loss_reason_labels
  add constraint loss_reason_labels_label_check
  check (char_length(btrim(label)) between 1 and 24);
