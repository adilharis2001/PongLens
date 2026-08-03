-- 066: tell the uploader when their upload or import fails.
--
-- A failed job wrote its reason into jobs.error and emailed the ADMIN. The
-- uploader got nothing: no email, no bell, and the import card kept saying
-- "We're fetching it. You can leave this page." indefinitely, because its
-- poll read status only to stop polling. Someone whose video was private
-- had no way to find out except asking.
--
-- Two columns' worth of care about WHICH message:
--
--   error         — whatever the exception said, for the admin. Can be a
--                   stack-shaped string; never shown to the uploader.
--   user_message  — set only where the worker raised UserFacingError, a
--                   class that already means "safe to show verbatim"
--                   ("That video is private or unavailable."). Null when
--                   the failure was a crash, and the notice falls back to
--                   a plain line rather than leaking internals.
alter table public.jobs
  add column if not exists user_message text
    check (user_message is null or char_length(user_message) <= 300);

grant update (user_message) on public.jobs to service_role;

-- The bell learns one new kind. Rebuilt rather than added to, because the
-- CHECK is a single list.
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'note', 'match_ready', 'match_failed',
    'reel_ready', 'reel_failed', 'coach_joined',
    'upload_failed'));

-- ---------------------------------------------------------------------------
-- jobs.status -> "we couldn't process that video"
-- ---------------------------------------------------------------------------
create or replace function public.jobs_notify_failed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status or new.status <> 'failed' then
    return new;
  end if;
  -- ONLY the jobs a person is waiting on. reclip, placement and reel
  -- renders fail behind their own surfaces, which report themselves; a
  -- bell for each would be noise about work nobody asked about directly.
  if coalesce(new.kind, 'deadspace_cut')
     not in ('deadspace_cut', 'youtube_import') then
    return new;
  end if;
  if new.user_id is null then
    return new;
  end if;

  insert into public.notifications
    (user_id, kind, title, body, href)
  values (
    new.user_id,
    'upload_failed',
    case when new.kind = 'youtube_import' then 'Import failed'
         else 'Upload failed' end,
    coalesce(nullif(btrim(new.user_message), ''),
             'We couldn''t process this video.'),
    '/upload'
  );
  return new;
end;
$$;

drop trigger if exists jobs_notify_failed_status on public.jobs;
create trigger jobs_notify_failed_status
  after update of status on public.jobs
  for each row execute function public.jobs_notify_failed();
