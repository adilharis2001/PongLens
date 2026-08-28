import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import test from "node:test";

import type {
  MatchStructureEvidence,
  Point,
  SideChangeEvidence,
} from "../../../lib/types.ts";
import type { GameBoundary } from "./gameScore.ts";
import {
  SCORE_BOUNDARY_SUPPRESS,
  visibleSideChanges,
  type SideChangeInput,
} from "./sideChanges.ts";

type TestPoint = SideChangeInput["visiblePoints"][number];

function pt(
  id: string,
  t1: number,
  override: Point["game_end_override"] = null,
  dismissed = false
): TestPoint {
  return {
    id,
    t1,
    game_end_override: override,
    side_change_dismissed: dismissed,
  };
}

/** N rallies, five seconds each, ids p0..p(n-1). */
function rallies(n: number): TestPoint[] {
  return Array.from({ length: n }, (_, i) => pt(`p${i}`, (i + 1) * 5));
}

function change(over: Partial<SideChangeEvidence> = {}): SideChangeEvidence {
  return {
    kind: "side_change",
    after_idx: 0,
    before_idx: 1,
    confidence: 0.9,
    confirmed: true,
    ...over,
  };
}

function evidence(
  changes: SideChangeEvidence[],
  status: MatchStructureEvidence["status"] = "ready"
): MatchStructureEvidence {
  return {
    version: 2,
    status,
    algorithm: "side-change-v2",
    side_changes: changes,
  };
}

function boundaries(...ids: string[]): Map<string, GameBoundary> {
  return new Map(
    ids.map((id, i) => [id, { game: i + 1, you: 11, them: 7 }])
  );
}

function run(over: Partial<SideChangeInput> = {}) {
  return visibleSideChanges({
    evidence: evidence([change({ after_point_id: "p5" })]),
    visiblePoints: rallies(20),
    boundaryAfter: new Map(),
    enabled: true,
    scoredType: true,
    ...over,
  });
}

// --- the gates ---------------------------------------------------------

test("the flag off draws nothing", () => {
  assert.deepEqual(run({ enabled: false }), []);
});

test("a practice match draws nothing", () => {
  assert.deepEqual(run({ scoredType: false }), []);
});

test("withheld evidence draws nothing", () => {
  const withheld = evidence([change({ after_point_id: "p5" })], "withheld");
  assert.deepEqual(run({ evidence: withheld }), []);
});

test("no evidence at all draws nothing", () => {
  assert.deepEqual(run({ evidence: null }), []);
});

test("an unconfirmed change is diagnostics, never a marker", () => {
  const mixed = evidence([
    change({ after_point_id: "p5", confirmed: false }),
    change({ after_point_id: "p12" }),
  ]);
  assert.deepEqual(
    run({ evidence: mixed }).map((m) => m.pointId),
    ["p12"]
  );
});

// --- anchoring ---------------------------------------------------------

test("a confirmed change anchors to its own point", () => {
  const [marker] = run();
  assert.equal(marker.pointId, "p5");
  assert.equal(marker.anchor, "point_id");
  assert.equal(marker.confidence, 0.9);
});

test("a deleted anchor point is recovered from the gap time", () => {
  // p5 ended at 30s and has since been deleted; the marker belongs after
  // the last rally that finished by then, which is now p4.
  const points = rallies(20).filter((p) => p.id !== "p5");
  const ev = evidence([change({ after_point_id: "p5", gap_t0: 30 })]);
  const [marker] = run({ visiblePoints: points, evidence: ev });
  assert.equal(marker.pointId, "p4");
  assert.equal(marker.anchor, "gap_time");
});

test("a change with nothing to anchor to is dropped, not guessed", () => {
  const ev = evidence([change({ after_point_id: "gone" })]);
  assert.deepEqual(run({ evidence: ev }), []);
});

