import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dedupeLandings } from "./offTable.ts";
import {
  TABLE_L_M,
  TABLE_W_M,
  type DetectedEvent,
} from "./serveAccuracyModel.ts";
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
      // Two independent readings of the same bounce: the detector's, and
      // where two fitted flights meet. Half a metre apart would mean they
      // are not describing the same event.
      assert.ok(
        Math.hypot(j.u - (e.u as number), j.v - (e.v as number)) < 0.5,
        `${p.key} at ${e.t}: join at ${j.u.toFixed(2)},${j.v.toFixed(2)}`,
      );
    }
  }
  assert.ok(landings > 25, `only ${landings} landings in the fixture`);
  assert.ok(seen / landings > 0.8, `joins found only ${seen} of ${landings}`);
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
