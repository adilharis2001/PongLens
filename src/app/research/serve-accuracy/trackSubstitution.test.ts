import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readPoint, type Tracks } from "./pointReading.ts";
import type { ServeAccuracyRow } from "./serveAccuracyModel.ts";

/**
 * The admin portal reads these rules over a DIFFERENT track. Does it matter?
 *
 * /research/serve-accuracy runs BlurBall again over each point's clip and
 * checks the result into the repository: clip clock, clip pixels, real
 * per-detection confidence. The portal cannot do that for every upload —
 * it is twenty minutes of inference a match — so it reads the track the
 * assembler already produced, which differs in three ways:
 *
 *   - SOURCE seconds rather than seconds from the clip's start, handed to
 *     the rules with a clip origin of zero;
 *   - fractions of the SOURCE frame rather than of the clip's;
 *   - no per-detection confidence at all. The assembler drops it, so every
 *     sample is stamped with one value.
 *
 * The first two are arithmetic and provable. The third is not: two rules
 * filter on confidence — the net read at 1.0 and the flight reader at
 * SEG_MIN_CONF, which is 4 — so the stamp decides whether a sample is seen.
 * The first version of the portal's track stamped 1.0, which passes the net
 * read and fails the flight reader, and the whole repair layer went silently
 * quiet: seven of Chris's calls disappeared and nothing said why.
 *
 * So this measures it. Twenty-three real points, each read three ways, and
 * the verdicts compared. Nothing here asserts what the code returned; the
 * assertion is that two DIFFERENT inputs produce the same answer.
 */

interface CorpusEntry {
  key: string;
  pointId: string;
  winner: "user" | "opponent" | null;
  userPhysicalSide: "near" | "far" | null;
  clipT0: number;
  corners: Record<string, [number, number]>;
  source: { width: number; height: number; fps: number };
  track: number[][];
  events: ServeAccuracyRow["events"];
}

const corpus = JSON.parse(
  readFileSync(
    new URL("./fixtures/segments-corpus.json", import.meta.url),
    "utf8"
  )
) as CorpusEntry[];

/** The row shape readPoint reads, and nothing it does not. */
function rowFor(e: CorpusEntry, clipT0: number): ServeAccuracyRow {
  return {
    pointId: e.pointId,
    idx: 0,
    game: 1,
    server: null,
    winner: e.winner,
    isLet: false,
    computed: null,
    serve: null,
    final: null,
    rejection: null,
    events: e.events,
    speed: null,
    rally: { hits: null, shots: 0, contacts: 0, seconds: null },
    userPhysicalSide: e.userPhysicalSide,
    clipT0,
  };
}

const read = (e: CorpusEntry, track: number[][], clipT0: number) =>
  readPoint(
    rowFor(e, clipT0),
    e.corners,
    { [e.pointId]: track } as Tracks,
    e.source
  );

/** Exactly what the portal's publisher writes: source clock, one stamp. */
const asPortalTrack = (e: CorpusEntry, conf: number) =>
  e.track.map(([t, x, y]) => [
    Number((t + e.clipT0).toFixed(3)),
    x,
    y,
    conf,
  ]);

test("the corpus is the real thing, not a handful of points", () => {
  assert.ok(corpus.length >= 20, `only ${corpus.length} points`);
  assert.ok(corpus.every((e) => e.track.length > 20));
});

test("moving the track onto the source clock changes no verdict", () => {
  for (const e of corpus) {
    const clip = read(e, e.track, e.clipT0);
    // Same samples, same confidences, only the origin moved into the times.
    const source = read(
      e,
      e.track.map(([t, x, y, c]) => [t + e.clipT0, x, y, c]),
      0
    );
    assert.equal(source.winner, clip.winner, `${e.key} winner`);
    assert.equal(source.rule, clip.rule, `${e.key} rule`);
    assert.equal(source.refusal, clip.refusal, `${e.key} refusal`);
  }
});

test("a stamp of 1.0 silences the flight reader — the bug this caught", () => {
  const withReal = corpus.filter((e) => read(e, e.track, e.clipT0).recovered.length);
  assert.ok(withReal.length > 0, "no point in the corpus is repaired at all");
  const stillRepaired = withReal.filter(
    (e) => read(e, asPortalTrack(e, 1.0), 0).recovered.length
  );
  assert.equal(
    stillRepaired.length,
    0,
    "1.0 is below SEG_MIN_CONF, so nothing should be recovered"
  );
});

test("a stamp above both thresholds changes verdicts, so no stamp is safe", () => {
  // The other half of the measurement. A high stamp does not silence the
  // flight reader, it feeds it samples BlurBall was unsure about — and the
  // answer moves. Two of twenty-three here, both from a call to a refusal.
  // Recorded as a test so the next person to reach for a sentinel finds
  // the number rather than the idea.
  const differ: string[] = [];
  for (const e of corpus) {
    const real = read(e, e.track, e.clipT0);
    const stamped = read(e, asPortalTrack(e, 25), 0);
    if (real.winner !== stamped.winner || real.rule !== stamped.rule) {
      differ.push(`${e.key}: ${real.rule ?? "no call"} -> ${stamped.rule ?? "no call"}`);
    }
  }
  assert.ok(
    differ.length > 0,
    "if a stamp were harmless the portal could skip reading BlurBall"
  );
});

test("the real confidences reproduce the research page exactly", () => {
  // What the portal actually does: same samples, same confidences, source
  // clock, clip origin zero. Every verdict must survive it.
  for (const e of corpus) {
    const clip = read(e, e.track, e.clipT0);
    const portal = read(
      e,
      e.track.map(([t, x, y, c]) => [
        Number((t + e.clipT0).toFixed(3)),
        x,
        y,
        c,
      ]),
      0
    );
    assert.equal(portal.winner, clip.winner, `${e.key} winner`);
    assert.equal(portal.rule, clip.rule, `${e.key} rule`);
    assert.equal(portal.refusal, clip.refusal, `${e.key} refusal`);
    assert.equal(
      portal.recovered.length,
      clip.recovered.length,
      `${e.key} recovered`
    );
  }
});