test("a gap before the first rally anchors to nothing", () => {
  const ev = evidence([change({ after_point_id: "gone", gap_t0: 0.1 })]);
  assert.deepEqual(run({ evidence: ev }), []);
});

test("a change after the last rally has no between to sit in", () => {
  const ev = evidence([change({ after_point_id: "p19" })]);
  assert.deepEqual(run({ evidence: ev }), []);
});

// --- what silences a marker -------------------------------------------

test("a scored boundary on the same point silences it", () => {
  assert.deepEqual(run({ boundaryAfter: boundaries("p5") }), []);
});

test("a scored boundary three rallies away still silences it", () => {
  // Adil's rule: the score proves the boundary, so the detected one goes.
  // Three is the owner's own measured scoring drift.
  for (const id of ["p2", "p3", "p4", "p6", "p7", "p8"]) {
    assert.deepEqual(
      run({ boundaryAfter: boundaries(id) }),
      [],
      `boundary at ${id} should silence a marker at p5`
    );
  }
});

test("a scored boundary four rallies away does not silence it", () => {
  assert.equal(SCORE_BOUNDARY_SUPPRESS, 3);
  assert.deepEqual(
    run({ boundaryAfter: boundaries("p1") }).map((m) => m.pointId),
    ["p5"]
  );
  assert.deepEqual(
    run({ boundaryAfter: boundaries("p9") }).map((m) => m.pointId),
    ["p5"]
  );
});

test("an owner's pinned end nearby silences it", () => {
  const points = rallies(20);
  points[7] = pt("p7", 40, "end");
  assert.deepEqual(run({ visiblePoints: points }), []);
});

test("an owner's 'continue' silences it too, and makes no boundary", () => {
  // Rule 7, not rule 6: a 'continue' pin produces no boundary at all, so
  // the boundary test alone would let this through.
  const points = rallies(20);
  points[5] = pt("p5", 30, "continue");
  assert.deepEqual(run({ visiblePoints: points }), []);
});

test("dismissing hides that marker and nothing else", () => {
  const points = rallies(20);
  points[5] = pt("p5", 30, null, true);
  const ev = evidence([
    change({ after_point_id: "p5" }),
    change({ after_point_id: "p12" }),
  ]);
  assert.deepEqual(
    run({ visiblePoints: points, evidence: ev }).map((m) => m.pointId),
    ["p12"]
  );
});

// --- the behaviour Adil asked for -------------------------------------

test("an unscored match shows every detection", () => {
  const ev = evidence([
    change({ after_point_id: "p5" }),
    change({ after_point_id: "p11" }),
    change({ after_point_id: "p17" }),
  ]);
  assert.deepEqual(
    run({ evidence: ev }).map((m) => m.pointId),
    ["p5", "p11", "p17"]
  );
});

test("markers go quiet one at a time as the match gets scored", () => {
  const ev = evidence([
    change({ after_point_id: "p5" }),
    change({ after_point_id: "p11" }),
    change({ after_point_id: "p17" }),
  ]);
  // Game 1 scored out, and its boundary landed two rallies from the
  // detection — close enough that the score's own divider replaces it.
  assert.deepEqual(
    run({ evidence: ev, boundaryAfter: boundaries("p7") }).map((m) => m.pointId),
    ["p11", "p17"]
  );
  // Both scored: only the last detection is left.
  assert.deepEqual(
    run({ evidence: ev, boundaryAfter: boundaries("p7", "p11") })
      .map((m) => m.pointId),
    ["p17"]
  );
});

test("two detections cannot land on one rally", () => {
  const ev = evidence([
    change({ after_point_id: "p5" }),
    change({ after_point_id: "p5", after_idx: 9 }),
  ]);
  assert.equal(run({ evidence: ev }).length, 1);
});

// --- the fixture the Swift port is measured against -------------------

