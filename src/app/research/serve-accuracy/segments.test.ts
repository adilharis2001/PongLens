import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dedupeLandings } from "./offTable.ts";
import {
  TABLE_L_M,
  TABLE_W_M,
  type DetectedEvent,
} from "./serveAccuracyModel.ts";
import { findServe, recoverServe, serverSideFor } from "./serveRepair.ts";
import {
  flightsOf,
  isRecovered,
  joinsOf,
  repairEvents,
  segGeometry,
} from "./segments.ts";

/**
 * Six real points, with the ball track and the events the worker actually
 * stored — three the repair layer speaks on and three it must leave alone.
 *
 * The rule this file exists to obey is the one the mirrored placement maps
 * taught: a test that asserts what a transform returned cannot catch it
 * returning the wrong thing. So nothing here checks a number the code
 * produced. Every assertion is against something independent — the
 * worker's own detections, the physics of a bouncing ball, or the geometry
 * of the calibrated table.
 */

interface Fixture {
  key: string;
  winner: "user" | "opponent";
  server: "user" | "opponent" | null;
  userPhysicalSide: "near" | "far";
  clipT0: number;
  corners: Record<string, [number, number]>;
  source: { width: number; height: number };
  track: number[][];
  events: DetectedEvent[];
}

const POINTS: Fixture[] = JSON.parse(
  readFileSync(new URL("./fixtures/segments-corpus.json", import.meta.url), "utf8"),
);
const NET_V_M = TABLE_L_M / 2;
const halfOf = (v: number) => (v < NET_V_M ? "near" : "far");

test("the homography agrees with the worker's own projection", () => {
  let checked = 0;
  for (const p of POINTS) {
    const geo = segGeometry(p.corners);
    assert.ok(geo);
    for (const e of p.events) {
      if (e.u === null || e.v === null || e.x === null || e.y === null) continue;
      const [u, v] = geo.toTable(e.x, e.y);
      // The worker projected these pixels through its own homography years
      // before this file existed. Agreeing to a centimetre is the check
      // that the corners are being read the same way round.
      assert.ok(
        Math.hypot(u - e.u, v - e.v) < 0.01,
        `${p.key} at ${e.t}: ${u.toFixed(3)},${v.toFixed(3)} vs ${e.u},${e.v}`,
      );
      checked += 1;
    }
  }
  assert.ok(checked > 30, `only ${checked} events carried both readings`);
});

test("a join lands on the bounces the detector found independently", () => {
  let landings = 0, seen = 0;
  const off: number[] = [];
  for (const p of POINTS) {
    const geo = segGeometry(p.corners);
    assert.ok(geo);
    const joins = joinsOf(flightsOf(p.track, p.clipT0, p.source, geo), geo);
    for (const e of p.events) {
      if (e.kind !== "bounce" || e.u === null || e.v === null) continue;
      if (e.u < 0 || e.u > TABLE_W_M || e.v < 0 || e.v > TABLE_L_M) continue;
      landings += 1;
      const j = joins.find((x) => Math.abs(x.t - e.t) < 0.12 && x.kind !== "contact");
      if (!j) continue;
      seen += 1;
      off.push(Math.hypot(j.u - (e.u as number), j.v - (e.v as number)));
    }
  }
  assert.ok(landings > 80, `only ${landings} landings in the fixture`);
  assert.ok(seen / landings > 0.8, `joins found only ${seen} of ${landings}`);
  // Two independent readings of the same bounce. Over the whole corpus
  // they agree to 6.6 cm at the median and 26 cm at the ninetieth
  // percentile, with a thin tail beyond. The claim is about that
  // distribution, so that is what is asserted: a single outlier is
  // expected and is not what would signal a broken reading.
  off.sort((a, b) => a - b);
  const at = (f: number) => off[Math.floor(f * (off.length - 1))];
  assert.ok(at(0.5) < 0.12, `median disagreement ${at(0.5).toFixed(2)} m`);
  assert.ok(at(0.9) < 0.45, `p90 disagreement ${at(0.9).toFixed(2)} m`);
});

test("a recovered landing never doubles one the detector already found", () => {
  for (const p of POINTS) {
    const seen = dedupeLandings([...p.events].sort((a, b) => a.t - b.t));
    const repaired = repairEvents(
      p.events, p.track, p.corners, p.clipT0, p.source, {}, p.userPhysicalSide,
    );
    for (const e of repaired.filter(isRecovered)) {
      // The whole purpose of a recovered landing is to restore the
      // alternating sequence. One inserted next to a landing already in
      // that sequence would break it instead — silently, and in the exact
      // way the repair exists to fix.
      const clash = seen.find((x) => Math.abs(x.t - e.t) < 0.12);
      assert.equal(clash, undefined, `${p.key}: doubled the landing at ${e.t}`);
    }
  }
});

