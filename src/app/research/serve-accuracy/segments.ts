import type { DetectedEvent } from "./serveAccuracyModel.ts";
import { inPrism, prismPolygon, type Pt } from "./prism.ts";
import { dedupeLandings } from "./offTable.ts";
import { normalizePlacementCoordinates } from "../../../lib/placement/placementAggregate.ts";

/**
 * Read the ball's flights, not its frames.
 *
 * Every rule on this page reads the ball track one frame at a time, and
 * that is why the holes in the track beat them. When BlurBall loses the
 * ball it does not go quiet — it returns the best thing it can find, a
 * chair or a bag, at confidence 1 instead of 60. Frame by frame that is
 * indistinguishable from a real detection.
 *
 * A flight is different. A ball in the air follows one smooth arc and can
 * only leave it when something touches it: the table, a bat, or the net.
 * Nothing else. So the arcs are the evidence and the breaks between them
 * are the events, and a hole in the middle of the track is no longer a
 * problem to be filtered out — it is the thing being measured.
 *
 * Julian's point 51 is the case that motivated this. The ball lands on
 * his half at clip 3.43, he hits it long, and the page says "nothing
 * followed the last landing" because no contact was ever recorded. The
 * track loses the ball for eight frames across exactly that moment, and
 * says so: confidence 59, 65, 19 into the hole, then 1.24, 0.57, 1.21,
 * then 63, 106 out of it. But the two flights either side nearly meet in
 * space — 22 px apart — and reverse direction. A bounce and a bat touch
 * happened in that gap. Neither was seen; both are provable.
 *
 * What comes out of this is not a fifth rule. It is an event-repair
 * layer: recovered landings and contacts, merged into the event list the
 * existing three rules already read, so that "a landing was missed"
 * stops being true and the off-table read finishes the job by itself.
 */

const TABLE_W_M = 1.525;
const TABLE_L_M = 2.74;

// ---------------------------------------------------------------------------
// Parameters. Every one of these was swept; the notes say what moved.
// ---------------------------------------------------------------------------

/**
 * Confidence below which a frame is not evidence.
 *
 * The shipped rules use 1.0, which keeps the distractors. This is not a
 * contradiction: they need coverage and have their own gates, whereas a
 * flight is a claim about the ball's ARC and one furniture frame bends it.
 */
export const SEG_MIN_CONF = 4;
/** Longer than this between frames and the two are not one flight. */
export const SEG_MAX_GAP_S = 0.4;
/** Further than this in one frame, as a fraction of frame width, and the
 *  tracker jumped rather than the ball moved. */
export const SEG_MAX_JUMP_FRAC = 0.18;
/** Frames each side of a turn used to fit its two legs. */
export const SEG_LEG = 3;
/** A leg shorter than this cannot establish an arc. */
export const SEG_MIN_LEG = 3;
/** Each leg must move at least this many pixels vertically for a turn in
 *  the vertical to count, and this far along the table for one in the
 *  horizontal. Below it the "turn" is tracker jitter. */
export const SEG_MIN_RISE_PX = 4;
export const SEG_MIN_TRAVEL = 0.012;
/**
 * How far outside the table a join may project and still be a landing.
 *
 * Not a guess. Where a join sits on a landing the worker also found, the
 * two readings of the same event disagree by 6.6 cm at the median and
 * 26 cm at the ninetieth percentile — so this is the measured width of
 * honest disagreement between two independent reads, and anything tighter
 * throws away real landings for being read imprecisely. Julian's point 79
 * is the case: a corner winner whose landing reads 18 cm wide of the
 * sideline, rejected at 0.12 and admitted here.
 *
 * Sweeping it from 0.16 to 0.40 adds calls steadily and leaves the number
 * it gets wrong at exactly one, so the pad is admitting landings rather
 * than inventing them. It is set from the measurement rather than from the
 * top of that range for the obvious reason: nothing tested what happens
 * past it. And a wide reading cannot move a landing to the wrong HALF of
 * the table, which is the only thing these rules ask of it.
 */
export const SEG_QUAD_PAD_M = 0.25;
/** Never recover an event this close to one the worker already found. */
export const SEG_DUPLICATE_S = 0.12;
/** Across a hole in the track, the two flights must come this close in
 *  pixels for the join to be one event rather than two unrelated things. */
