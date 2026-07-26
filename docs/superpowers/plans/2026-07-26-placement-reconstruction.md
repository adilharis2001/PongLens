# Placement Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace misleading bounce-only placement maps with dual-server, confidence-scored shot reconstructions, render them honestly, and generate a full Vaibhab-match before/after evaluation.

**Architecture:** A focused Python module extracts side-neutral visual/audio event candidates and solves legal near-server and far-server hypotheses. The worker stores placement v3 with both hypotheses; a pure TypeScript selector chooses the app-confirmed server hypothesis and builds safe render segments. The existing React map renders v1/v2 unchanged and uses the safe model for v3.

**Tech Stack:** Python 3.12, NumPy, OpenCV, `unittest`; Next.js 15, React 19, TypeScript 5, Node 25 built-in test runner.

## Global Constraints

- Do not replace BlurBall or add a new ball-detection model.
- Do not require audio; accept optional impact timestamps only.
- Do not project airborne racket contacts through the table homography.
- Do not mutate production data during implementation or evaluation.
- Preserve v1 and v2 placement rendering.
- Prefer `review` or `unavailable` over a confident impossible map.
- Use the confirmed server only to select a stored physical-server hypothesis.
- Do not commit the original Vaibhab video or full raw BlurBall output.

---

## File Structure

- `worker/placement_reconstruction.py`: side-neutral candidate extraction, legal sequence solver, confidence rules, placement-v3 serialization.
- `worker/tests/test_placement_reconstruction.py`: focused unit tests for extraction, server hypotheses, terminal events, and contradictions.
- `worker/tests/fixtures/vaibhab_points.json`: compact per-point detections, calibration, optional impact times, and shot-level expectations for points 1–5.
- `worker/points_pipeline.py`: calls placement reconstruction and writes placement v3 while leaving clip/suggestion behavior intact.
- `worker/eval/render_placement_match.py`: runs a stored match through v3 and writes a standalone before/after HTML report.
- `src/lib/types.ts`: placement-v3 TypeScript contract.
- `src/lib/placement/placementModel.ts`: pure confirmed-server hypothesis selection and safe render-model construction.
- `src/lib/placement/placementModel.test.ts`: Node built-in tests for selection, confidence, terminal rendering, and filtered context.
- `src/app/match/[id]/PlacementMap.tsx`: v3 React renderer and honest review/unavailable states.
- `src/app/match/[id]/PlacementAggregate.tsx`: aggregate support for selected ready/review v3 landings.
- `package.json`: local TypeScript placement-test command.

---

### Task 1: Side-neutral event candidates

**Files:**
- Create: `worker/placement_reconstruction.py`
- Create: `worker/tests/__init__.py`
- Create: `worker/tests/test_placement_reconstruction.py`

**Interfaces:**
- Consumes: BlurBall detections `dict[int, tuple[float, float]]`, homography `numpy.ndarray`, length axis `tuple[float, float]`, frame interval, fps, frame width, optional `[{t, confidence}]`.
- Produces: `extract_candidates(det, H, e, f0, f1, fps, width, audio_impacts) -> list[dict]` with stable `id`, `t`, `kinds`, nullable `u/v`, and visual/audio confidence.

- [ ] **Step 1: Write failing tests for jump rejection, bounce/contact separation, and audio support**

```python
import unittest
import numpy as np

from worker.placement_reconstruction import extract_candidates


class CandidateExtractionTest(unittest.TestCase):
    def test_rejects_impossible_jump_before_event_extraction(self):
        det = {
            0: (100.0, 100.0),
            1: (110.0, 105.0),
            2: (900.0, 800.0),
            3: (120.0, 110.0),
        }
        events = extract_candidates(
            det, np.eye(3), (1.0, 0.0), 0, 4, 30.0, 1920, []
        )
        self.assertTrue(all(abs(e.get("x", 0) - 900.0) > 1 for e in events))

    def test_preserves_close_bounce_and_contact_as_distinct_candidates(self):
        det = {
            0: (100.0, 100.0), 1: (110.0, 110.0),
            2: (120.0, 125.0), 3: (130.0, 110.0),
            4: (140.0, 100.0), 5: (110.0, 95.0),
            6: (80.0, 90.0),
        }
        events = extract_candidates(
            det, np.eye(3), (1.0, 0.0), 0, 7, 30.0, 1920,
            [{"t": 5 / 30, "confidence": 4.0}],
        )
        self.assertTrue(any("table_bounce" in e["kinds"] for e in events))
        self.assertTrue(any("paddle_contact" in e["kinds"] for e in events))
```

