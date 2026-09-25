import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  FrameClock,
  buildHandCutEvidence,
  parseHandTracking,
  readHandTracking,
  type HandPoint,
} from "./handCutEvidence.ts";
import {
  cutOffsetFor,
  hydrateServeMissData,
  missForPoint,
  type ServeMissData,
} from "./serveMiss.ts";
import type { MatchJson } from "./uploadView.ts";

/*
 * A variable-frame-rate original, the case the clock handling exists for.
 * 30 fps, except the camera dropped a quarter of a second after frame 89 (a
 * phone in low light does this). ffprobe's average rate over the file then
 * reads about 29.05, so `frame / fps` and the frame's own presentation time
 * disagree by more than a tenth of a second from frame 90 onward.
 */
const FRAME_COUNT = 200;
const frameTime = (f: number) =>
  Math.round((f < 90 ? f / 30 : f / 30 + 0.25) * 1e6) / 1e6;
const FRAME_TIMES = Array.from({ length: FRAME_COUNT }, (_, f) => frameTime(f));
/** The payload carries times to four places, as placement stores them. */
const at = (f: number) => Math.round(frameTime(f) * 1e4) / 1e4;
const NOMINAL_FPS = 29.05;
const RAW = "r2://ponglens-raw/owner/original.mov";

/** The bundle exactly as hand_cut_analysis.write_tracking_bundle writes it:
 *  a header line, then blurball_windowed's one line per frame. */
function bundleText(
  detections: Record<number, [number, number, number]>,
  { frameCount = FRAME_COUNT, lines = FRAME_COUNT, kind = "hand-cut-tracking" } = {}
): string {
  const header = {
    raw_path: RAW,
    match_json_path: "r2://ponglens-media/points/owner/match/match.json",
    created_at: "2026-09-25T03:29:57.248023+00:00",
    frames: {
      v: 1,
      frame_count: frameCount,
      frame_times: FRAME_TIMES,
      windows: [[2.8, 6.3]],
      warmups_s: [3.0],
      computed_frames: [[72, 192]],
      passes: 1,
      block: 24,
      wrapper_sha256: "cb2e1af4",
    },
    v: 1,
    kind,
  };
  const out = [JSON.stringify(header)];
  for (let f = 0; f < lines; f += 1) {
    const d = detections[f];
    // Python's json.dumps default separators, as the tracker writes them.
    out.push(
      d
        ? `{"f": ${f}, "x": ${d[0]}, "y": ${d[1]}, "conf": ${d[2]}, "c": [[${d[0]}, ${d[1]}, ${d[2]}]]}`
        : `{"f": ${f}, "x": null, "y": null, "conf": 0.0, "c": []}`
    );
  }
  return out.join("\n") + "\n";
}

const DETECTIONS: Record<number, [number, number, number]> = {
  80: [900, 500, 12.5], // before the clip opens
  84: [960, 540, 13.25], // the clip start's own frame
  86: [970, 530, 11.0],
  100: [700, 500, 17.75],
  120: [1152, 432, 9.5],
  143: [1000, 560, 8.0], // the first frame at or after the End Point tap
  150: [1100, 600, 7.0], // after it
};

const MATCH_JSON: MatchJson = {
  pipeline: "hand-v1",
  source: { duration: 6.883, fps: NOMINAL_FPS, width: 1920, height: 1080 },
  options: { clip_pads: { pre: 1.2, post: 1.3 } },
  calibration: {
    ok: true,
    source: "keypoints",
    table_corners_px: {
      A_near_1: [565.9, 501.3],
      B_near_2: [673.5, 627.4],
      C_far_2: [1222.7, 518.5],
      D_far_1: [1020.7, 459.9],
    },
  },
};

const POINTS: HandPoint[] = [
  { id: "a", t0: 4.0, t1: 5.0, tight_start: false, deleted: false },
  { id: "gone", t0: 6.0, t1: 6.5, tight_start: false, deleted: true },
];