test("a recovered landing falls in a hole the rally predicts", () => {
  for (const p of POINTS) {
    const before = dedupeLandings([...p.events].sort((a, b) => a.t - b.t));
    const repaired = repairEvents(
      p.events, p.track, p.corners, p.clipT0, p.source, {}, p.userPhysicalSide,
    );
    for (const e of repaired.filter(isRecovered)) {
      assert.equal(e.kind, "bounce");
      assert.ok(e.v !== null && e.u !== null);
      // On the table, so the rules can read it as a landing at all.
      assert.ok((e.u as number) >= 0 && (e.u as number) <= TABLE_W_M);
      assert.ok((e.v as number) >= 0 && (e.v as number) <= TABLE_L_M);
      // And on the half the sequence had no landing on: the neighbours
      // either side must both be on the other half, which is the whole
      // reason its position was predictable.
      const mine = halfOf(e.v as number);
      const prev = before.filter((x) => x.t < e.t).pop();
      const next = before.find((x) => x.t > e.t);
      if (prev) assert.notEqual(halfOf(prev.v as number), mine, `${p.key} before`);
      if (next) assert.notEqual(halfOf(next.v as number), mine, `${p.key} after`);
    }
  }
});

test("a rally with no hole in it is left alone", () => {
  let untouched = 0;
  for (const p of POINTS) {
    const landings = dedupeLandings([...p.events].sort((a, b) => a.t - b.t));
    let alternates = landings.length > 1;
    for (let i = 1; i < landings.length; i++) {
      if (halfOf(landings[i].v as number) === halfOf(landings[i - 1].v as number)) {
        alternates = false;
      }
    }
    if (!alternates) continue;
    const repaired = repairEvents(
      p.events, p.track, p.corners, p.clipT0, p.source, {}, p.userPhysicalSide,
    );
    // A complete rally may still gain a landing after its last one — the
    // shot nobody returned — but never one in the middle, because there is
    // no gap there for the sequence to point at.
    const last = landings[landings.length - 1];
    for (const e of repaired.filter(isRecovered)) {
      assert.ok(e.t > last.t, `${p.key}: an event was inserted mid-rally`);
    }
    untouched += 1;
  }
  assert.ok(untouched > 0, "no complete rally in the fixture to check");
});

