-- 032: two optional follow-ups on the point scorecard.
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
--  * SERVE DIAGNOSIS (asked when confirmed_how is receive_error or
--    service_ace). Receive is where most players actually lose points, and
--    "which serve keeps beating me" is the question the footage alone can't
--    answer.
--
--    Spin is modelled as a BASE plus a MODIFIER rather than one flat list,
--    because real serves combine: side-under and side-top are the two most
--    common problem serves and neither is expressible in a mutually
--    exclusive top/back/side/none set. So:
--        serve_spin      back | top | none   (the topspin axis)
--        serve_sidespin  true when there's sidespin on it
--    giving side-under (back + side), side-top (top + side), pure sidespin
--    (none + side) and a dead float (none) from four chips. Left vs right
--    sidespin is deliberately NOT captured: it doubles the option count for
--    a distinction almost nobody would fill in honestly.
--
--    Serve PLACEMENT is not here on purpose — points.direction (030)
--    already records forehand / backhand / middle for these same hows.
--
--  * LOSS REASONS (asked only when the opponent won, i.e. the owner lost).
--    Multi-select, self-reported, first-person only: you can't know why
--    your opponent lost a point, so this never appears on points you won or
--    on neutral third-party matches.
--
-- Both are OPTIONAL and reached from the scorecard summary, never forced
-- into the confirm path — scoring 150 points must not get slower.

alter table public.points
  add column if not exists serve_spin text
    check (serve_spin in ('back', 'top', 'none')),
  add column if not exists serve_sidespin boolean,
  add column if not exists serve_length text
    check (serve_length in ('short', 'half', 'long')),
  add column if not exists loss_reasons text[];

-- Keep the multi-select vocabulary honest at the DB level. An empty array
-- is allowed (and is what "cleared" looks like before the app nulls it).
alter table public.points
  drop constraint if exists points_loss_reasons_vocab;
alter table public.points
  add constraint points_loss_reasons_vocab check (
    loss_reasons is null
    or loss_reasons <@ array[
      'misread_spin', 'out_of_position', 'rushed', 'too_passive',
      'too_aggressive', 'weak_serve', 'lost_focus', 'their_winner'
    ]::text[]
  );

-- `authenticated` holds COLUMN-level UPDATE grants on points (there is no
-- table-wide UPDATE for that role), so a newly-added column is readable but
-- silently unwritable by the owner until granted. This is exactly what
-- broke points.direction in 030 — grant every new column here.
grant update (serve_spin, serve_sidespin, serve_length, loss_reasons)
  on public.points to authenticated;
