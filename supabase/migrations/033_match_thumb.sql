-- 033: matches.thumb_path — poster JPEG for match cards (Matches library).
-- Extracted by the worker from the midpoint of the first point's clip.
-- Point clips live for the account lifetime (unlike 30-day cut videos under
-- results/), so the backfill covers every ready match that still has clips.
-- Stored alongside the clips at
--   r2://ponglens-media/points/<user_id>/<match_id>/thumb.jpg
-- so the delete-match prefix wipe removes it with everything else, and the
-- retention cron (results/ only) never touches it.

alter table public.matches add column if not exists thumb_path text;

comment on column public.matches.thumb_path is
  'Poster JPEG for match cards: r2://ponglens-media/points/<uid>/<matchId>/'
  'thumb.jpg. Written by the worker (processing + backfill_thumbs.py); null '
  'when no frame could be extracted. Signed via /api/media-url {thumbs}.';
