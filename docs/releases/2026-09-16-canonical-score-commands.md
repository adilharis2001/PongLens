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

1. Apply migrations `20260915190000`, `20260916120000` and
   `20260916133000` with `canonical_score_commands=off`. The last migration
   makes the emergency switch authoritative for admins as well as players.
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

| Item | Production evidence on September 16, 2026 |
| --- | --- |
| Source | Phase-two source commit `41322bc44cb1da907b3cde5f5872fe45d53c6656`; rollback and corpus-audit hardening commit `3b113bff727dabde41515b457cc9b3f8a292aeb7`. |
| Database | Migrations `20260915190000`, `20260916120000` and `20260916133000` applied. All 216 matches have projections: 193 current matches and 23 intentional empty matches with zero visible points. Every source/projection revision agrees. |
| Capability | `canonical_score_commands=user:a2e61027-2ee9-4026-a058-dc07441ee633`. Ordinary accounts remain on legacy writes. In one rolled-back authenticated production transaction the allowlisted admin returned `true`, the temporary `off` value returned `false`, and the restored account value returned `true`; no live configuration or match rows changed. |
| Web | Vercel production deployment `dpl_Bt1zFgbiVBCSnryTp2vxCnaJ2yrq` reached READY for commit `3b113bff` and received the `www.ponglens.com`, `ponglens.com` and `ponglens.vercel.app` aliases. |
| Command canary | All 12 command families succeeded against an Adil-owned production match inside one authenticated transaction. The transaction was rolled back; revision `0` and 116 point rows were unchanged afterward. |
| Worker | Active release `9e53da3318b458ad0beb85fd9c953a7d21b8d885e0b7ab95d6a92dbdaa6da5ce` on both `main` and `fast`. The previous release `62295e48b91091b93ef796d2cf8688482d524af3df863f757b170f437d00fea1` was actually booted on both lanes, observed healthy and idle, drained, and replaced by the active release. Zero jobs were open throughout. |
| Native | 1,215 unit/parity checks passed and the complete reconciled simulator build succeeded. The canonical build installs and launches. Installing it cleared the simulator login, so authenticated production UI interaction remains a human acceptance check. |

Additional automated evidence:

- Isolated PostgreSQL canonical suite: 81/81, including admin/owner/coach/anon
  grants, automatic and manual publication, old-worker compatibility and
  forced rollback cases. The final capability test proves admins cannot bypass
  `off` or an account allowlist.
- Production-like database copy: 220 legacy matches, 19,800 points and five
  manual-cut drafts; 2.40-second migration; all 220 projections current; 900
  manual-cutter observations exact; command p50 16.329 ms and p95 20.336 ms
  over 100 commands.
- Production corpus: all 216 matches and all 12,827 nonempty point rows match
  the established legacy fold exactly. The audit ignores JSON object key order,
  reports only aggregate differences and exits nonzero on any invalid or
  mismatching row.
- Web: scorer 43/43, structure 141/141, scorecard 15/15, statistics 6/6,
  placement 120/120, lesson video 60/60, costs/admin 244/244, and the real
  production Next build.
- Worker package: claim-boundary 10/10, release 27/27, canonical publication
  16/16, frozen point parity 17/17, actual CoreML pose, table, ball and repeated
  side-change smoke checks, followed by a complete integrity recheck.

## Final production acceptance

Native build 220 is available to internal testers and Adil exercised Score,
Skip, Adjust, Split and Join on the Nathan vs Brian production match. The match
stood at source/projection revision 57 with status `current` and no error.
The join was one atomic `merge_points` command: it kept the first clip's start,
extended through the second clip's end, archived the joined row, preserved the
final point-end evidence and saved the selected opponent outcome in the same
mutation.

The final read-only audit found all 218 production matches current with matching
source/projection revisions and zero projection errors. Two real automatic
worker publications have completed through `replace_worker_points`; all 156
stored timing observations remain valid. Both Mac lanes and both Modal lanes
reported the intended `9e53da33...` Mac release, and the cloud twin reported its
matching `33ab83f0...` release. The latest web deployment built from `main` at
`1239953a`, completed successfully and holds all production aliases.

No further player-facing web, native or admin test is required for this
account-scoped rollout. The first naturally-created manual-cut publication is
still worth checking because no post-rollout live manual cut exists yet; do not
create or alter a production match solely to manufacture that evidence.

The capability remains `user:a2e61027-2ee9-4026-a058-dc07441ee633`. Widening it
to every account and migrating owner readers are separate product rollout
decisions, not unfinished implementation.

## Deferred native cleanup

The Scorekeeper shortcut that splits by answering the second point performs the
split and child score as two consecutive commands. If the second request alone
fails, the child remains visibly unanswered and the existing retry error is
shown; no incorrect score is silently stored. Modify Split and Join are already
atomic, so this should be folded into the next normal iOS build rather than
shipping a dedicated build 221.