- [ ] **Step 2: Run the candidate tests and verify import failure**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_placement_reconstruction.CandidateExtractionTest -v
```

Expected: FAIL because `worker.placement_reconstruction` does not exist.

- [ ] **Step 3: Implement extraction with explicit track chunks**

```python
def split_track_chunks(det, f0, f1, width):
    jump_limit = 180.0 * width / 1920.0
    chunks, current = [], []
    for frame in range(f0, f1):
        if frame not in det:
            if current:
                chunks.append(current)
                current = []
            continue
        point = det[frame]
        if current:
            prev_frame, prev_point = current[-1]
            gap = frame - prev_frame
            speed = math.hypot(
                point[0] - prev_point[0], point[1] - prev_point[1]
            ) / max(gap, 1)
            if speed > jump_limit:
                chunks.append(current)
                current = []
        current.append((frame, point))
    if current:
        chunks.append(current)
    return [chunk for chunk in chunks if len(chunk) >= 4]
```

Implement `extract_candidates` so:

- bounce candidates are consecutive-frame local-y maxima;
- contact candidates use the maximum signed velocity discontinuity in a
  reversal interval rather than the interval center;
- an audio impact within `0.09s` raises confidence and is recorded as
  `audio_confidence`;
- candidates within `0.035s` of each other are deduplicated only when their
  candidate kinds overlap;
- table `u/v` are set only when the candidate projects inside
  `u=-0.08..1.585`, `v=-0.08..2.95`.

- [ ] **Step 4: Run the candidate tests**

Run the command from Step 2.

Expected: all `CandidateExtractionTest` tests PASS.

- [ ] **Step 5: Commit candidate extraction**

```bash
git add worker/placement_reconstruction.py worker/tests
git commit -m "Add placement event candidate extraction"
```

---

### Task 2: Legal dual-server reconstruction

**Files:**
- Modify: `worker/placement_reconstruction.py`
- Modify: `worker/tests/test_placement_reconstruction.py`

**Interfaces:**
- Consumes: `list[dict]` from `extract_candidates`, existing worker suggestion, track segments, `server_side: Literal["near", "far"]`.
- Produces:
  - `solve_hypothesis(candidates, server_side, suggestion, track_segments) -> {"status", "confidence", "reasons", "shots"}`
  - `reconstruct_placement(det, H, e, track, suggestion, f0, f1, fps, width, audio_impacts) -> {"v": 3, "status", "candidates", "hypotheses"}`

- [ ] **Step 1: Write failing tests for server legality and terminal ownership**

```python
class ReconstructionTest(unittest.TestCase):
    @staticmethod
    def event(event_id, t, kind, u=None, v=None, side=None):
        return {
            "id": event_id,
            "t": t,
            "kinds": [kind],
            "u": u,
            "v": v,
            "side": side,
            "visual_confidence": 0.9,
            "audio_confidence": None,
        }

    def test_serve_second_bounce_must_be_on_receiver_half(self):
        candidates = [
            self.event("e1", 1.0, "table_bounce", u=0.4, v=2.2),
            self.event("e2", 1.3, "table_bounce", u=0.7, v=0.6),
        ]
        far = solve_hypothesis(candidates, "far", None, [])
        near = solve_hypothesis(candidates, "near", None, [])
        self.assertEqual(far["shots"][0]["phase"], "serve")
        self.assertEqual(far["shots"][0]["landing"]["event_id"], "e2")
        self.assertIn("serve_second_bounce_on_server_half", near["reasons"])

    def test_terminal_out_belongs_to_last_contact_not_previous_landing(self):
        candidates = [
            self.event("s1", 1.0, "table_bounce", u=0.4, v=2.2),
            self.event("s2", 1.3, "table_bounce", u=0.7, v=0.6),
            self.event("r1", 1.7, "paddle_contact", side="near"),
            self.event("r2", 2.0, "table_bounce", u=0.8, v=2.1),
            self.event("x1", 2.4, "paddle_contact", side="far"),
            self.event("x2", 2.8, "out", side="far"),
        ]
        result = solve_hypothesis(candidates, "far", None, [])
        self.assertEqual(result["shots"][-1]["hitter_side"], "far")
        self.assertEqual(result["shots"][-1]["terminal"]["kind"], "out")
        self.assertIsNone(result["shots"][-1]["landing"])
