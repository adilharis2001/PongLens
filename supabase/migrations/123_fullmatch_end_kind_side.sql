-- 123: the ball that rolls off the side of the table.
--
-- Adil, marking ends on the bench: "I don't know how you wanna tackle
-- rolling off the side of the table... if it rolls off the left side you
-- immediately lose it." A side-roll is its own fingerprint — a slow, low
-- exit through the prism's side wall, nothing like a far/near fly-out —
-- and folding it into 'far'/'near' would pollute exactly the classes
-- meant to validate fast exits. Fifth option: 'side'.

alter table public.fullmatch_labels
  drop constraint if exists fullmatch_labels_end_kind_check;
alter table public.fullmatch_labels
  add constraint fullmatch_labels_end_kind_check
    check (end_kind is null
           or end_kind in ('far', 'near', 'net', 'table', 'side'));