export const SEG_JOIN_MAX_PX = 160;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface TrackPt { t: number; x: number; y: number; conf: number }

type Corners = Record<string, [number, number]>;

/**
 * Image pixels to table metres.
 *
 * The four calibrated corners map onto the table rectangle the same way
 * the worker maps them — A near-left to (0,0), B near-right to (W,0),
 * C far-right to (W,L), D far-left to (0,L) — so a recovered landing
 * lands in the same coordinate system as a detected one.
 *
 * This projection is only valid for points ON the table plane, which is
 * the whole reason it is safe here and was not safe for the prism or for
 * net detection: a bounce is by definition a point on that plane. A ball
 * in the air has a height this cannot know and would be placed wrong.
 */
function homography(corners: Corners): ((x: number, y: number) => [number, number]) | null {
  const near = Object.entries(corners)
    .filter(([k]) => k.includes("near")).map(([, v]) => v)
    .sort((a, b) => a[0] - b[0]);
  const far = Object.entries(corners)
    .filter(([k]) => k.includes("far")).map(([, v]) => v)
    .sort((a, b) => a[0] - b[0]);
  if (near.length !== 2 || far.length !== 2) return null;
  const src = [near[0], near[1], far[1], far[0]];
  const dst: [number, number][] = [
    [0, 0], [TABLE_W_M, 0], [TABLE_W_M, TABLE_L_M], [0, TABLE_L_M],
  ];
  // Eight unknowns, two rows per correspondence, solved by elimination.
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= 8; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return (x: number, y: number) => {
    const w = h[6] * x + h[7] * y + 1;
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  };
}

export interface SegGeometry {
  toTable: (x: number, y: number) => [number, number];
  /** 0 at the near end line, 1 at the far end line. */
  along: (x: number, y: number) => number;
  prism: readonly Pt[] | null;
}

export function segGeometry(corners: Corners | null): SegGeometry | null {
  if (!corners) return null;
  const toTable = homography(corners);
  if (!toTable) return null;
  const near = Object.entries(corners).filter(([k]) => k.includes("near")).map(([, v]) => v);
  const far = Object.entries(corners).filter(([k]) => k.includes("far")).map(([, v]) => v);
  if (near.length !== 2 || far.length !== 2) return null;
  const nearMid = [(near[0][0] + near[1][0]) / 2, (near[0][1] + near[1][1]) / 2];
  const farMid = [(far[0][0] + far[1][0]) / 2, (far[0][1] + far[1][1]) / 2];
  const ax = [farMid[0] - nearMid[0], farMid[1] - nearMid[1]];
  const n2 = ax[0] * ax[0] + ax[1] * ax[1];
  return {
    toTable,
    along: (x, y) => ((x - nearMid[0]) * ax[0] + (y - nearMid[1]) * ax[1]) / n2,
    prism: prismPolygon(corners),
  };
}

// ---------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------

export interface Flight {
  points: TrackPt[];
  /** Whether the ball was falling (screen y increasing) over this flight. */
  falling: boolean;
  /** Which way it was going along the table: +1 toward the far end. */
  heading: number;
  /** True when this flight starts a new run — the track had a hole before it. */
  afterHole: boolean;
}

/** Least-squares slope of `f` against time over the given points. */
function slope(pts: readonly TrackPt[], f: (p: TrackPt) => number): number {
  const n = pts.length;
  if (n < 2) return 0;
  const t0 = pts[0].t;
  let st = 0, sv = 0, stt = 0, stv = 0;
  for (const p of pts) {
    const t = p.t - t0, v = f(p);
    st += t; sv += v; stt += t * t; stv += t * v;
  }
  const d = n * stt - st * st;
  return Math.abs(d) < 1e-12 ? 0 : (n * stv - st * sv) / d;
}

/**
 * Continuous runs of the track: frames that are the same object seen
 * repeatedly, with the low-confidence lies taken out first.
 */
