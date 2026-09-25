/**
 * A hand-cut match's evidence, in the shapes the admin page already draws.
 *
 * An automatic match brings three files: match.json (the table), serves.json
 * (the per-card serve diagnosis and a thinned trail) and tracks.json (the
 * undecimated ball). A hand cut (match.json `pipeline: "hand-v1"`) never
 * writes tracks.json, and the serves.json it gets when highlights run is cut
 * into the ASSEMBLER's cards, not the owner's marks: on 623c09c6 only 7 of
 * its 57 cards start within a tenth of a second of one of the 55 marks, so
 * matching them to points by start (missForPoint) finds almost nothing.
 *
 * What a hand cut does have, once detailed analysis or highlights has run:
 *
 * - `hand-tracking.jsonl.gz` beside match.json (worker/hand_cut_analysis.py,
 *   worker/blurball_windowed.py). One header line, then ONE LINE PER FRAME
 *   of the original: `{"f", "x", "y", "conf", "c"}` in source pixels, x/y
 *   null where the ball was not held. The header carries `frame_times`, each
 *   frame's presentation time as the decoder read it.
 * - `points.placement` for every marked point, read by detailed analysis
 *   from the clip start to the End Point tap.
 * - `serves.json`, only when highlights ran.
 *
 * THE CLOCK. The page draws in the clock of the points' own t0, and converts
 * that to the cut video with each point's cut_t0 (cutOffsetFor). A hand
 * mark is a PLAYBACK second on the original, the cut video was cut from the
 * original at those seconds, and placement puts its times back on that same
 * clock (placement_on_real_clock). So everything here is on the frames' own
 * presentation times: a detection's time is `frame_times[f]`, never
 * `f / fps`. serves.json is the one thing that is not: its times come from
 * counting frames (`f / fps`, the automatic pipeline's arithmetic), so they
 * go through FrameClock.realFromNominal, a port of the worker's, before
 * anything is drawn. On a variable-frame-rate phone video the two drift
 * apart as the match runs, and a trail on the wrong clock is worse than
 * none.
 *
 * THE CARD. Each marked point becomes one card spanning exactly the frames
 * detailed analysis read: from the clip start (the mark less the pre pad,
 * the tight-start pad on a split) to the End Point tap. A late Begin tap
 * puts the serve before the mark, so starting at the mark would hide the
 * one bounce the serve map needs. The card remembers the mark it belongs to
 * (`hand.point_t0`), which is what the page matches it on.
 *
 * Server-only: this reads the gzip with node:zlib.
 */

import { gunzipSync } from "node:zlib";
import type {
  MissBounce,
  MissCard,
  MissWhy,
  ServeMissData,
} from "./serveMiss.ts";
import { quadFromCorners, type MatchJson } from "./uploadView.ts";
import { netSegmentFromQuad } from "../../research/serve-accuracy/netDeath.ts";
import type { TrackArtifact } from "./pointReadings.ts";

export const HAND_TRACKING_NAME = "hand-tracking.jsonl.gz";

/** A two-hour 60 fps original is about 45 MB unpacked. Anything past these
 *  is not a tracking bundle, and the page gives up rather than the server. */
export const HAND_TRACKING_MAX_GZIP_BYTES = 32 * 1024 * 1024;
export const HAND_TRACKING_MAX_BYTES = 128 * 1024 * 1024;

const TABLE_W_M = 1.525;
const TABLE_L_M = 2.74;
/** hand_cut_analysis.TIGHT_START_PRE_S, the pad a split start opens with. */
const TIGHT_START_PRE_S = 0.3;

/* -------------------------------------------------------------------------
 * The frame clock (a port of hand_cut_analysis.FrameClock)
 * ---------------------------------------------------------------------- */