```

- [ ] **Step 2: Run `ReconstructionTest` and verify missing symbols**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_placement_reconstruction.ReconstructionTest -v
```

Expected: FAIL because `solve_hypothesis` and the test `event` helper do not
exist.

- [ ] **Step 3: Implement the legal sequence solver**

Implement these exact public signatures:

```python
def solve_hypothesis(candidates, server_side, suggestion, track_segments):
    ordered = sorted(candidates, key=lambda candidate: candidate["t"])
    beam = [_seed_state(server_side)]
    for candidate in ordered:
        advanced = []
        for state in beam:
            advanced.append(state)
            advanced.extend(_advance_state(state, candidate, suggestion))
        beam = sorted(
            _dedupe_states(advanced),
            key=lambda state: state["score"],
            reverse=True,
        )[:24]
    return _finish_hypothesis(
        max(beam, key=lambda state: state["score"]),
        ordered,
        suggestion,
        track_segments,
    )


def reconstruct_placement(
    det, H, e, track, suggestion, f0, f1, fps, width, audio_impacts=None
):
    candidates = extract_candidates(
        det, H, e, f0, f1, fps, width, audio_impacts or []
    )
    hypotheses = {
        side: solve_hypothesis(candidates, side, suggestion, track["segments"])
        for side in ("near", "far")
    }
    statuses = {h["status"] for h in hypotheses.values()}
    return {
        "v": 3,
        "status": "ready" if "ready" in statuses else
                  "review" if "review" in statuses else "unavailable",
        "candidates": candidates,
        "hypotheses": hypotheses,
    }
```

Use a monotonic beam of at most 24 states. A state records expected player,
serve phase, shots, score, and reasons. Candidate transitions enforce:

- first and second serve bounces occur on opposite halves;
- rally paddle contacts alternate players;
- a table landing occurs on the receiver's half;
- a later supported contact or bounce penalizes a proposed terminal;
- terminal ownership comes from the latest contact, never the latest bounce.

Return `ready` at confidence `>=0.72` with no hard reason, `review` at
`>=0.42`, otherwise `unavailable`. Normalize confidence with
`1 / (1 + exp(-score / 4))`.

Implement `_seed_state(server_side)`, `_advance_state(state, candidate,
suggestion)`, `_dedupe_states(states)`, and `_finish_hypothesis(state,
candidates, suggestion, track_segments)` in the same module. Their concrete
state keys are `expected_hitter`, `serve_bounces`, `shots`, `score`,
`reasons`, and `hard_reasons`. `_advance_state` returns copied states and
never mutates its input.