const PLACEMENT = {
  v: 3,
  status: "review",
  candidates: [
    { kind: "bounce", t: frameTime(100), x: 700, y: 500, u: 0.5, v: 0.6, id: "c1" },
    { kind: "bounce", t: frameTime(130), x: 1300, y: 520, u: 1.6, v: 1.9, id: "c2" },
    { kind: "contact", t: frameTime(110), x: 800, y: 300, id: "c3" },
    { kind: "bounce", t: 2.0, x: 600, y: 500, u: 0.4, v: 0.5, id: "c4" },
  ],
  hypotheses: {},
};

function tracking() {
  const parsed = parseHandTracking(bundleText(DETECTIONS));
  assert.ok(parsed, "the bundle parses");
  return parsed;
}

test("the frame clock is a faithful port of the worker's", () => {
  const clock = new FrameClock(FRAME_TIMES, NOMINAL_FPS);
  // A frame count written as seconds (frame / fps) comes back to that
  // frame's own presentation time, not to the arithmetic.
  assert.equal(clock.realFromNominal(120 / NOMINAL_FPS), frameTime(120));
  assert.ok(Math.abs(120 / NOMINAL_FPS - frameTime(120)) > 0.1);
  // "The last frame at or before" and "the first at or after", as placement
  // bounds a point's frames.
  assert.equal(clock.frameAtOrBefore(2.8), 84);
  assert.equal(clock.frameAtOrBefore(2.81), 84);
  assert.equal(clock.frameAtOrAfter(5.0), 143);
  // Past the last frame it extrapolates at the nominal rate.
  assert.equal(clock.frameAtOrAfter(FRAME_TIMES[FRAME_COUNT - 1] + 1), 199 + 30);
});

test("the gzip bundle is read whole or not at all", () => {
  const text = bundleText(DETECTIONS);
  const read = readHandTracking(new Uint8Array(gzipSync(text)));
  assert.ok(read);
  assert.deepEqual([...read.frames], [80, 84, 86, 100, 120, 143, 150]);
  assert.equal(read.rawPath, RAW);
  assert.equal(read.frameTimes.length, FRAME_COUNT);

  // One line short of its own header: refused, like read_tracking_bundle.
  assert.equal(parseHandTracking(bundleText(DETECTIONS, { lines: FRAME_COUNT - 1 })), null);
  assert.equal(parseHandTracking(bundleText(DETECTIONS, { frameCount: 10 })), null);
  assert.equal(parseHandTracking(bundleText(DETECTIONS, { kind: "other" })), null);
  assert.equal(readHandTracking(new Uint8Array([1, 2, 3])), null);
});