function lowerBound(values: ArrayLike<number>, target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(values: ArrayLike<number>, target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Frame numbers and seconds for one decode of one video.
 *
 * `times[f]` is frame f's presentation time; `fps` is the nominal rate the
 * frame-counting pipeline divides by. Mirrors the Python exactly, including
 * the extrapolation past either end and the snap that treats a position
 * within a hundredth of a frame as that frame.
 */
export class FrameClock {
  readonly times: readonly number[];
  readonly fps: number;

  constructor(times: readonly number[], fps: number) {
    if (!times.length) throw new Error("a frame clock needs at least one frame");
    if (!Number.isFinite(fps) || fps <= 0) {
      throw new Error("a frame clock needs a positive frame rate");
    }
    for (let i = 1; i < times.length; i += 1) {
      if (!(times[i] >= times[i - 1])) {
        throw new Error("frame times must not go backwards");
      }
    }
    this.times = times;
    this.fps = fps;
  }

  frameAtOrBefore(seconds: number): number {
    const index = upperBound(this.times, seconds + 1e-9) - 1;
    if (index < 0) return 0;
    const last = this.times.length - 1;
    if (index === last && seconds > this.times[last]) {
      const extra = Math.floor((seconds - this.times[last]) * this.fps + 1e-9);
      return index + Math.max(0, extra);
    }
    return index;
  }

  frameAtOrAfter(seconds: number): number {
    const index = lowerBound(this.times, seconds - 1e-9);
    if (index >= this.times.length) {
      const last = this.times.length - 1;
      const extra = Math.ceil((seconds - this.times[last]) * this.fps - 1e-9);
      return last + Math.max(1, extra);
    }
    return index;
  }

  /** Real time of a (possibly fractional) frame position. */
  timeOfFrame(frame: number): number {
    const last = this.times.length - 1;
    if (frame <= 0) return this.times[0] + frame / this.fps;
    if (frame >= last) return this.times[last] + (frame - last) / this.fps;
    const lower = Math.floor(frame);
    const fraction = frame - lower;
    if (fraction < 1e-6) return this.times[lower];
    return (
      this.times[lower] +
      fraction * (this.times[lower + 1] - this.times[lower])
    );
  }

  /** A time written as frame / fps, back on the video's own clock. */
  realFromNominal(nominal: number): number {
    let position = nominal * this.fps;
    const nearest = Math.round(position);
    if (Math.abs(position - nearest) < 0.01) position = nearest;
    return this.timeOfFrame(position);
  }
}

/* -------------------------------------------------------------------------
 * The tracking bundle
 * ---------------------------------------------------------------------- */

export interface HandTracking {
  rawPath: string | null;
  frameTimes: number[];
  /** Frames the ball was held on, in frame order. Parallel arrays. */
  frames: Int32Array;
  x: Float64Array;
  y: Float64Array;
  conf: Float64Array;
}

/**
 * Parse an unpacked bundle, refusing anything that is not a whole one.
 *
 * The same checks as hand_cut_analysis.read_tracking_bundle: version 1, the
 * right kind, and exactly one line per frame the header numbers. A bundle
 * cut short would still parse, and every detection in it would still carry
 * its own frame number, but a file that does not match its own header is
 * not one to draw a match from.
 */
export function parseHandTracking(text: string): HandTracking | null {
  const firstBreak = text.indexOf("\n");
  if (firstBreak < 0) return null;
  let header: {
    v?: unknown;
    kind?: unknown;
    raw_path?: unknown;
    frames?: { frame_count?: unknown; frame_times?: unknown };
  };
  try {
    header = JSON.parse(text.slice(0, firstBreak));
  } catch {
    return null;
  }
  if (
    !header ||
    header.v !== 1 ||
    header.kind !== "hand-cut-tracking" ||
    !header.frames ||
    !Array.isArray(header.frames.frame_times)
  ) {
    return null;
  }
  const frameTimes = header.frames.frame_times as unknown[];
  if (
    !frameTimes.length ||
    frameTimes.some((t) => typeof t !== "number" || !Number.isFinite(t))
  ) {
    return null;
  }
  const times = frameTimes as number[];
  for (let i = 1; i < times.length; i += 1) {
    if (times[i] < times[i - 1]) return null;
  }

  const frames: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const cs: number[] = [];
  let lines = 0;
  let start = firstBreak + 1;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
    if (!line.trim()) continue;
    lines += 1;
    // Most frames hold no ball; skip them without parsing.
    if (line.includes('"x": null') || line.includes('"x":null')) continue;
    let row: { f?: unknown; x?: unknown; y?: unknown; conf?: unknown };
    try {
      row = JSON.parse(line);
    } catch {
      return null;
    }
    const f = row.f;
    const x = row.x;
    const y = row.y;
    if (
      typeof f !== "number" ||
      !Number.isInteger(f) ||
      f < 0 ||
      f >= times.length ||
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      continue;
    }
    if (frames.length && f <= frames[frames.length - 1]) return null;
    frames.push(f);
    xs.push(x);
    ys.push(y);
    cs.push(typeof row.conf === "number" && Number.isFinite(row.conf) ? row.conf : 0);
  }
  if (lines !== times.length || header.frames.frame_count !== times.length) {
    return null;
  }
  return {
    rawPath: typeof header.raw_path === "string" ? header.raw_path : null,
    frameTimes: times,
    frames: Int32Array.from(frames),
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    conf: Float64Array.from(cs),
  };
}

/** Unpack and parse, bounded both ways. Null on anything unreadable. */
export function readHandTracking(gzip: Uint8Array): HandTracking | null {
  if (gzip.byteLength > HAND_TRACKING_MAX_GZIP_BYTES) return null;
  try {
    const text = gunzipSync(gzip, {
      maxOutputLength: HAND_TRACKING_MAX_BYTES,
    }).toString("utf8");
    return parseHandTracking(text);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------
 * Cards
 * ---------------------------------------------------------------------- */

export interface HandPoint {
  id: string;
  t0: number;
  t1: number;
  tight_start: boolean;
  deleted: boolean;
}

interface EvidenceCandidate {
  kind?: unknown;
  t?: unknown;
  x?: unknown;
  y?: unknown;
  u?: unknown;
  v?: unknown;
}

export interface HandEvidencePoint {
  id: string;
  placement: unknown;
}

/** What the page can say about this hand cut's evidence. */
export interface HandEvidenceStatus {
  /** The ball was tracked (the bundle was read). */
  tracked: boolean;
  /** A serve diagnosis (serves.json, written by highlights) was used. */
  serveChecked: boolean;
  /** There is something to draw: a table and at least one live point. */
  drawn: boolean;
}

export interface HandEvidence {
  data: ServeMissData | null;
  tracks: TrackArtifact | null;
  status: HandEvidenceStatus;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const round = (value: number, places: number) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/** Where a point's padded clip opens on the source clock, the way
 *  hand_cut_analysis.point_clip_start and adjust_point anchor cut_t0. */
export function handClipStart(point: HandPoint, pre: number): number {
  const pad = point.tight_start ? Math.min(pre, TIGHT_START_PRE_S) : pre;
  return Math.max(0, point.t0 - pad);
}

/**
 * research_serve_misses.tracked_runs: stretches where the ball was held,
 * breaking on a gap of more than four frames at the nominal rate.
 *
 * Kept to the rows' own four places rather than the worker's two: the
 * trajectory reader drops any row outside a run, and a run rounded inward
 * would drop the first and last row of every one of them.
 */
function trackedRuns(
  rows: readonly (readonly number[])[],
  t0: number,
  t1: number,
  fps: number
): [number, number][] {
  const maxGap = 4 / Math.max(fps, 1);
  const runs: [number, number][] = [];
  let start: number | null = null;
  let last = 0;
  for (const [t] of rows) {
    if (t < t0) continue;
    if (t > t1) break;
    if (start === null) {
      start = t;
      last = t;
    } else if (t - last > maxGap) {
      runs.push([round(start, 4), round(last, 4)]);
      start = t;
    }
    last = t;
  }
  if (start !== null) runs.push([round(start, 4), round(last, 4)]);
  return runs;
}

/** A serves.json card with every time moved onto the frames' own clock. */
function cardOnRealClock(card: MissCard, clock: FrameClock): MissCard {
  const real = (t: number) => round(clock.realFromNominal(t), 3);
  const maybe = (t: number | null | undefined) =>
    finite(t) ? real(t) : t ?? null;
  return {
    ...card,
    t0: real(card.t0),
    t1: real(card.t1),
    serve_s: maybe(card.serve_s),
    serve_arrival_s: maybe(card.serve_arrival_s),
    serve_bounces:
      card.serve_bounces && card.serve_bounces.length === 2
        ? [real(card.serve_bounces[0]), real(card.serve_bounces[1])]
        : card.serve_bounces ?? null,
    bounces: (card.bounces ?? []).map((b) => ({ ...b, t: real(b.t) })),
    crossings: (card.crossings ?? []).filter(finite).map(real),
    why: card.why
      ? {
          ...card.why,
          detail: (card.why.detail ?? []).map(
            ([a, b, reason]) => [real(a), real(b), reason] as [number, number, string]
          ),
        }
      : card.why,
  };
}

function notChecked(bounces: MissBounce[]): MissWhy {
  // Never displayed: every surface checks `hand.serve_checked` first. It
  // exists because the type needs one, and it says what it is.
  return {
    bounces: bounces.length,
    on_surface: bounces.filter((b) => b.onSurface).length,
    pairs: 0,
    rejects: {},
    reason: "not_checked",
    detail: [],
  };
}

function placementBounces(
  placement: unknown,
  start: number,
  end: number,
  width: number,
  height: number
): MissBounce[] {
  const candidates =
    placement && typeof placement === "object"
      ? (placement as { candidates?: unknown }).candidates
      : null;
  if (!Array.isArray(candidates)) return [];
  const out: MissBounce[] = [];
  for (const raw of candidates as EvidenceCandidate[]) {
    if (!raw || raw.kind !== "bounce") continue;
    const { t, x, y } = raw;
    if (!finite(t) || !finite(x) || !finite(y) || t < start || t > end) continue;
    const u = finite(raw.u) ? raw.u : null;
    const v = finite(raw.v) ? raw.v : null;
    // Strictly on the table. The serve rule's surface pad belongs to the
    // serve rule; placement asked nothing about it.
    const onTable =
      u !== null && v !== null && u >= 0 && u <= TABLE_W_M && v >= 0 && v <= TABLE_L_M;
    out.push({
      t: round(t, 4),
      x: round(x / width, 5),
      y: round(y / height, 5),
      u: u === null ? null : round(u, 3),
      v: v === null ? null : round(v, 3),
      onTable,
      onSurface: onTable,
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * Every marked point as a card the admin page can draw.
 *
 * `serves` is used only when it was built for this hand cut (its
 * `meta.hand_cut` block) from the same original the tracking came from, and
 * only when the tracking is here to put its times on the right clock.
 * Without it the bounces are placement's own, and the serve row says
 * nothing was checked rather than that nothing was found.
 */
export function buildHandCutEvidence({
  matchId,
  matchJson,
  points,
  evidence,
  tracking,
  serves,
  pre,
}: {
  matchId: string;
  matchJson: MatchJson | null;
  points: readonly HandPoint[];
  evidence: readonly HandEvidencePoint[];
  tracking: HandTracking | null;
  serves: ServeMissData | null;
  /** The clip's pre pad, as the page reads it for cutOffsetFor. */
  pre: number;
}): HandEvidence {
  const empty = (serveChecked = false): HandEvidence => ({
    data: null,
    tracks: null,
    status: { tracked: tracking !== null, serveChecked, drawn: false },
  });
  if (matchJson?.pipeline !== "hand-v1") return empty();

  const width = Number(matchJson.source?.width);
  const height = Number(matchJson.source?.height);
  const nominalFps = Number(matchJson.source?.fps);
  if (!(width > 0) || !(height > 0)) return empty();

  // The table. Detailed analysis writes a calibration into the hand cut's
  // match.json; the diagnosis carries the same quad when highlights ran.
  const calibrated =
    matchJson.calibration?.ok === true
      ? quadFromCorners(matchJson.calibration.table_corners_px)
      : null;
  const quad: number[][] | null =
    calibrated ?? (serves?.quad?.length === 4 ? serves.quad : null);
  if (!quad) return empty();
  const netSegment = netSegmentFromQuad(quad);
  const net = serves?.net?.length === 2
    ? serves.net
    : netSegment
      ? [netSegment.e1, netSegment.e2]
      : null;
  if (!net) return empty();

  // The diagnosis, on the frames' clock, or not at all.
  const handMeta = (serves as { meta?: { hand_cut?: { raw_path?: unknown; fps?: unknown } } } | null)
    ?.meta?.hand_cut;
  const servesFps = finite(handMeta?.fps) ? handMeta.fps : nominalFps;
  const sameOriginal =
    !tracking?.rawPath ||
    typeof handMeta?.raw_path !== "string" ||
    handMeta.raw_path === tracking.rawPath;
  let clock: FrameClock | null = null;
  if (tracking && servesFps > 0) {
    try {
      clock = new FrameClock(tracking.frameTimes, servesFps);
    } catch {
      clock = null;
    }
  }
  const diagnosis =
    serves && handMeta && sameOriginal && clock
      ? serves.cards.map((card) => cardOnRealClock(card, clock))
      : null;

  const placementById = new Map(evidence.map((e) => [e.id, e.placement]));
  const trackClock =
    tracking && nominalFps > 0
      ? (() => {
          try {
            return new FrameClock(tracking.frameTimes, nominalFps);
          } catch {
            return null;
          }
        })()
      : null;

  const live = points
    .filter((p) => !p.deleted && finite(p.t0) && finite(p.t1) && p.t1 > p.t0)
    .slice()
    .sort((a, b) => a.t0 - b.t0);

  const cards: MissCard[] = [];
  const trackCards: TrackArtifact["cards"] = [];
  let anyServeCheck = false;

  for (const point of live) {
    const start = handClipStart(point, pre);
    const end = point.t1;

    // The ball, over exactly the frames placement read: the last frame at
    // or before the clip start through the first at or after the end.
    const rows: number[][] = [];
    if (tracking && trackClock) {
      const f0 = trackClock.frameAtOrBefore(start);
      const f1 = trackClock.frameAtOrAfter(end);
      for (
        let i = lowerBound(tracking.frames, f0);
        i < tracking.frames.length && tracking.frames[i] <= f1;
        i += 1
      ) {
        const f = tracking.frames[i];
        rows.push([
          round(tracking.frameTimes[f], 4),
          round(tracking.x[i] / width, 5),
          round(tracking.y[i] / height, 5),
          round(tracking.conf[i], 2),
        ]);
      }
    }

    let bounces: MissBounce[];
    let crossings: number[] = [];
    let serve: Pick<
      MissCard,
      "serve_s" | "serve_source" | "serve_arrival_s" | "serve_half" | "serve_bounces"
    > = {
      serve_s: null,
      serve_source: null,
      serve_arrival_s: null,
      serve_half: null,
      serve_bounces: null,
    };
    let why: MissWhy | null = null;

    if (diagnosis) {
      const within = (t: number) => t >= start && t <= end;
      bounces = diagnosis
        .flatMap((c) => c.bounces)
        .filter((b) => within(b.t))
        .sort((a, b) => a.t - b.t)
        .filter((b, i, all) => i === 0 || b.t - all[i - 1].t > 0.005);
      crossings = [
        ...new Set(diagnosis.flatMap((c) => c.crossings).filter(within)),
      ].sort((a, b) => a - b);
      // The serve the detector found inside this point, if it found one;
      // otherwise the refusal of the card this point mostly sits in. A card
      // whose serve fell OUTSIDE this point says nothing about this one.
      const anchored = diagnosis.find(
        (c) => finite(c.serve_s) && within(c.serve_s)
      );
      if (anchored) {
        serve = {
          serve_s: anchored.serve_s,
          serve_source: anchored.serve_source ?? null,
          serve_arrival_s: anchored.serve_arrival_s ?? null,
          serve_half: anchored.serve_half ?? null,
          serve_bounces: anchored.serve_bounces ?? null,
        };
        why = anchored.why;
      } else {
        const overlap = diagnosis
          .map((c) => ({ c, o: Math.min(end, c.t1) - Math.max(start, c.t0) }))
          .filter(({ o }) => o > 0)
          .sort((a, b) => b.o - a.o)[0];
        if (overlap && !finite(overlap.c.serve_s)) why = overlap.c.why;
      }
    } else {
      bounces = placementBounces(
        placementById.get(point.id),
        start,
        end,
        width,
        height
      );
    }
    const checked = why !== null;
    anyServeCheck ||= checked;

    const card: MissCard = {
      t0: round(start, 3),
      t1: round(end, 3),
      dur: round(end - start, 3),
      ...serve,
      track: rows.map(([t, x, y]) => [t, x, y] as [number, number, number]),
      bounces,
      crossings,
      seen: trackedRuns(rows, start, end, nominalFps),
      audio: null,
      why: why ?? notChecked(bounces),
      hand: { point_t0: point.t0, serve_checked: checked },
    };
    cards.push(card);
    if (rows.length) trackCards.push({ t0: point.t0, track: rows });
  }

  if (!cards.length) return empty(anyServeCheck);

  const data: ServeMissData = {
    key: matchId,
    w: width,
    h: height,
    ...(nominalFps > 0 ? { fps: nominalFps } : {}),
    duration: Number(matchJson.source?.duration) || 0,
    quad,
    net,
    // The play prism needs the camera the worker solved for; without its
    // diagnosis there is no prism to draw, and none is invented.
    prism: diagnosis && serves?.prism ? serves.prism : [],
    cards,
    total_cards: cards.length,
    reasons: diagnosis && serves?.reasons ? serves.reasons : {},
  };
  const tracks: TrackArtifact | null = tracking
    ? {
        v: 2,
        // The points' own clock: for a hand cut, the original's frame times.
        clock: "source",
        w: width,
        h: height,
        // BlurBall's own score, exactly as the tracker wrote it: the same
        // number publish_card_diagnosis reads for an automatic match.
        conf: "measured",
        cards: trackCards,
      }
    : null;
  return {
    data,
    tracks,
    status: {
      tracked: tracking !== null,
      serveChecked: anyServeCheck,
      drawn: true,
    },
  };
}
