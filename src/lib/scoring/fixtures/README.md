# Canonical scored-match fixtures

`canonical-score-cases.json` is the hand-checked cross-platform contract for
timeline order, point score, game boundaries and serve rotation. Expected
values are literal review data; never regenerate the expected side with the
projector being tested.

## Authority during rollout

- The TypeScript projector is the executable migration reference while the
  database projection is shadow-only.
- After the SQL projector passes parity on production data and readers move to
  it, the committed SQL projection becomes the stored canonical authority.
- Swift and Python consume the same JSON cases as parity checks. They must not
  introduce a separate interpretation of score, games or serving.
- A semantic change begins by changing or adding a reviewed fixture. Update
  every implementation and parity test in the same release.

## Local checks

```bash
npm run test:scoring-state
node --test --experimental-strip-types \
  'src/app/match/[[]id[]]/gameScore.test.ts' \
  'src/app/match/[[]id[]]/serving.test.ts'
```

The real database tests are opt-in and never connect to production:

```bash
node scripts/scoring/setup-local-db.mjs
SCORING_STATE_LOCAL_DB_TEST=1 npm run test:scoring-state
```

The setup command uses the dedicated Docker container
`ponglens-canonical-score-test`. Docker Desktop must be running.

## Manual-cutter truth

Manual-cutter `t0` and `t1` are owner-marked source-video boundaries. Preserve
them as `manual_cutter` observations with the raw start tap, playback rate and
applied lead. They are eligible examples for worker training and evaluation,
but are not an independent evaluation of the manual cutter that produced them.