test("a marked point's ball is on the original's frame times and meets the cut at cut_t0", () => {
  const evidence = buildHandCutEvidence({
    matchId: "m",
    matchJson: MATCH_JSON,
    points: POINTS,
    evidence: [{ id: "a", placement: PLACEMENT }],
    tracking: tracking(),
    serves: null,
    pre: 1.2,
  });
  assert.ok(evidence.data);
  assert.deepEqual(evidence.status, {
    tracked: true,
    serveChecked: false,
    drawn: true,
  });

  // One card per live point; the deleted one was never tracked.
  assert.equal(evidence.data.cards.length, 1);
  const card = evidence.data.cards[0];
  // It spans what detailed analysis read: clip start to End Point tap, and
  // it is matched to its point on the MARK.
  assert.equal(card.t0, 2.8);
  assert.equal(card.t1, 5.0);
  assert.equal(card.hand?.point_t0, 4.0);
  assert.equal(missForPoint(evidence.data, { t0: 4.0 }), card);
  assert.equal(missForPoint(evidence.data, { t0: 2.8 }), null);

  // Exactly the frames placement read, each at ITS OWN time, as fractions
  // of the frame. Frame 120 sits at 4.25 s, not at 120 / 29.05 = 4.13 s.
  assert.deepEqual(card.track, [
    [at(84), 0.5, 0.5],
    [at(86), 0.50521, 0.49074],
    [at(100), 0.36458, 0.46296],
    [at(120), 0.6, 0.4],
    [at(143), 0.52083, 0.51852],
  ]);
  assert.equal(card.track[3][0], 4.25);
  // Held from 2.8 to 2.867, then lost past the four-frame rule, in runs
  // kept to the rows' own precision. The frame
  // just after the End Point tap is drawn but, as tracked_runs does, is
  // not counted inside the card.
  assert.deepEqual(card.seen, [
    [at(84), at(86)],
    [at(100), at(100)],
    [at(120), at(120)],
  ]);

  // The server keeps confidence; the browser card never carries it.
  assert.ok(evidence.tracks);
  assert.equal(evidence.tracks.conf, "measured");
  assert.deepEqual(evidence.tracks.cards.map((c) => c.t0), [4.0]);
  assert.deepEqual(evidence.tracks.cards[0].track[3], [4.25, 0.6, 0.4, 9.5]);
  assert.ok(card.track.every((row) => row.length === 3));

  // The page's one conversion: the clip start lands on the point's cut_t0,
  // and a detection lands on the cut exactly as far into the clip as it is
  // into the card.
  const row = { t0: 4.0, cut_t0: 12.5 };
  const offset = cutOffsetFor(row, 1.2);
  assert.ok(offset !== null);
  assert.ok(Math.abs(card.t0 + offset - 12.5) < 1e-9);
  assert.ok(Math.abs(card.track[3][0] + offset - (12.5 + (4.25 - 2.8))) < 1e-9);

  // Placement's bounces, inside the window only, strictly on or off the
  // table; contacts are not bounces.
  assert.deepEqual(
    card.bounces.map((b) => [b.t, b.onSurface]),
    [
      [at(100), true],
      [at(130), false],
    ]
  );
  assert.deepEqual(card.bounces[0], {
    t: at(100),
    x: 0.36458,
    y: 0.46296,
    u: 0.5,
    v: 0.6,
    onTable: true,
    onSurface: true,
  });
  // Nothing checked the serve, and the card says so rather than "none".
  assert.equal(card.serve_s, null);
  assert.equal(card.hand?.serve_checked, false);
});

test("the serve diagnosis is moved from frame counts onto the frame times before it is used", () => {
  const nominal = (f: number) => Math.round((f / NOMINAL_FPS) * 100) / 100;
  const serves = {
    key: "m",
    w: 1920,
    h: 1080,
    duration: 6.883,
    quad: [
      [565.9, 501.3],
      [673.5, 627.4],
      [1222.7, 518.5],
      [1020.7, 459.9],
    ],
    net: [
      [838.4, 476.5],
      [1024.1, 557.9],
    ],
    prism: [[1, 2]],
    reasons: { would_have_passed: "would have passed" },
    total_cards: 1,
    meta: { hand_cut: { raw_path: RAW, windows: [[2.8, 6.3]], fps: NOMINAL_FPS } },
    cards: [
      {
        // The assembler's own card: it does not start at the mark.
        t0: nominal(70),
        t1: nominal(160),
        dur: nominal(160) - nominal(70),
        serve_s: nominal(100),
        serve_source: "motif",
        serve_arrival_s: null,
        serve_half: null,
        serve_bounces: [nominal(105), nominal(110)],
        track: [],
        bounces: [
          { t: nominal(105), x: 0.4, y: 0.5, u: 0.5, v: 0.6, onTable: true, onSurface: true },
          { t: nominal(110), x: 0.5, y: 0.4, u: 0.4, v: 1.8, onTable: true, onSurface: true },
          { t: nominal(150), x: 0.6, y: 0.4, u: 0.4, v: 2.8, onTable: false, onSurface: true },
        ],
        crossings: [nominal(108)],
        why: {
          bounces: 3,
          on_surface: 3,
          pairs: 1,
          rejects: {},
          reason: "would_have_passed",
          detail: [[nominal(105), nominal(110), "would_have_passed"]],
        },
      },
    ],
  } as unknown as ServeMissData;

  const evidence = buildHandCutEvidence({
    matchId: "m",
    matchJson: MATCH_JSON,
    points: POINTS,
    evidence: [{ id: "a", placement: PLACEMENT }],
    tracking: tracking(),
    serves,
    pre: 1.2,
  });
  assert.ok(evidence.data);
  assert.equal(evidence.status.serveChecked, true);
  const card = evidence.data.cards[0];
  const near = (actual: number | null | undefined, frame: number) =>
    assert.ok(
      // serves.json stores two decimals, which is up to a sixth of a
      // frame at 30 fps; the clock error being fixed is 0.14 s here.
      actual != null && Math.abs(actual - frameTime(frame)) < 0.005,
      `${actual} should be frame ${frame} at ${frameTime(frame)}`
    );
  // Each time is the frame it was counted from, at that frame's own time:
  // 3.58 s for the serve, where the arithmetic would have said 3.44 s.
  near(card.serve_s, 100);
  near(card.serve_bounces?.[0], 105);
  near(card.serve_bounces?.[1], 110);
  assert.deepEqual(card.bounces.length, 2, "the bounce after the End Point tap is not this card's");
  near(card.bounces[0].t, 105);
  near(card.bounces[1].t, 110);
  near(card.crossings[0], 108);
  assert.equal(card.why.reason, "would_have_passed");
  near(card.why.detail[0][0], 105);
  assert.equal(card.hand?.serve_checked, true);
  assert.deepEqual(evidence.data.prism, [[1, 2]]);

  // A diagnosis built from a different original is not this match's.
  const stale = buildHandCutEvidence({
    matchId: "m",
    matchJson: MATCH_JSON,
    points: POINTS,
    evidence: [{ id: "a", placement: PLACEMENT }],
    tracking: tracking(),
    serves: {
      ...serves,
      meta: { hand_cut: { raw_path: "r2://ponglens-raw/other.mov", fps: NOMINAL_FPS } },
    } as unknown as ServeMissData,
    pre: 1.2,
  });
  assert.equal(stale.status.serveChecked, false);
  assert.equal(stale.data?.cards[0].serve_s, null);
});

