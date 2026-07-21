-- PongLens match experience v2 — player tagging + server override.
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
-- The worker labels sides with a fixed assumption (near = "user",
-- far = "opponent"). These columns record which side the uploader actually
-- played from, so the UI can derive "You served" chips from user_side
-- instead of trusting the assumption. Until user_side is set the UI shows
-- neutral "Near player served" labels.

alter table public.matches
  add column if not exists user_side text
    check (user_side in ('near', 'far')),
  add column if not exists player_near_name text,
  add column if not exists player_far_name text;

-- Column-restricted client grants (003 granted opponent_name only; grants
-- are additive). The owner-only update policy still applies.
grant update (user_side, player_near_name, player_far_name)
  on public.matches to authenticated;

-- Server override: the owner can flip a wrong server call from the UI.
-- points.server keeps the worker's side semantics ('user' = near player,
-- 'opponent' = far player); the check constraint from 003 still applies.
grant update (server) on public.points to authenticated;
