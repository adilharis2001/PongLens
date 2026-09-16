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
