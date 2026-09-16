-- Read-only input for audit-canonical-corpus.ts. Run with psql -At so each
-- result is one NDJSON row. The export deliberately contains IDs and scoring
-- fields only: no player names, notes, tags, media paths or URLs.
\set ON_ERROR_STOP on

select jsonb_build_object(
  'matchId', m.id,
  'legacyInput', jsonb_build_object(
    'firstServer', m.first_server,
    'firstServerSource', m.first_server_source,
    'points', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'idx', p.idx,
          't0', p.t0,
          'deleted', p.deleted,
          'isLet', p.is_let,
          'confirmedHow', p.confirmed_how,
          'confirmedWinner', p.confirmed_winner,
          'serverOverride', p.server_override,
          'gameEndOverride', p.game_end_override,
          'gameWinnerOverride', p.game_winner_override
        ) order by p.idx, p.id
      )
      from public.points p
      where p.match_id = m.id
    ), '[]'::jsonb)
  ),
  'canonicalSnapshot', public._canonical_score_snapshot(m.id)
)::text
from public.matches m
order by m.id;