test("server hydration finds a hand card's full-rate rows by its mark", () => {
  const evidence = buildHandCutEvidence({
    matchId: "m",
    matchJson: MATCH_JSON,
    points: POINTS,
    evidence: [{ id: "a", placement: PLACEMENT }],
    tracking: tracking(),
    serves: null,
    pre: 1.2,
  });
  assert.ok(evidence.data && evidence.tracks);
  const tracks = {
    ...evidence.tracks,
    cards: [{ t0: 4.0, track: [[3.0, 0.25, 0.75, 20]] }],
  };
  const hydrated = hydrateServeMissData(evidence.data, tracks, NOMINAL_FPS, MATCH_JSON);
  assert.deepEqual(hydrated.cards[0].track, [[3.0, 0.25, 0.75]]);
  assert.equal(hydrated.cards[0].hand?.point_t0, 4.0);
});

test("a split start opens on the tight pad, and nothing is drawn without a table", () => {
  const tight = buildHandCutEvidence({
    matchId: "m",
    matchJson: MATCH_JSON,
    points: [{ id: "a", t0: 4.0, t1: 5.0, tight_start: true, deleted: false }],
    evidence: [],
    tracking: tracking(),
    serves: null,
    pre: 1.2,
  });
  assert.equal(tight.data?.cards[0].t0, 3.7);

  const noTable = buildHandCutEvidence({
    matchId: "m",
    matchJson: { ...MATCH_JSON, calibration: undefined },
    points: POINTS,
    evidence: [],
    tracking: tracking(),
    serves: null,
    pre: 1.2,
  });
  assert.equal(noTable.data, null);
  assert.deepEqual(noTable.status, { tracked: true, serveChecked: false, drawn: false });
});

test("an automatic match never takes the hand-cut path", () => {
  const evidence = buildHandCutEvidence({
    matchId: "m",
    matchJson: { ...MATCH_JSON, pipeline: "v2" },
    points: POINTS,
    evidence: [],
    tracking: tracking(),
    serves: null,
    pre: 1.2,
  });
  assert.equal(evidence.data, null);
  assert.equal(evidence.tracks, null);
});