- [ ] **Step 4: Run all Python reconstruction tests**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  discover -s worker/tests -v
```

Expected: PASS.

- [ ] **Step 5: Commit legal reconstruction**

```bash
git add worker/placement_reconstruction.py worker/tests/test_placement_reconstruction.py
git commit -m "Reconstruct legal placement shot sequences"
```

---

### Task 3: Vaibhab five-point regression fixture

**Files:**
- Create: `worker/tests/fixtures/vaibhab_points.json`
- Modify: `worker/tests/test_placement_reconstruction.py`
- Create: `worker/eval/build_vaibhab_fixture.py`

**Interfaces:**
- Consumes: a local `match.json`, BlurBall JSONL, and optional impact JSON.
- Produces: compact fixture with only frames inside points 1–5, calibration,
  source metadata, server truth, impacts, and expected shot assertions.

- [ ] **Step 1: Write the failing fixture regression test**

```python
class VaibhabRegressionTest(unittest.TestCase):
    @staticmethod
    def load_fixture(name):
        path = Path(__file__).parent / "fixtures" / name
        return json.loads(path.read_text())

    @staticmethod
    def reconstruct_fixture_point(fixture, point):
        det = {
            int(frame): tuple(coords)
            for frame, coords in point["detections"].items()
        }
        H = np.asarray(fixture["homography"], dtype=np.float32)
        return reconstruct_placement(
            det, H, tuple(fixture["length_axis"]),
            point["track"], point["suggestion"],
            point["f0"], point["f1"], fixture["fps"], fixture["width"],
            point["audio_impacts"],
        )

    def test_five_narrated_points_never_render_impossible_serve(self):
        fixture = self.load_fixture("vaibhab_points.json")
        for point in fixture["points"]:
            placement = self.reconstruct_fixture_point(fixture, point)
            hypothesis = placement["hypotheses"][point["server_side"]]
            self.assertNotIn(
                "serve_second_bounce_on_server_half", hypothesis["reasons"]
            )
            self.assertIn(hypothesis["status"], {"ready", "review"})

    def test_expected_terminal_kinds(self):
        fixture = self.load_fixture("vaibhab_points.json")
        expected = {1: "out", 2: "net", 3: "winner_landing",
                    4: "out", 5: "winner_landing"}
        for point in fixture["points"]:
            hypothesis = self.reconstruct_fixture_point(
                fixture, point
            )["hypotheses"][point["server_side"]]
            if hypothesis["status"] == "ready":
                self.assertEqual(
                    hypothesis["shots"][-1]["terminal"]["kind"]
                    if hypothesis["shots"][-1]["terminal"] else
                    "winner_landing",
                    expected[point["idx"]],
                )
```

- [ ] **Step 2: Run the fixture test and verify missing fixture failure**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_placement_reconstruction.VaibhabRegressionTest -v
```

Expected: FAIL with missing `vaibhab_points.json`.

- [ ] **Step 3: Implement the compact fixture builder**

The builder accepts:

```bash
python worker/eval/build_vaibhab_fixture.py \
  --match-json /tmp/ponglens-calibration-audit/r2/fd5c5d50-5797-4766-bee2-cffae64c7531.json \
  --blurball /tmp/ponglens-calibration-audit/vaibhab-blurball.jsonl \
  --output worker/tests/fixtures/vaibhab_points.json
```

Hard-code no local paths in the output. Store server truth:

```python
SERVER_TRUTH = {1: "far", 2: "near", 3: "near", 4: "far", 5: "far"}
TERMINAL_TRUTH = {
    1: "out", 2: "net", 3: "winner_landing",
    4: "out", 5: "winner_landing",
}
```

Store the already-measured optional impact times for points 1–5 under each
point's `audio_impacts`. The fixture is evidence, not production logic.

- [ ] **Step 4: Build the fixture and run all Python tests**

