-- 009: ITTF serve rotation as the source of truth for "who served".
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
--  * matches.first_server — who served first in the match ('user' = the
--    uploader, 'opponent' = the other player). Set by the owner in the
--    match UI. Once set, the displayed server for every point derives from
--    it by ITTF rotation: 2-serve blocks, alternate every point from 10-10
--    in the current game's confirmed score, first server swaps each game.
--    Auto-detected points.server remains only the default guess for this
--    value and the display fallback while it is null.
--  * points.server_override — owner correction: the displayed server for
--    this point AND the rotation anchor for the points after it (display
--    recomputes downstream from the most recent override before each
--    point). Written by both "X served (override)" and "Rotation is off
--    from here" in the server chip menu.
--  * points.is_let — a let: the same server serves again, so the point is
--    excluded from the rotation count and from the score strip.

alter table public.matches
  add column if not exists first_server text
    check (first_server in ('user', 'opponent'));

alter table public.points
  add column if not exists server_override text
    check (server_override in ('user', 'opponent')),
  add column if not exists is_let boolean not null default false;

-- Column-restricted client grants (003/005/007 pattern; grants are
-- additive). The owner-only update policies from 003 still apply.
grant update (first_server) on public.matches to authenticated;
grant update (server_override, is_let) on public.points to authenticated;
