-- Store the uploaded file's original filename so the dashboard can show a
-- human-friendly name and downloads can be named after the source video.
-- (Already applied in production; kept here for repo parity.)

alter table public.jobs
  add column if not exists original_name text;