test("recovered landings are drawn the same way round as detected ones", () => {
  for (const p of POINTS) {
    const repaired = repairEvents(
      p.events, p.track, p.corners, p.clipT0, p.source, {}, p.userPhysicalSide,
    );
    for (const e of repaired.filter(isRecovered)) {
      assert.ok(e.nu !== null && e.nv !== null, `${p.key}: no map coordinates`);
      // The map is drawn from behind whoever is at the bottom, so a landing
      // on the user's own half is always in the near half of the picture.
      // Reading this backwards mirrored every map the app drew for eight
      // months; it is checked here rather than assumed.
      const ownHalf = halfOf(e.v as number) === p.userPhysicalSide;
      assert.equal(
        (e.nv as number) < NET_V_M, ownHalf,
        `${p.key}: v=${(e.v as number).toFixed(2)} drew at nv=${(e.nv as number).toFixed(2)}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// The serve
// ---------------------------------------------------------------------------

const W = TABLE_W_M;
const onTable = (e: { u: number | null; v: number | null }) =>
  e.u !== null && e.v !== null
  && e.u >= 0 && e.u <= W && e.v >= 0 && e.v <= TABLE_L_M;

test("a serve bounce is put back where the one it replaces actually was", () => {
  // Hold-out. Take a point where the detector found BOTH of the serve's
  // bounces, hide the landing, and ask the ball's flight to supply it.
  // Nothing here is compared against what this code produced: the answer
  // was measured by a different detector before this file existed.
  let tested = 0;
  for (const p of POINTS) {
    const side = serverSideFor(p.server, p.userPhysicalSide);
    const full = findServe(p.events, side);
    if (!full || full.recovered !== null) continue;
    const without = p.events.filter((e) => e.id !== full.landing.id);
    const rebuilt = recoverServe(
      without, p.track, p.corners, p.clipT0, p.source, side, p.userPhysicalSide,
    );
    // Hiding the landing can let a different detected pair pass the serve
    // geometry on its own. That is the plain rule working, not a recovery,
    // and it tests nothing here.
    if (rebuilt === null || rebuilt.recovered === null) continue;
    tested += 1;
    const off = Math.hypot(
      (rebuilt.landing.u as number) - (full.landing.u as number),
      (rebuilt.landing.v as number) - (full.landing.v as number),
    );
    assert.ok(off < 0.4, `${p.key}: put back ${off.toFixed(2)} m from where it was`);
  }
  assert.ok(tested >= 3, `only ${tested} serves actually held out`);
});

test("a recovered serve landing is on the table, never nudged onto its edge", () => {
  for (const p of POINTS) {
    const side = serverSideFor(p.server, p.userPhysicalSide);
    const serve = recoverServe(
      p.events, p.track, p.corners, p.clipT0, p.source, side, p.userPhysicalSide,
    );
    if (serve === null || serve.recovered === null) continue;
    assert.ok(onTable(serve.landing), `${p.key}: landing off the table`);
    // The bug this guards: recovered landings were clamped into the table,
    // so impulses that happened on the floor arrived at exactly u=0 or
    // v=0 and were accepted. Ten of twenty-one "recovered" serves were
    // sitting on a corner. A landing is on the table by its own reading or
    // it is not a landing.
    const u = serve.landing.u as number, v = serve.landing.v as number;
    const onEdge = u === 0 || u === W || v === 0 || v === TABLE_L_M;
    assert.equal(onEdge, false, `${p.key}: landing clamped to the edge at ${u}, ${v}`);
  }
});

test("a recovered serve still crosses the net, server's half first", () => {
  let seen = 0;
  for (const p of POINTS) {
    const side = serverSideFor(p.server, p.userPhysicalSide);
    if (side === null) continue;
    const serve = recoverServe(
      p.events, p.track, p.corners, p.clipT0, p.source, side, p.userPhysicalSide,
    );
    if (serve === null) continue;
    seen += 1;
    // Rule six, the guard against the invisible failure: if the rotation
    // is wrong every serve flips player at once, and the serve's own first
    // bounce is the second, independent read of who served. Recovering a
    // bounce must never weaken it.
    assert.equal(halfOf(serve.first.v as number), side, `${p.key}: first bounce`);
    assert.notEqual(halfOf(serve.landing.v as number), side, `${p.key}: landing`);
    assert.ok(serve.landing.t > serve.first.t, `${p.key}: out of order`);
  }
  assert.ok(seen >= 8, `only ${seen} serves in the fixture`);
});

test("a serve the detector already saw is left exactly as it was", () => {
  let checked = 0;
  for (const p of POINTS) {
    const side = serverSideFor(p.server, p.userPhysicalSide);
    const plain = findServe(p.events, side);
    if (!plain) continue;
    checked += 1;
    const repaired = recoverServe(
      p.events, p.track, p.corners, p.clipT0, p.source, side, p.userPhysicalSide,
    );
    assert.equal(repaired?.first.id, plain.first.id, `${p.key}: first moved`);
    assert.equal(repaired?.landing.id, plain.landing.id, `${p.key}: landing moved`);
    assert.equal(repaired?.recovered, null, `${p.key}: marked as recovered`);
  }
  assert.ok(checked >= 8, `only ${checked} complete serves`);
});

test("point 75 gets the bounce Adil can see and the detector never logged", () => {
  const p = POINTS.find((x) => x.key === "Julian 75");
  assert.ok(p, "Julian 75 missing from the fixture");
  const f = p as Fixture;
  // One event stored for the whole point, and it reads four centimetres
  // wide of the sideline, so it is not even a landing.
  assert.equal(f.events.length, 1);
  assert.equal(onTable(f.events[0]), false);
  const side = serverSideFor(f.server, f.userPhysicalSide);
  assert.equal(findServe(f.events, side), null, "a serve was built from one event");
  const serve = recoverServe(
    f.events, f.track, f.corners, f.clipT0, f.source, side, f.userPhysicalSide,
  );
  assert.ok(serve, "no serve recovered");
  const s = serve as NonNullable<typeof serve>;
  // Julian served; the landing belongs on Adil's half, which is near here.
  assert.equal(halfOf(s.landing.v as number), f.userPhysicalSide);
  assert.ok(onTable(s.landing));
});
