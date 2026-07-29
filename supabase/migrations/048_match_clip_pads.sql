-- 048: per-match clip context pads.
--
-- Point clips are cut as [t0 - pre, t1 + post]; the app maps the <video>
-- playhead back onto the source timeline with these pads, so it must use
-- the values the clips were ACTUALLY cut with. Historically pads were a
-- pure function of job strictness (clipEdit.ts CLIP_PAD), which froze
-- them forever — tightening the defaults would have broken playhead math
-- on every existing match. Now the worker stamps the pads it cut with on
-- the match row; null means a pre-048 match and the app falls back to the
-- historical per-strictness table.
--
-- On matches (not jobs.options) so coaches can read it: the app's coach
-- path can't read the owner's job row under RLS.

alter table public.matches
  add column if not exists clip_pads jsonb;
