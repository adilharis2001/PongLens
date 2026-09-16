# Cards to show once a match is scored

2026-09-15. Read-only analysis over 19 scored matches with v3 placement
(1,320 scored points, 9,400 bounce candidates). The page is
`scored-match-cards.html`; every number on it comes from `out/`.

Serve placement and the heat map already cover serve depth and direction.
Possible now on filtered data: point length by whose serve (start at the
serve's first bounce, end at the earlier of the worker's rally end and the
owner's score tap), serve speed from the two serve bounces, serve variety,
where points ended on matches whose endings land on the loser's half 70%+
of the time, and a heat-map cell tap-through to points. Not possible yet:
receive errors and third-ball outcomes (the return bounce is missed on half
the points that show none; 62 to 74% agreement with the score), rally length
in shots, attack versus push, rally heat maps.

Reproduce: `worker/venv/bin/python scripts/dump_corpus.py <dir>` (reads the
database through the `ponglens-db-url` keychain entry, writes nothing), then
`node --experimental-strip-types --import scripts/register_hook.mjs
scripts/emit_serving.ts <dir> <out>` for the app's own serve rotation, then
`analyze.py` through `analyze6.py` with the scratch directory as the argument,
and `build_page.py` for the page. The corpus JSON is not kept here.
