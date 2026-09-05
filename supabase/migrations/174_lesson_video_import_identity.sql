-- The phone knows this UUID before the first network request. A lost create
-- response must return the same import rather than consume another slot.
alter table public.lesson_videos add column import_token uuid;
create unique index lesson_videos_import_identity on public.lesson_videos(owner_id,import_token) where import_token is not null;
