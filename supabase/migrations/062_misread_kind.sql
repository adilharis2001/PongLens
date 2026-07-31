-- 062: what got you about the spin — its type, or its amount.
--
-- The single follow-up to "Misread the spin", and the last one this
-- scorecard asks. Two failures, two fixes: TYPE means you could not tell
-- backspin from float, and the practice is watching contact; AMOUNT means
-- you read it right and misjudged how much, and the practice is bat angle
-- and feel. One column would have lost that split, and it is the split that
-- decides what you go and work on.
--
-- Deliberately not the spin itself. Naming the ball ("it was backspin") is
-- a question about the serve; this is a question about the player, and only
-- one of those changes what they do on Tuesday.
--
-- What this replaces: 060 asked "where did the ball go?" (net / long /
-- wide) after a misread, on the coaching logic that the miss names the
-- spin. It was the app's inference dressed up as a question — the player
-- already knows what beat them, so asking for the symptom made them do the
-- app's work. Those confirmed_how values stay readable on the points that
-- have them; nothing writes them again.
alter table public.points
  add column if not exists misread_kind text
    check (misread_kind in ('type', 'amount'));

-- `authenticated` holds COLUMN-level UPDATE grants on points, so a new
-- column is readable and silently unwritable until granted. This is what
-- broke points.direction in 030 and the reason 032 says to grant every new
-- column in the same migration that adds it.
grant update (misread_kind) on public.points to authenticated;

-- points.direction is UN-RETIRED by this migration, with a narrower job:
-- the follow-up to "Out of position" ("where did they get you?" — wide
-- backhand / middle / wide forehand). No data change is needed, because on
-- a point the owner LOST the old question already meant the same thing: it
-- asked where the winner placed the deciding ball, and on a lost point that
-- is exactly where you were beaten. Only points you WON carry the other
-- reading, and those are never asked this.
