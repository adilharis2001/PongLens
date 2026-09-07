-- Revoking from anon and authenticated was not enough: PostgreSQL grants
-- EXECUTE on a new function to PUBLIC, and anon and authenticated inherit
-- it from there. So publish_lesson_video stayed callable by anybody after
-- the first correction, and a check that joined aclexplode() to pg_roles
-- did not show it — PUBLIC is grantee 0 and has no row in pg_roles, so the
-- join quietly dropped exactly the grant that mattered. Read `proacl`
-- directly: the PUBLIC grant is the entry with an empty grantee, `=X/...`.
--
-- The shape to match is complete_lesson_video's:
--   {postgres=X/postgres,service_role=X/postgres}
-- with no bare `=X/` entry at all.
--
-- publish_lesson_video is the one that matters. It is SECURITY DEFINER, it
-- never reads auth.uid(), and its whole authorisation is an owner id the
-- caller passes in, so anyone knowing a video id and its owner id could
-- publish or re-share somebody else's recap and read the row back,
-- transcript included. Both ids reach a shared-with coach in the API's own
-- response.

revoke all on function public.publish_lesson_video(uuid, uuid, boolean) from public;
revoke all on function public.lesson_video_access(uuid) from public;
revoke all on function public.student_shared_lessons() from public;

grant execute on function public.publish_lesson_video(uuid, uuid, boolean) to service_role;
grant execute on function public.lesson_video_access(uuid) to authenticated, service_role;
grant execute on function public.student_shared_lessons() to authenticated, service_role;
