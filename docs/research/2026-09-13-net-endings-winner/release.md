# Net endings and private winner observations

The worker shortens a subset of net-associated dead-ball tails after existing body assembly. It records an independent camera-relative winner observation or explicit abstention for every newly processed card, privately and separately from the player's score. This release makes no new split/join decisions and does not change the owner UI.

| Contract | Final behavior |
|---|---|
| Starting source | Current availability worker f9aad58d, sealed e9c3cd9cb3bd536dc689bc3214e63085ec6e3d1de129c30cf3202a75d44e9552; newer app work must not be replaced by this worker branch. |
| Net evidence | At least two consecutive low bounces on one table half, with dense tracked observations, preceded by motion toward the calibrated net that substantially slows or reverses more slowly. This is visual evidence consistent with a net ending, not a measured physical collision. |
| Ending | Reviewed longer option: max(first bounce + 0.8s, confirming bounce + 0.2s), retaining existing export padding. Subsequent crossings prevent an end-only trim. First accepted split proposal leaves the whole card unchanged. |
| Continuation | Card count/order/start/serve unchanged. Existing joins and continuation protection remain authoritative. Malformed event arrays preserve the original cards and record errors. |
| Winner | Opposite the terminal bounce half. Abstain when a crossing follows the alleged net event or evidence suggests multiple rallies within the card. These guards incorporate reviewed failures; evaluation is overlapping validation, not an independent accuracy estimate. |
| Persistence | Private point_winner_predictions table, UUID FK to the actual point and version, immutable method/input identity, status/reason, original analysis context, final published bounds, actual applied source offset, source/job/release provenance. No human winner input. |
| Privacy | Default-deny RLS; no PUBLIC/anon/authenticated relation or column access. Service-only SELECT/INSERT/DELETE; private status view. Sidecar never uploaded or embedded in match.json. |
| Human edits | confirmed_winner and legacy suggestion unchanged. Timing edits mark observation stale in private status view; score edits leave it intact. Deleted points cascade, superseded versions remain distinct. |
| Coverage | Every automatic point gets an attempt record, including abstention. This net rule supplies a winner for a small subset; it does not yet predict every point or automatically score matches. No historical backfill. |

| Verification before packaging | Evidence |
|---|---|
| Frozen research replay | Exact extractor/proposal parity across 8 sources / 641 cards; 35 end trims; three split proposals preserved. |
| Full cached pipeline | Seven complete recordings / 583 cards, baseline vs candidate. Same starts, serves, count; 33 trimmed endings, 19 non-null winner predictions; distant Brian recording unchanged. |
| Encoded export | Four real-source Tomo cards including the continuous-rally control, 59.25s encoded and fully decoded. Measured cut offsets and end positions checked independently; source windows preserved. |
| Existing body/rally suite | 80 passed on baseline and candidate, three existing NumPy warnings. |
| New algorithm tests | 18 passed, including malformed evidence fail-open and owner-reviewed winner ambiguity. Independent review reproduced the invalid-crossing failure and verified its fix. |
| Private storage review | Five helper tests + seven subtests; eight real PostgreSQL tests + ten subtests. Client access denied, score isolation, stale windows, retry invariance, point versions, transaction failure verified. |
| Schema readiness | Eight local scenarios; expected schema accepted and unsafe grants/RLS/ledger states rejected. Forward preparation/drain gated on exact reviewed migration. |
| Web | Real npm run build passed in isolated worktree; no web deployment or native UI change. |
| Limits | Full candidate-reprocess worker execution is not covered: inherited test_match_reprocess refers to functions absent in this captured baseline. No new independent held-out accuracy claim or broad reduction in card splits. |

## Rollout record

| Item | State |
|---|---|
| Production activation | Pending final package, inference smokes and additive migration. |
| Recovery | Preserve complete signed current e9 launcher apps and three plists; drain before stopping, start paused, require fresh exact-ID pulses and monitor before resume. Keep additive storage schema on rollback; preserve mail capture. |
| Private local evidence | /private/tmp/ponglens-net-production-20260913; media, owner feedback and production snapshots stay local. |