Run the builder command, then:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  discover -s worker/tests -v
```

Expected: PASS or an explicit `review` status for an unrecoverable visual gap;
no impossible serve passes as `ready`.

- [ ] **Step 5: Commit the regression fixture**

```bash
git add worker/eval/build_vaibhab_fixture.py worker/tests
git commit -m "Add Vaibhab placement regression fixture"
```

---

### Task 4: Worker placement-v3 integration

**Files:**
- Modify: `worker/points_pipeline.py`
- Modify: `worker/tests/test_placement_reconstruction.py`
- Modify: `worker/README.md`

**Interfaces:**
- Consumes: `reconstruct_placement(det, H, e, track, suggestion, f0, f1, fps, width, audio_impacts)` from Task 2.
- Produces: placement v3 in each `match.json` point; no server attribution or
  production database behavior changes.

- [ ] **Step 1: Write a failing integration test around a synthetic track**

```python
class PipelineIntegrationTest(unittest.TestCase):
    def test_pipeline_builder_emits_both_server_hypotheses(self):
        synthetic_det = {
            0: (0.4, 2.0), 1: (0.4, 2.2), 2: (0.4, 2.0),
            3: (0.7, 0.5), 4: (0.7, 0.7), 5: (0.7, 0.5),
        }
        synthetic_track = {"segments": [], "bounces": [], "hits": []}
        placement = build_placement_v3(
            det=synthetic_det,
            H=np.eye(3),
            e=(1.0, 0.0),
            track=synthetic_track,
            suggestion={"winner": "user", "how": "clean winner"},
            f0=0, f1=20, fps=30.0, width=1920,
            audio_impacts=[],
        )
        self.assertEqual(placement["v"], 3)
        self.assertEqual(set(placement["hypotheses"]), {"near", "far"})
```

- [ ] **Step 2: Run the integration test and verify failure**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_placement_reconstruction.PipelineIntegrationTest -v
```

Expected: FAIL because `build_placement_v3` is not exported.

- [ ] **Step 3: Wire reconstruction into `cmd_points`**

Import and expose:

```python
from placement_reconstruction import reconstruct_placement


def build_placement_v3(
    det, H, e, track, suggestion, f0, f1, fps, width, audio_impacts=None
):
    return reconstruct_placement(
        det, H, e, track, suggestion, f0, f1, fps, width,
        audio_impacts=audio_impacts,
    )
```

Replace only the placement builder call:

```python
if args.placement and track and H is not None:
    placement = build_placement_v3(
        det, H, e, track, suggestion, a, b, fps, meta["width"], []
    )
```

Keep `points.server` null. Change `match_json.version` to `3` and document
that audio impacts are currently optional/empty in production.

- [ ] **Step 4: Run Python tests and compile both worker files**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  discover -s worker/tests -v
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m py_compile \
  worker/placement_reconstruction.py worker/points_pipeline.py
```

Expected: PASS.

- [ ] **Step 5: Commit worker integration**

```bash
git add worker/points_pipeline.py worker/placement_reconstruction.py \
  worker/tests worker/README.md
git commit -m "Emit confidence-scored placement v3"
```

---

### Task 5: TypeScript hypothesis selection and safe render model

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/placement/placementModel.ts`
- Create: `src/lib/placement/placementModel.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: placement v3 and `serverPhysicalSide: "near" | "far" | null`.
- Produces:
  - `selectPlacementHypothesis(placement, serverSide)`
  - `buildPlacementRenderModel(hypothesis, filters)`
  - render shots with explicit origin, landing/terminal, visibility, and
    context flags.

- [ ] **Step 1: Add the Node test command and failing tests**

Add:

```json
"test:placement": "node --test --experimental-strip-types src/lib/placement/*.test.ts"
```

Test:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlacementRenderModel,
  selectPlacementHypothesis,
} from "./placementModel.ts";

test("confirmed server selects the matching physical hypothesis", () => {
  assert.equal(selectPlacementHypothesis(PLACEMENT, "far")?.serverSide, "far");
});

test("unknown server does not guess when confidence margin is small", () => {
  assert.equal(selectPlacementHypothesis(CLOSE_PLACEMENT, null), null);
});

test("non-serve first shot never receives a server origin", () => {
  const model = buildPlacementRenderModel(NON_SERVE, ALL_FILTERS);
  assert.equal(model.segments[0].from, null);
});

test("filtered prior shot is retained as faint context", () => {
  const model = buildPlacementRenderModel(THREE_SHOTS, {
    serve: false, rally: false, final: true,
  });
  assert.equal(model.segments.at(-1)?.fromContext, true);
});
```

- [ ] **Step 2: Run the TypeScript tests and verify import failure**

Run:

```bash
npm run test:placement
```

Expected: FAIL because `placementModel.ts` does not exist.

- [ ] **Step 3: Add placement-v3 types**

Define:

