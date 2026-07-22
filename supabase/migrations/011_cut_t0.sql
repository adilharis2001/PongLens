-- 011: go-to-point in the cut video + warmup retirement.
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
--  * points.cut_t0 — where the point starts inside the CUT video, in
--    seconds. Written by the worker (it knows the kept activity spans, so
--    the offset is span-kept-time-before + offset-within-span, anchored on
--    the padded clip start). Null on matches processed before this
--    migration and on points born from splits; the "Go to point" strip in
--    the full-video preview only shows for points that have it.
--  * points.warmup is RETIRED (2026-07-22): the classifier was too
--    inaccurate, so the worker no longer sets it and the UI ignores it.
--    The column is kept as-is — dropping it buys nothing and old rows are
--    harmless. Users curate the timeline with delete instead.

alter table public.points
  add column if not exists cut_t0 numeric;
