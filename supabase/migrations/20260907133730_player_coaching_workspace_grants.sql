-- Put back the grants that dropping and recreating two functions reset.
--
-- `drop function` takes the privileges with it, and this database's default
-- privileges hand EXECUTE on a new function to anon and authenticated. So
-- recreating publish_lesson_video turned a service-role-only routine into
-- one anybody holding the public anon key could call — and it takes the
-- owner as an ARGUMENT rather than reading auth.uid(), so a caller who knew
-- a video id and its owner id could have published or shared somebody
-- else's recap. `create or replace` keeps grants; `drop` plus `create` does
-- not, and that difference is the whole of this file.
--
-- The rule this belongs to is in CLAUDE.md: the anon key is compiled into
-- the client bundle, so what a role may execute is the boundary, never the
-- fact that only our own code calls it today. Any future migration that
-- drops a SECURITY DEFINER function must state its grants again.

revoke all on function public.publish_lesson_video(uuid, uuid, boolean) from anon, authenticated;
grant execute on function public.publish_lesson_video(uuid, uuid, boolean) to service_role;

-- Scoped by auth.uid(), so anon would read nothing — but a function anon
-- may call is a function anon may probe, and it was not callable before.
revoke all on function public.student_shared_lessons() from anon;
grant execute on function public.student_shared_lessons() to authenticated, service_role;

revoke all on function public.lesson_video_access(uuid) from anon;
grant execute on function public.lesson_video_access(uuid) to authenticated, service_role;