```typescript
export type PlacementStatus = "ready" | "review" | "unavailable";
export type PlacementTerminalKind =
  | "net" | "out" | "winner_landing" | "no_return";

export interface PlacementShotV3 {
  seq: number;
  hitter_side: "near" | "far";
  phase: "serve" | "rally" | "final";
  contact_t: number | null;
  confidence: number;
  landing: {
    event_id: string;
    t: number;
    u: number;
    v: number;
    confidence: number;
  } | null;
  terminal: {
    kind: PlacementTerminalKind;
    t: number;
    direction: { du: number; dv: number } | null;
    confidence: number;
  } | null;
}
```

Add `PlacementV3` to the existing `Placement` union.

- [ ] **Step 4: Implement the pure selector and render model**

Selection rules:

```typescript
if (serverSide) return hypothesisFor(serverSide);
if (best.status === "unavailable") return null;
if (best.confidence - second.confidence < 0.18) return null;
return best;
```

Render rules:

- server origin only when `phase === "serve"` and `landing !== null`;
- terminal out/net segment belongs to that shot;
- filtered predecessor becomes `fromContext: true`;
- `hiddenCounts` reports serve/rally/final counts;
- unavailable hypotheses produce no segments.

- [ ] **Step 5: Run placement tests and TypeScript checking**

Run:

```bash
npm run test:placement
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit the frontend model**

```bash
git add package.json src/lib/types.ts src/lib/placement
git commit -m "Add placement v3 frontend model"
```

---

### Task 6: Honest v3 point and aggregate rendering

**Files:**
- Modify: `src/app/match/[id]/PlacementMap.tsx`
- Modify: `src/app/match/[id]/PlacementAggregate.tsx`
- Modify: `src/lib/placement/placementModel.test.ts`

**Interfaces:**
- Consumes: Task 5 selector/render model.
- Produces: v3 point map, review/unavailable messaging, terminal lines, safe
  filtering, and v3 aggregate landings.

- [ ] **Step 1: Add failing render-model assertions**

```typescript
test("terminal out renders after the preceding landing and belongs to hitter", () => {
  const model = buildPlacementRenderModel(OUT_HYPOTHESIS, ALL_FILTERS);
  const last = model.segments.at(-1);
  assert.equal(last?.terminal?.kind, "out");
  assert.equal(last?.hitterSide, "far");
  assert.equal(last?.to, null);
});

test("hidden counts expose filtered rally context", () => {
  const model = buildPlacementRenderModel(THREE_SHOTS, {
    serve: true, rally: false, final: true,
  });
  assert.equal(model.hiddenCounts.rally, 1);
});
```

- [ ] **Step 2: Run tests and verify the new assertions fail**

Run:

```bash
npm run test:placement
```

Expected: FAIL until the full terminal/hidden-count model is implemented.

- [ ] **Step 3: Add `PlacementMapV3`**

In `PlacementMap.tsx`:

- detect v3 with `p.v === 3`;
- select with `serverPhysicalSide`;
- show "Confirm who served to unlock this map" when selection is ambiguous;
- show "Placement needs review" for `review`;
- show "We couldn't map this point reliably" for `unavailable`;
- draw landing segments from explicit model origins;
- draw net/out terminal dashed segments and `X`;
- show `N rally events hidden` when phase filters hide context;
- initialize phase filters to all true for every point instead of reading a
  global persisted phase selection.

Do not modify the v1/v2 drawing paths except to share small primitives.

- [ ] **Step 4: Extend aggregate extraction**

For v3, select the hypothesis with the physical server for that point and
aggregate only shots with non-null landings and hypothesis status
`ready` or `review`. Do not infer whose serve from landing position; use
`hitter_side`.

- [ ] **Step 5: Run frontend verification**

Run:

```bash
npm run test:placement
npx tsc --noEmit
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit honest rendering**

```bash
git add src/app/match/\\[id\\]/PlacementMap.tsx \
  src/app/match/\\[id\\]/PlacementAggregate.tsx \
  src/lib/placement/placementModel.test.ts
git commit -m "Render placement v3 honestly"
```

