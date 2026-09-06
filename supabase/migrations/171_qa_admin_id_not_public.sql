-- 171 — the QA helper stops answering strangers.
--
-- `_qa_admin_id()` looks the admin account up by email and returns its id.
-- It is internal plumbing for `_qa_write_message`, but it was created in 127
-- without revoking the EXECUTE that Postgres grants to PUBLIC by default, so
-- anyone holding the anon key — which ships inside the website — could call
-- it over the REST API and read the admin's user id back. Verified against
-- production on 2026-09-04: HTTP 200 with the id.
--
-- Nothing calls it from application code. Its one caller in the database is
-- `_qa_write_message`, which is SECURITY DEFINER and therefore runs as the
-- owner, so it keeps working with no grant of its own.

revoke execute on function public._qa_admin_id() from public, anon, authenticated;
