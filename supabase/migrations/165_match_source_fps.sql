-- The frame rate of the video the owner actually uploaded.
--
-- The worker has always read this from the file when it renders, and has
-- never kept it. So "how did the 60fps uploads do?" could only be answered
-- by downloading every raw and probing it again — and only for as long as
-- the raw still existed. With 60 fps becoming the recording default, that
-- question is about to be asked of every new batch.
--
-- Written once at ingest, from the source before any trim (a stream copy
-- does not change the frame rate, but the source is the honest thing to
-- record). Null for every match processed before this shipped, and for
-- anything whose probe failed — absent, not "30". Do not default it: a
-- guessed 30 would silently join the 30fps side of the very comparison
-- this column exists to make.
alter table public.matches
  add column if not exists source_fps double precision;

comment on column public.matches.source_fps is
  'Frame rate of the uploaded source, probed at ingest. Null when unknown '
  '(pre-165 matches, or a failed probe) — never assume 30.';