---

### Task 7: Full Vaibhab match rerender report

**Files:**
- Create: `worker/eval/render_placement_match.py`
- Modify: `worker/tests/test_placement_reconstruction.py`

**Interfaces:**
- Consumes: source `match.json`, BlurBall JSONL, optional audio-impact JSON,
  and optional point-to-server-side JSON.
- Produces: `/tmp/ponglens-placement-v3/vaibhab/index.html`,
  `reconstructed-match.json`, and per-point SVG maps.

- [ ] **Step 1: Write a failing evaluator smoke test**

```python
class RenderReportTest(unittest.TestCase):
    def test_report_contains_every_point_and_both_versions(self):
        report = build_report(SMALL_MATCH, SMALL_RECONSTRUCTIONS)
        self.assertIn("Current v2", report)
        self.assertIn("Placement v3", report)
        self.assertEqual(report.count('class="point-row"'), 2)
```

- [ ] **Step 2: Run the smoke test and verify failure**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_placement_reconstruction.RenderReportTest -v
```

Expected: FAIL because `render_placement_match.py` does not exist.

- [ ] **Step 3: Implement standalone report generation**

CLI:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/eval/render_placement_match.py \
  --match-json /tmp/ponglens-calibration-audit/r2/fd5c5d50-5797-4766-bee2-cffae64c7531.json \
  --blurball /tmp/ponglens-calibration-audit/vaibhab-blurball.jsonl \
  --server-truth worker/tests/fixtures/vaibhab_points.json \
  --output /tmp/ponglens-placement-v3/vaibhab
```

The report must:

- process every point in the match;
- render current v2 and selected v3 side by side;
- show hypothesis status, confidence, and reasons;
- use narrated server truth for points 1–5 and mark later server selection
  as inferred unless a supplied mapping exists;
- include summary counts for ready/review/unavailable and impossible serves;
- never write to Supabase or R2.

- [ ] **Step 4: Generate the report**

Run the CLI above.

Expected files:

```text
/tmp/ponglens-placement-v3/vaibhab/index.html
/tmp/ponglens-placement-v3/vaibhab/reconstructed-match.json
/tmp/ponglens-placement-v3/vaibhab/point-01.svg
/tmp/ponglens-placement-v3/vaibhab/point-17.svg
```

- [ ] **Step 5: Open and visually inspect the report**

Open `index.html` in the browser. Verify:

- points 1–5 satisfy the fixture assertions or visibly say Needs review;
- no serve confidently ends on the known server's half;
- no final segment begins at an invisible point;
- all 17 points are present.

- [ ] **Step 6: Commit the evaluator**

```bash
git add worker/eval/render_placement_match.py \
  worker/tests/test_placement_reconstruction.py
git commit -m "Add full-match placement comparison report"
```

---

### Task 8: Final verification and handoff

**Files:**
- Modify only if verification exposes an in-scope defect.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified branch and local Vaibhab comparison artifact.

- [ ] **Step 1: Run the full Python placement suite**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  discover -s worker/tests -v
```

Expected: PASS.

- [ ] **Step 2: Run frontend tests, type check, lint, and production build**

```bash
npm run test:placement
npx tsc --noEmit
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 3: Re-run the full-match report from a clean output directory**

```bash
mkdir -p /tmp/ponglens-placement-v3/vaibhab-final
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/eval/render_placement_match.py \
  --match-json /tmp/ponglens-calibration-audit/r2/fd5c5d50-5797-4766-bee2-cffae64c7531.json \
  --blurball /tmp/ponglens-calibration-audit/vaibhab-blurball.jsonl \
  --server-truth worker/tests/fixtures/vaibhab_points.json \
  --output /tmp/ponglens-placement-v3/vaibhab-final
```

Expected: all 17 point rows and zero confidently impossible known-server
serves.

- [ ] **Step 4: Inspect git state and commit any final in-scope corrections**

```bash
git status --short
git log --oneline -8
```

Expected: clean worktree after final corrections are committed.
