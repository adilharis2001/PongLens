-- 116 — replace the level words with a ladder that reads the same in any
-- language.
--
-- 115 shipped five adjectives, one of which ("advanced pro") does not exist
-- as a term anywhere in the sport. Researching how other racket sports do
-- this turned up two things worth acting on.
--
-- One: every international system that works — padel's 1-to-7 used across
-- Spain, Sweden and Belgium; the USATT bands quoted throughout the table
-- tennis world — climbs the same competition ladder at the top. Club,
-- regional, national, international are the four rungs, and those four
-- words survive translation because they are the same words the sport uses
-- everywhere. Adjectives do not: "advanced" is a judgement, and a judgement
-- has to be re-argued in every language.
--
-- Two, and the reason the top half is facts rather than adjectives:
-- self-declared level runs optimistic by half a rung to a full one, which
-- is well documented in padel's own guidance. You cannot ask someone to
-- rate themselves and expect calibration. You CAN ask them something they
-- know for certain — do you play a league, have you played a national
-- tournament — and get an answer that is true.
--
-- So the bottom three are skill words for players with no competition to
-- point at, the top four are facts, and the prompt says to pick the highest
-- one that is true. Seven rungs, which is what the padel scale settled on
-- and what Adil asked for.
--
-- 'advanced_pro' is dropped. It was live for under an hour and the only
-- rows carrying it are test accounts, but the update below is written to
-- move any real row to the nearest honest rung rather than fail the
-- constraint.

alter table public.player_profiles
  drop constraint if exists player_profiles_level_check;

-- Anyone who called themselves advanced_pro was describing ranked
-- tournament play, which is what 'regional' now names.
update public.player_profiles
   set level = 'regional'
 where level = 'advanced_pro';

alter table public.player_profiles
  add constraint player_profiles_level_check
  check (
    level is null
    or level in (
      'beginner',       -- learning the strokes
      'intermediate',   -- rallies with spin and control
      'advanced',       -- strong technique, trains regularly
      'club',           -- plays club matches or a local league
      'regional',       -- competes at regional or state level
      'national',       -- competes at national level
      'international'   -- represents a country, or plays professionally
    )
  );

comment on column public.player_profiles.level is
  'Self-reported playing level, ordered lowest to highest: beginner, '
  'intermediate, advanced, club, regional, national, international. The '
  'bottom three are skill; the top four are competition facts, because '
  'self-rating inflates and a fact does not. Pick the highest that is true.';