test("write the parity fixture", () => {
  // Readable ids inside the tests, UUIDs on the way out: MatchPoint.id is
  // a UUID on iOS, and a fixture the Swift side has to reshape before it
  // can read it is a fixture that can be reshaped wrongly.
  const uuids = new Map<string, string>();
  const asUuid = (id: string) => {
    let out = uuids.get(id);
    if (!out) {
      const n = uuids.size + 1;
      out = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      uuids.set(id, out);
    }
    return out;
  };
  const cases: unknown[] = [];
  const record = (name: string, input: SideChangeInput) => {
    const evidenceOut = input.evidence && {
      ...input.evidence,
      side_changes: (input.evidence.side_changes ?? []).map((c) => ({
        ...c,
        ...(c.after_point_id !== undefined
          ? { after_point_id: asUuid(c.after_point_id) }
          : {}),
      })),
    };
    cases.push({
      name,
      evidence: evidenceOut,
      points: input.visiblePoints.map((p) => ({ ...p, id: asUuid(p.id) })),
      boundary_after: [...input.boundaryAfter.keys()].map(asUuid),
      enabled: input.enabled,
      scored_type: input.scoredType,
      expect: visibleSideChanges(input).map((m) => ({
        ...m,
        pointId: asUuid(m.pointId),
      })),
    });
  };
  const base: SideChangeInput = {
    evidence: evidence([change({ after_point_id: "p5" })]),
    visiblePoints: rallies(20),
    boundaryAfter: new Map(),
    enabled: true,
    scoredType: true,
  };
  record("plain detection on an unscored match", base);
  record("flag off", { ...base, enabled: false });
  record("practice match", { ...base, scoredType: false });
  record("withheld evidence", {
    ...base,
    evidence: evidence([change({ after_point_id: "p5" })], "withheld"),
  });
  record("unconfirmed change", {
    ...base,
    evidence: evidence([change({ after_point_id: "p5", confirmed: false })]),
  });
  record("deleted anchor recovered from the gap", {
    ...base,
    visiblePoints: rallies(20).filter((p) => p.id !== "p5"),
    evidence: evidence([change({ after_point_id: "p5", gap_t0: 30 })]),
  });
  record("anchor gone with no gap", {
    ...base,
    evidence: evidence([change({ after_point_id: "gone" })]),
  });
  record("after the last rally", {
    ...base,
    evidence: evidence([change({ after_point_id: "p19" })]),
  });
  for (const id of ["p5", "p2", "p8"]) {
    record(`boundary at ${id} silences p5`, {
      ...base,
      boundaryAfter: boundaries(id),
    });
  }
  for (const id of ["p1", "p9"]) {
    record(`boundary at ${id} is too far to silence p5`, {
      ...base,
      boundaryAfter: boundaries(id),
    });
  }
  const pinned = rallies(20);
  pinned[7] = pt("p7", 40, "end");
  record("owner pinned an end nearby", { ...base, visiblePoints: pinned });
  const held = rallies(20);
  held[5] = pt("p5", 30, "continue");
  record("owner held the game open", { ...base, visiblePoints: held });
  const hidden = rallies(20);
  hidden[5] = pt("p5", 30, null, true);
  record("dismissed", {
    ...base,
    visiblePoints: hidden,
    evidence: evidence([
      change({ after_point_id: "p5" }),
      change({ after_point_id: "p12" }),
    ]),
  });
  const three = evidence([
    change({ after_point_id: "p5" }),
    change({ after_point_id: "p11" }),
    change({ after_point_id: "p17" }),
  ]);
  record("three detections, none scored", { ...base, evidence: three });
  record("three detections, first game scored", {
    ...base,
    evidence: three,
    boundaryAfter: boundaries("p7"),
  });
  record("three detections, two games scored", {
    ...base,
    evidence: three,
    boundaryAfter: boundaries("p7", "p11"),
  });

  const dir = "ios/Tests/fixtures";
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    `${dir}/side-change-markers.json`,
    `${JSON.stringify({ cases }, null, 1)}\n`
  );
  assert.ok(cases.length >= 18);
});
