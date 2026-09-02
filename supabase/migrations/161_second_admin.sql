-- 161 — Anton can open the admin portal.
--
-- is_admin() is the real boundary: every admin RPC re-checks it, and the
-- web's redirect is UX on top. It compared one literal email; it now
-- checks membership in a two-element list. The same two literals live in
-- ADMIN_EMAILS in src/lib/config.ts, and the lists must move together —
-- a name in one and not the other gets pages that render but RPCs that
-- refuse, which reads as a broken portal rather than a permissions gap.
--
-- Deliberately still literals, not an app_config row. The function is
-- SECURITY DEFINER and STABLE, called on every admin query; a config read
-- here would put a table lookup inside the hottest gate for no benefit,
-- and changing the admin set is a migration-sized event either way.
--
-- The worker's ADMIN_EMAIL is untouched: that is the operational identity
-- — failure mail, export receipts, the digest — and none of it should
-- follow a second reader of the dashboard.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(auth.jwt() ->> 'email', '')
         in ('adilharis2001@gmail.com', 'aber97@gmail.com');
$$;
