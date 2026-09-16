# Canonical scored-match commands rollout

PongLens now has one revisioned database interpretation of a scored match and
one typed mutation boundary shared by web and native iOS. Manual-cutter and
automatic worker publication finish their point batch, canonical projection
and ready state atomically. The release remains inert until an account-scoped
capability is enabled, so database, web, iOS and worker changes can land without
switching ordinary player traffic.

## Included

| Surface | Change |
| --- | --- |
| Database | Private score and point projections, normalized timing observations, idempotent typed score/structure commands, worker publication receipts and sanitized admin diagnostics. |
| Web | Score, Undo, first server, server override, game boundary, Split, Unsplit, Join, Adjust, Insert, delete and restore share one serialized revision clock when enabled. |
| Native iOS | The same score and structural operations use the same commands and reconcile conflicts from a complete returned snapshot. |
| Manual cutter | `t0`/`t1` publish as source-clock owner ground truth with provenance; ready status is in the same transaction. |
| Automatic worker | Complete point batches finalize once into canonical state; sealed packages declare and verify the required database contract before accepting work. |
| Admin | Upload Detail adds one fact in the existing “How this was processed” grid with projection status, revision, safe counts and sanitized last action/error. |

Admin research labels remain separate and cannot change the owner’s score.
Machine-detected servers, winners, side changes and rally evidence remain
suggestions rather than owner truth. Existing readers keep their current data
path during this rollout.

## Safe order

1. Apply migrations `20260915190000` and `20260916120000` with
   `canonical_score_commands=off`.
2. Deploy the web/backend release. Confirm projection health in Upload Detail.
3. Install the verified worker package only after both worker lanes are idle.
   Confirm its release ID and database-contract acceptance before allowing a
   claim.
4. Ship the native build without enabling the capability globally.
5. Set the capability to `user:<Adil UUID>` and exercise every score and
   structural operation on web and native iOS. Require zero unexplained
   snapshot differences before widening the account list.

## Rollback

Disable canonical client writes immediately with:

```sql
update public.app_config
   set value = 'off'
 where key = 'canonical_score_commands';
```

New web and iOS clients then return to the established legacy writes. The
additive projection, timing evidence and mutation receipts remain intact for
diagnosis; no destructive database rollback is required. If the worker package
must be rolled back, drain both lanes and select the previously verified sealed
release. Do not run an older package that fails the active database contract.

## Verification record

- Isolated PostgreSQL canonical suite: 78/78, including admin/owner/coach/anon
  grants, automatic and manual publication, old-worker compatibility and
  forced rollback cases.
- Worker production-feature reconciliation: 176 focused detector/publication
  tests, 48 release/email/health tests, and 154 broader regression tests.
- Web, iOS, full build, production-like migration timing and production canary
  evidence are recorded here at the final release checkpoint.