function runsOf(track: readonly TrackPt[], maxJumpPx: number): TrackPt[][] {
  const out: TrackPt[][] = [];
  let cur: TrackPt[] = [];
  for (const p of track) {
    const last = cur[cur.length - 1];
    if (last
      && p.t - last.t <= SEG_MAX_GAP_S
      && Math.hypot(p.x - last.x, p.y - last.y) <= maxJumpPx) {
      cur.push(p);
    } else {
      if (cur.length) out.push(cur);
      cur = [p];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Where a run changes arc.
 *
 * The ball is falling or it is rising, and it is going up the table or
 * down it. Either sign flipping means something touched it. The scan uses
 * a leg either side rather than the neighbouring frame, because a single
 * frame of noise flips a sign and a leg of three does not.
 */
function splitPoints(run: readonly TrackPt[], geo: SegGeometry): number[] {
  const cuts: number[] = [];
  const L = SEG_LEG;
  for (let i = L; i < run.length - L; i++) {
    const back = run.slice(i - L, i + 1);
    const fwd = run.slice(i, i + L + 1);
    const dyB = slope(back, (p) => p.y), dyF = slope(fwd, (p) => p.y);
    const dsB = slope(back, (p) => geo.along(p.x, p.y));
    const dsF = slope(fwd, (p) => geo.along(p.x, p.y));
    const riseB = Math.abs(run[i].y - run[i - L].y);
    const riseF = Math.abs(run[i + L].y - run[i].y);
    const travB = Math.abs(geo.along(run[i].x, run[i].y) - geo.along(run[i - L].x, run[i - L].y));
    const travF = Math.abs(geo.along(run[i + L].x, run[i + L].y) - geo.along(run[i].x, run[i].y));
    const vTurn = dyB * dyF < 0 && riseB >= SEG_MIN_RISE_PX && riseF >= SEG_MIN_RISE_PX;
    const hTurn = dsB * dsF < 0 && travB >= SEG_MIN_TRAVEL && travF >= SEG_MIN_TRAVEL;
    if (!vTurn && !hTurn) continue;
    if (cuts.length && i - cuts[cuts.length - 1] < L) continue;
    cuts.push(i);
  }
  return cuts;
}

export function flightsOf(
  track: readonly (readonly number[])[] | null,
  clipT0: number | null,
  source: { width: number; height: number } | null,
  geo: SegGeometry | null,
  minConf = SEG_MIN_CONF,
  minLeg = SEG_MIN_LEG,
): Flight[] {
  if (!track || clipT0 === null || !source || !geo) return [];
  const pts: TrackPt[] = track
    .filter((q) => q[3] >= minConf)
    .map((q) => ({
      t: clipT0 + q[0], x: q[1] * source.width, y: q[2] * source.height, conf: q[3],
    }))
    .sort((a, b) => a.t - b.t);
  const maxJump = SEG_MAX_JUMP_FRAC * source.width;
  const out: Flight[] = [];
  for (const run of runsOf(pts, maxJump)) {
    const cuts = splitPoints(run, geo);
    const bounds = [0, ...cuts, run.length - 1];
    for (let k = 0; k + 1 < bounds.length; k++) {
      const seg = run.slice(bounds[k], bounds[k + 1] + 1);
      if (seg.length < minLeg) continue;
      out.push({
        points: seg,
        falling: slope(seg, (p) => p.y) > 0,
        heading: Math.sign(slope(seg, (p) => geo.along(p.x, p.y))),
        afterHole: k === 0,
      });
    }
  }
  return out.sort((a, b) => a.points[0].t - b.points[0].t);
}

// ---------------------------------------------------------------------------
// Joins
// ---------------------------------------------------------------------------

export type JoinKind = "bounce" | "contact" | "both" | "none";

export interface Join {
  kind: JoinKind;
  /** Source seconds, from intersecting the two legs rather than from
   *  whichever frame the scan happened to flag. The flag is never the
   *  event: that mistake has been made three times on this page. */
  t: number;
  x: number;
  y: number;
  /** Metres on the table plane, read straight from the homography and
   *  never clamped — the caller decides how far outside still counts. */
  u: number;
  v: number;
  /** How far apart the two flights were, in pixels. Zero within a run. */
  gapPx: number;
  gapS: number;
  onTable: boolean;
  /** Vertical speed in px/s on the way in and on the way out. A bounce
   *  takes energy OUT of the ball; a bat puts it in. */
  vIn: number;
  vOut: number;
  /** Along-table speed either side, same units as `along`. */
  sIn: number;
  sOut: number;
  /** Frames of evidence behind each leg. */
  nIn: number;
  nOut: number;
}

/** Where two straight legs meet, in time. Null when they are parallel or
 *  when the meeting is outside the window between them. */
function meetTime(
  a: readonly TrackPt[], b: readonly TrackPt[], f: (p: TrackPt) => number,
): number | null {
  const ta = a[a.length - 1].t, tb = b[0].t;
  const ma = slope(a, f), mb = slope(b, f);
  if (Math.abs(ma - mb) < 1e-9) return null;
  const ca = f(a[a.length - 1]) - ma * ta;
  const cb = f(b[0]) - mb * tb;
  const t = (cb - ca) / (ma - mb);
  const lo = Math.min(ta, tb) - 0.02, hi = Math.max(ta, tb) + 0.02;
  return t >= lo && t <= hi ? t : null;
}

function at(pts: readonly TrackPt[], t: number, f: (p: TrackPt) => number): number {
  const m = slope(pts, f);
  const ref = pts[pts.length - 1];
  return f(ref) + m * (t - ref.t);
}

export function joinsOf(
  flights: readonly Flight[], geo: SegGeometry, quadPadM = SEG_QUAD_PAD_M,
): Join[] {
  const out: Join[] = [];
  for (let i = 0; i + 1 < flights.length; i++) {
    const A = flights[i], B = flights[i + 1];
    const tailA = A.points.slice(-SEG_LEG - 1);
    const headB = B.points.slice(0, SEG_LEG + 1);
    if (tailA.length < SEG_MIN_LEG || headB.length < SEG_MIN_LEG) continue;
    const pa = tailA[tailA.length - 1], pb = headB[0];
    const gapS = pb.t - pa.t;
    const gapPx = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (B.afterHole && gapPx > SEG_JOIN_MAX_PX) continue;

    const bounced = A.falling && !B.falling;
    const turned = A.heading !== 0 && B.heading !== 0 && A.heading !== B.heading;
    if (!bounced && !turned) continue;

    // Localise on whichever quantity actually turned. A bounce is a corner
    // in the vertical; a bat touch is a corner along the table.
    const tv = bounced ? meetTime(tailA, headB, (p) => p.y) : null;
    const th = turned ? meetTime(tailA, headB, (p) => geo.along(p.x, p.y)) : null;
    const t = tv ?? th ?? (pa.t + pb.t) / 2;
    const x = (at(tailA, t, (p) => p.x) + at(headB, t, (p) => p.x)) / 2;
    const y = bounced
      ? Math.max(at(tailA, t, (p) => p.y), at(headB, t, (p) => p.y))
      : (at(tailA, t, (p) => p.y) + at(headB, t, (p) => p.y)) / 2;
    const [u, v] = geo.toTable(x, y);
    const onTable = u >= -quadPadM && u <= TABLE_W_M + quadPadM
      && v >= -quadPadM && v <= TABLE_L_M + quadPadM;
    out.push({
      kind: bounced && turned ? "both" : bounced ? "bounce" : "contact",
      t, x, y,
      u, v,
      gapPx, gapS, onTable,
      vIn: slope(tailA, (p) => p.y), vOut: slope(headB, (p) => p.y),
      sIn: slope(tailA, (p) => geo.along(p.x, p.y)),
      sOut: slope(headB, (p) => geo.along(p.x, p.y)),
      nIn: A.points.length, nOut: B.points.length,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

export interface RecoveredEvent extends DetectedEvent {
  /** Why this event exists, for the review page. */
  recovered: { via: JoinKind; gapPx: number; gapS: number };
}

export function isRecovered(e: DetectedEvent): e is RecoveredEvent {
  return (e as RecoveredEvent).recovered !== undefined;
}

export interface RepairOptions {
  /** Recover missed landings from bounce joins. */
  landings?: boolean;
  /** Recover missed bat touches from direction reversals. */
  contacts?: boolean;
  /** Accept a hole that offers more than one candidate, taking the best. */
  allowAmbiguous?: boolean;
  /** Let a recovered landing re-place a detected bounce the projection put
   *  just off the table. */
  reproject?: boolean;
  /** How far off the table a detected bounce may be and still be a landing
   *  the flights can put back. */
  reprojectMaxM?: number;
  minConf?: number;
  minLeg?: number;
  quadPadM?: number;
  /** Pad allowed for a hole the rally is seen to continue past. */
  interiorPadM?: number;
}

const NET_V_M = TABLE_L_M / 2;
const halfOf = (v: number) => (v < NET_V_M ? "near" : "far");

/**
 * How far off the table a detected bounce may sit and still be a landing
 * the flights are allowed to put back.
 *
 * Five of the points refusing with "a landing was missed" turn out to have
 * the landing recorded all along, projected two to eleven centimetres past
 * the far end line and therefore dropped from the sequence. The off-table
 * rule already knows this happens — its own overshoot tolerance exists
 * because Julian's point 52 has a real landing 0.12 m past the line — but
 * it applies that tolerance when classifying the ball's ending and not
 * when building the sequence of landings, so a deep ball reads as a hole.
 *
 * Nothing is widened for everybody here. The tolerance only applies where
 * the flights, which never saw the detector's answer, independently put
 * the same event on the table. That is the same discipline as reading near
 * and far from image position rather than from a model's labels: two
 * readings, and the geometric one settles it.
 */
export const SEG_REPROJECT_MAX_M = 0.3;

/**
 * How far outside the table a landing may read when the rally is seen to
 * carry on past it.
 *
 * A ball that lands out ends the point. So a bounce with several more
 * alternating landings after it was IN, however the projection reads it,
 * and the only question left is how far the reading can drift. Julian's
 * point 79 has one 33 cm past the far end line with eight more shots
 * played afterwards — a deep ball read imprecisely, and the sequence says
 * so without any appeal to a tolerance.
 *
 * This applies only to a hole with rally on both sides of it. The last
 * landing of a point gets the measured pad, because there the difference
 * between in and out is the whole question.
 */
export const SEG_INTERIOR_PAD_M = 0.45;
/** Landings that must follow a hole before the rally counts as continuing. */
export const SEG_CONTINUES_AFTER = 2;

/** A detected bounce close enough to the table for a flight to correct it. */
function supersedable(e: DetectedEvent, maxM: number): boolean {
  if (e.u === null || e.v === null) return true;
  const du = Math.max(0 - e.u, e.u - TABLE_W_M, 0);
  const dv = Math.max(0 - e.v, e.v - TABLE_L_M, 0);
  const over = Math.hypot(du, dv);
  return over > 0 && over <= maxM;
}


/**
 * The event list the worker stored, with the events it missed put back.
 *
 * The first attempt at this inserted every bounce join that projected onto
 * the table, and it was a coin flip: twelve points gained, five right. The
 * measurement that explains why is worth keeping. Over both matches the
 * flight machinery lands a join on 836 of the worker's own 896 detected
 * landings — 93%, positioned within 6.6 cm — and produces 94 more that sit
 * on nothing at all. Those 94 are statistically indistinguishable from the
 * 698 confirmed ones: the same gain, the same vertical speed, the same
 * frame counts, overlapping at every percentile. So no property of a join
 * on its own says whether it is a landing. Tightening the join gates
 * cannot work and was not worth a second try.
 *
 * What does separate them is the rally around it. A return must bounce on
 * the receiver's half before it can be played, so landings alternate,
 * always. Two consecutive landings on the same half is therefore not a
 * curiosity — it is a hole with a landing missing from it, and the missing
 * landing is on the other half. That is a position the sequence PREDICTS,
 * and a candidate is admitted only where it fills one.
 *
 * Nothing is ever removed and nothing recorded is moved.
 */
export function repairEvents(
  events: readonly DetectedEvent[],
  track: readonly (readonly number[])[] | null,
  corners: Corners | null,
  clipT0: number | null,
  source: { width: number; height: number } | null,
  opts: RepairOptions = {},
  /** Which end the user was on, so a recovered landing can be drawn on the
   *  map the same way round as a detected one. */
  userPhysicalSide: "near" | "far" | null = null,
): DetectedEvent[] {
  const {
    landings = true, contacts = false, allowAmbiguous = false,
    reproject = true, reprojectMaxM = SEG_REPROJECT_MAX_M,
    quadPadM: pad = SEG_QUAD_PAD_M, interiorPadM: interiorPad = SEG_INTERIOR_PAD_M,
  } = opts;
  const geo = segGeometry(corners);
  if (!geo) return [...events];
  const flights = flightsOf(
    track, clipT0, source, geo, opts.minConf ?? SEG_MIN_CONF, opts.minLeg ?? SEG_MIN_LEG);
  if (flights.length < 2) return [...events];
  const joins = joinsOf(flights, geo, Math.max(pad, interiorPad));

  const sorted = [...events].sort((a, b) => a.t - b.t);
  // The same landing sequence the off-table rule reads, duplicates and
  // bat-echoes removed. Reading a different one was worth five points:
  // holes that rule sees were not holes in the raw list, so nothing was
  // ever offered to fill them.
  const seen = dedupeLandings(sorted);
  const added: RecoveredEvent[] = [];
  const superseded = new Set<string>();
  let n = 0;
  // Emitted onto the table itself: the rules read u and v as a position on
  // the playing surface, and a landing read a few centimetres wide is a
  // landing at the line, not one in the crowd.
  const clamp = (n: number, hi: number) => Math.min(hi, Math.max(0, n));
  const make = (j: Join, kind: "bounce" | "contact"): RecoveredEvent => {
    const u = kind === "bounce" ? clamp(j.u, TABLE_W_M) : j.u;
    const v = kind === "bounce" ? clamp(j.v, TABLE_L_M) : j.v;
    const n2 = userPhysicalSide === null
      ? null : normalizePlacementCoordinates(u, v, userPhysicalSide);
    return {
      id: `seg-${kind}-${n++}`,
      kind,
      t: j.t,
      clipT: clipT0 === null ? null : j.t - clipT0,
      x: j.x, y: j.y,
      u, v,
      nu: n2?.u ?? null, nv: n2?.v ?? null,
      visual: 0, audio: 0, role: null,
      recovered: { via: j.kind, gapPx: j.gapPx, gapS: j.gapS },
    };
  };

  // A join is a landing for a given hole when it reads inside the table
  // plus that hole's tolerance, and it takes the half from the same read.
  const onTableWithin = (j: Join, p: number) =>
    j.u >= -p && j.u <= TABLE_W_M + p && j.v >= -p && j.v <= TABLE_L_M + p;

  if (landings) {
    // Every hole the sequence points at: the span between two landings on
    // the same half, plus the open span after the last one.
    const spans: { from: number; to: number; want: "near" | "far"; pad: number }[] = [];
    for (let i = 1; i < seen.length; i++) {
      const a = seen[i - 1], b = seen[i];
      if (halfOf(a.v as number) !== halfOf(b.v as number)) continue;
      spans.push({
        from: a.t, to: b.t,
        want: halfOf(a.v as number) === "near" ? "far" : "near",
        pad: seen.length - i >= SEG_CONTINUES_AFTER ? interiorPad : pad,
      });
    }
    if (seen.length) {
      const last = seen[seen.length - 1];
      spans.push({
        from: last.t, to: Infinity,
        want: halfOf(last.v as number) === "near" ? "far" : "near",
        pad,
      });
    }
    for (const span of spans) {
      const fits = joins.filter((j) => {
        if (j.kind !== "bounce" || !onTableWithin(j, span.pad)) return false;
        if (j.t <= span.from + SEG_DUPLICATE_S || j.t >= span.to - SEG_DUPLICATE_S) return false;
        if (halfOf(j.v as number) !== span.want) return false;
        const clash = sorted.find(
          (e) => e.kind === "bounce" && Math.abs(e.t - j.t) < SEG_DUPLICATE_S);
        if (!clash) return true;
        return reproject && supersedable(clash, reprojectMaxM);
      });
      if (fits.length === 0) continue;
      // Two candidates in one hole means either one is imaginary or the
      // rally crossed twice, which needs a third landing nobody has. The
      // sequence no longer predicts a single position, so it says nothing.
      if (fits.length > 1 && !allowAmbiguous) continue;
      const best = fits.reduce((a, b) => (a.nIn + a.nOut >= b.nIn + b.nOut ? a : b));
      const clash = sorted.find(
        (e) => e.kind === "bounce" && Math.abs(e.t - best.t) < SEG_DUPLICATE_S);
      if (clash) superseded.add(clash.id);
      added.push(make(best, "bounce"));
    }
  }

  if (contacts) {
    for (const j of joins) {
      if (j.kind !== "contact" && j.kind !== "both") continue;
      if (sorted.some((e) => e.kind === "contact" && Math.abs(e.t - j.t) < SEG_DUPLICATE_S)) continue;
      if (added.some((e) => e.kind === "contact" && Math.abs(e.t - j.t) < SEG_DUPLICATE_S)) continue;
      added.push(make(j, "contact"));
    }
  }

  return [...sorted.filter((e) => !superseded.has(e.id)), ...added]
    .sort((a, b) => a.t - b.t);
}


// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------

export interface RepairTrust {
  /** Every landing in the repaired point alternates halves, front to back. */
  fullAlternation: boolean;
  /** The ball was watched leaving the volume a rally lives in, descending,
   *  and never came back. */
  sawItLeave: boolean;
  trusted: boolean;
}

/**
 * Whether a call built on repaired events is worth making.
 *
 * Repair on its own is not enough, and the corpus is blunt about it: the
 * fifteen points it first unlocked came out ten right and five wrong,
 * which is not a rule, it is a coin. These two tests take that to eleven
 * of eleven — and they are not a filter fitted to the failures, they are
 * the two questions the repair itself raises.
 *
 * The first is whether the repair FINISHED. A rally alternates halves from
 * the serve to the last shot, so a point that still has a hole in it after
 * repair is a point where nobody knows which shot is being read. Filling
 * the hole the off-table rule happens to look at, while leaving three more
 * behind it, restores that rule's confidence without earning it.
 *
 * The second is whether the ending was actually seen. Every one of these
 * points ends with the ball not coming down again, and that is a claim
 * about something ABSENT — which the record makes when the ball went out
 * and equally when the tracker simply stopped looking. Watching the ball
 * descend out of the playing volume and stay out separates them.
 *
 * Neither is redundant. Alternation alone keeps sixteen calls and leaves
 * three wrong; the exit alone keeps eleven and leaves one; together they
 * keep nine and leave none.
 */
export function repairTrust(
  repaired: readonly DetectedEvent[],
  track: readonly (readonly number[])[] | null,
  corners: Corners | null,
  clipT0: number | null,
  source: { width: number; height: number } | null,
  opts: RepairOptions = {},
): RepairTrust {
  const no = { fullAlternation: false, sawItLeave: false, trusted: false };
  const geo = segGeometry(corners);
  if (!geo || !geo.prism) return no;
  const landings = dedupeLandings([...repaired].sort((a, b) => a.t - b.t));
  if (!landings.length) return no;

  let fullAlternation = true;
  for (let i = 1; i < landings.length; i++) {
    if (halfOf(landings[i].v as number) === halfOf(landings[i - 1].v as number)) {
      fullAlternation = false;
    }
  }

  const last = landings[landings.length - 1];
  const flights = flightsOf(
    track, clipT0, source, geo, opts.minConf ?? SEG_MIN_CONF, opts.minLeg ?? SEG_MIN_LEG);
  const prism = geo.prism;
  let exitAt: number | null = null;
  for (const f of flights) {
    if (!f.falling) continue;
    for (let i = 1; i < f.points.length; i++) {
      const a = f.points[i - 1], b = f.points[i];
      if (a.t <= last.t) continue;
      if (inPrism(prism, a.x, a.y) && !inPrism(prism, b.x, b.y)) exitAt = b.t;
    }
  }
  let sawItLeave = exitAt !== null;
  if (exitAt !== null) {
    for (const f of flights) {
      for (const p of f.points) {
        if (p.t > exitAt + 0.05 && inPrism(prism, p.x, p.y)) sawItLeave = false;
      }
    }
  }
  return {
    fullAlternation, sawItLeave,
    trusted: fullAlternation && sawItLeave,
  };
}
