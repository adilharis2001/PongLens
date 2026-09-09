-- The drafts table's column-scoped update grant, made true.
--
-- The hand-cut migration said submitted_at was "deliberately absent, so
-- only the definer function sets it" and granted update on (marks,
-- updated_at) alone. That grant was a no-op: Supabase's default
-- privileges on the public schema had already handed authenticated the
-- whole table, so every column was writable and the comment described an
-- intention rather than a fact. Revoke the table-wide grant and put the
-- columns back, which is what the comment always meant.
--
-- Row-level security was, and remains, the real guard: an owner may only
-- touch their own draft, and only while it is unsubmitted. This closes
-- the narrower hole of an owner freezing their own draft by writing
-- submitted_at directly.

revoke update on public.hand_cut_drafts from authenticated;
grant update (marks, updated_at, mode) on public.hand_cut_drafts to authenticated;
