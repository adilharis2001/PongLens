# Canonical scored-match reader migration plan

Move owner-facing reads from duplicated TypeScript and Swift folds to the
revisioned canonical projection only after the phase-two production canary is
accepted. This is a reader migration, not a semantics change: the legacy fold
remains the comparison oracle and rollback path until every surface has zero
unexplained differences.

## Entry gate

- Log into the final native simulator build, open an existing scored match, and
  make then undo one safe score correction.
- Observe one real automatic publication and one real manual-cut publication on
  release `9e53da3318b…`; require current projection health and one publication
  receipt for each.
- Keep `canonical_score_commands` account-scoped. Do not enable ordinary users
  while validating readers.

Current status: the production corpus gate is complete. On September 16, 2026,
all 216 matches and all 12,827 nonempty point rows matched the legacy fold with
zero invalid rows and zero field differences. Reader activation remains blocked
on the native authenticated check and one observed automatic plus manual-cut
publication; corpus parity alone does not authorize a display switch.

## Foundation checkpoint

The phase-three foundation is implemented on branch
`codex/canonical-score-state` but is not deployed or activated. It adds the
default-off `canonical_score_readers` canary and the narrow
`canonical_score_snapshot_v1` RPC, plus typed web and native loaders that pin
the expected match revision, fail back to the established fold, and emit only
aggregate parity counts or stable fallback reasons. Web and native displays do
not consume canonical state yet. Owner and admin web shadows now reconstruct
their legacy oracle through one shared adapter. Match-library shadows use the
bounded `canonical_score_summaries_v1` batch instead of one RPC per card; the
batch omits inaccessible, missing and stale rows together, never repairs state,
and emits no match identifiers. The same shared chunked diagnostic now covers
accepted-coach student match cards, preserving their existing score display and
access rules while measuring parity through the coach's own session. Aggregate
stats now shadows the same per-match games and completion facts for non-neutral
matches. Migration `20260916151000_stats_game_winner_fingerprint.sql` also
closes a legacy drift hole: manually named game winners are downloaded and
hashed, and a partial network fetch is neither displayed as fresh stats nor
cached under a current fingerprint.

Public match and automatic-highlight pages now have a dormant, service-only
shadow boundary in `20260916153000_canonical_share_score_shadow.sql`. It
requires the existing live score-visible token and the match owner's reader
canary, then returns one locked canonical revision with the exact active-version
legacy source used for comparison. Public roles cannot execute the RPC, the
rendered page still uses the established fold, and telemetry contains only
aggregate counts or stable fallback codes.

Verified on September 16, 2026:

- Full isolated PostgreSQL scoring suite: 98/98, including owner,
  accepted-coach, admin, stranger and anonymous reader boundaries, plus proof
  that stale reads do not repair or mutate projection state. The batch reader
  also rejects requests above 250 ids and denies anonymous execution.
- Production-sized rehearsal: 220 matches and 19,800 points; migrations in
  2.10 seconds; existing commands at 16.015 ms p50 and 18.323 ms p95. The
  owner, coach, stranger, stale-state, oversized batch and stats-fingerprint
  invalidation cases all passed.
- Complete native behavior suite: 1,230/1,230.
- Full iPhone 18 Pro simulator target build: succeeded.
- Full production Next.js build: succeeded. Existing unrelated lint warnings
  remain; this reader change adds none.
- Public-share role, revoked-token, owner-canary, stale-state and no-repair
  cases pass in isolated PostgreSQL. The production-sized rehearsal also
  exercises one 89-visible-point live-token shadow through the service role.

This checkpoint does not satisfy the entry gate above. Do not apply migrations
`20260916143000`, `20260916151000` or `20260916153000`, deploy these readers,
or enable the reader canary merely because the automated foundation is green.

## Migration order

1. Add one shared, typed canonical snapshot loader for authenticated owner,
   coach and admin contexts. Preserve the existing token-scoped public contract;
   do not expose private provenance or mutation receipts.
2. Shadow-read canonical and legacy state on web scorekeeper and native iOS.
   Compare point order, display number, game, score before/after, resolved
   server, boundary and match games. Emit counts and sanitized rule codes only.
3. Build a production corpus covering lets, skips, server overrides, explicit
   boundaries, deleted/restored points, Split/Unsplit/Join/Adjust/Insert,
   manual-cutter matches and null-time legacy rows. Require zero unexplained
   differences before any display switch.
4. Switch owner scorekeeper and match detail first behind a separate
   account-scoped reader flag. Score commands continue returning the complete
   canonical snapshot; Undo and conflict recovery must not refetch a different
   revision.
5. Switch coach, share, statistics, placement, highlights, reels and exports in
   that order. Each consumer must pin one score revision for the whole response
   or artifact and retain its existing authorization boundary.
6. Keep the legacy fold and direct-write compatibility through at least one
   supported native release aging window. Measure old direct-write traffic
   before revoking grants; do not infer safety from a release date.

## Required verification

- Real PostgreSQL role/RLS and stale-revision tests for owner, coach, admin,
  anonymous token and worker roles.
- Web desktop and 393×660 mobile rendered checks; native simulator functional
  checks for owner mutations and coach read-only state.
- Revision-consistent public/share/export tests with no private fields.
- Full `npm run build`, `bash ios/Tests/run.sh`, canonical parity fixtures and
  worker publication suites.
- A production account canary with zero unexplained reader differences before
  widening the reader flag.

## Rollback

Reader selection must have its own account-scoped flag, separate from
`canonical_score_commands`. Turning the reader flag off returns displays and
downstream consumers to the established fold without disabling atomic writes or
deleting projections. Any mismatch freezes widening, records only a sanitized
rule code and revision, and is resolved in the shared fixture before another
surface changes.
