import type { DetectedEvent } from "./serveAccuracyModel";

/**
 * The third way to see a point end: the ball turns round at the net.
 *
 * Adil spotted it on Julian's point 3. His shot reaches the net, the
 * trajectory visibly reverses without crossing, the ball drops twice on
 * his own half and rolls off the side. Every other rule was blocked: the
 * dead run needs three bounces and there were two, and the off-table read
 * refused because those same two bounces break the alternation gate —
 * the exact pattern that proves the death is the one the gate punishes.
 *
 * The BlurBall track sees what the bounce list cannot: the along-table
 * coordinate rises toward the net, turns, and comes back, with the turn
 * 0.10 m from the net line. That reversal, followed quickly by two
 * bounces on the half the ball returned to, is a point ending on camera.
 *
 * There is deliberately NO check that a racket did not cause the
 * reversal. The reconstruction hallucinated a bat touch at the exact
 * turn on point 3 — at u=1.27, v=1.85, a "contact" hovering over the
 * middle of the table — and vetoing on it was the whole failure. The
 * veto is unnecessary: if the reversal really was an opponent's block at
 * the net, then their return bounced twice on that half unanswered, and
 * the same player loses either way. Two same-half bounces after the turn
 * make the cause irrelevant.
 *
 * A global reversal detector without the net anchor was measured and is
 * dead — it fires on three quarters of points loose and slides to zero
 * tight, with the two matches disagreeing at every threshold. Anchoring
 * to the net and demanding the two bounces is what makes it a signal:
 * 33 of 174 scored points, 32 right, and the seven calls the other two
 * rules could not make are seven for seven.
 */

const TABLE_W_M = 1.525;
const NET_V_M = 2.74 / 2;

/** How close to the net line, in metres at that spot, the turn must be. */
export const NET_DEATH_BAND_M = 0.35;
/** Bounces required after the turn. One is a rally; two is a death. */
export const NET_DEATH_MIN_BOUNCES = 2;
/** The first bounce follows the turn within this. A dead ball drops now. */
export const NET_DEATH_FIRST_DROP_S = 0.6;
/** And the bounces follow each other at dead-run pace. */
export const NET_DEATH_BOUNCE_GAP_S = 0.45;
/** Frames each side of the turn, and the least distance each leg moves
 *  along the table (as a fraction of its length, so 0.01 is ~3 cm). */
const LEG_FRAMES = 4;
const LEG_MIN_TRAVEL = 0.01;

type H3 = [number, number, number];
const cross = (a: H3, b: H3): H3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const hpt = (p: readonly number[]): H3 => [p[0], p[1], 1];
const dehom = (h: H3): [number, number] | null =>
  Math.abs(h[2]) < 1e-9 ? null : [h[0] / h[2], h[1] / h[2]];

/**
 * The physical net's image, exactly, from the four calibrated corners.
 *
 * The quad's diagonals meet at the image of the table's centre, and the
 * net line runs through it toward the vanishing point of the two end
 * lines. Midpoint-of-sidelines — what the overlay used to draw — is
 * wrong under perspective: the far half is compressed, so the real net
 * sits nearer the far end than the pixel midpoint does.
 */
export function netSegment(
  corners: Record<string, [number, number]>,
): { e1: [number, number]; e2: [number, number] } | null {
  const near = Object.entries(corners)
    .filter(([k]) => k.includes("near")).map(([, v]) => v)
    .sort((a, b) => a[0] - b[0]);
  const far = Object.entries(corners)
    .filter(([k]) => k.includes("far")).map(([, v]) => v)
    .sort((a, b) => a[0] - b[0]);
  if (near.length !== 2 || far.length !== 2) return null;
  const [A, B] = near;
  const [D, C] = far;
  const centre = cross(cross(hpt(A), hpt(C)), cross(hpt(B), hpt(D)));
  const vanish = cross(cross(hpt(A), hpt(B)), cross(hpt(D), hpt(C)));
  const line = cross(centre, vanish);
  const e1 = dehom(cross(line, cross(hpt(A), hpt(D))));
  const e2 = dehom(cross(line, cross(hpt(B), hpt(C))));
  if (!e1 || !e2) return null;
  return { e1, e2 };
}

export interface NetDeath {
  loser: "near" | "far";
  /** Source time of the turn. */
  at: number;
  /** How far from the net line the turn was, in metres. */
  distM: number;
  /** Where the turn is in the frame, for drawing. */
  px: [number, number];
}

export function findNetDeath(
  events: readonly DetectedEvent[],
  track: readonly (readonly number[])[] | null,
  corners: Record<string, [number, number]> | null,
  clipT0: number | null,
  source: { width: number; height: number } | null,
): NetDeath | null {
  if (!track || !corners || clipT0 === null || !source) return null;
  const seg = netSegment(corners);
  if (!seg) return null;

  const near = Object.entries(corners)
    .filter(([k]) => k.includes("near")).map(([, v]) => v);
  const far = Object.entries(corners)
    .filter(([k]) => k.includes("far")).map(([, v]) => v);
  const nearMid = [(near[0][0] + near[1][0]) / 2, (near[0][1] + near[1][1]) / 2];
  const farMid = [(far[0][0] + far[1][0]) / 2, (far[0][1] + far[1][1]) / 2];
  const axis = [farMid[0] - nearMid[0], farMid[1] - nearMid[1]];
  const axisLen2 = axis[0] * axis[0] + axis[1] * axis[1];
  const ppmNear = Math.hypot(near[1][0] - near[0][0], near[1][1] - near[0][1]) / TABLE_W_M;
  const ppmFar = Math.hypot(far[1][0] - far[0][0], far[1][1] - far[0][1]) / TABLE_W_M;
  const along = (x: number, y: number) =>
    ((x - nearMid[0]) * axis[0] + (y - nearMid[1]) * axis[1]) / axisLen2;
  const ppmAt = (x: number, y: number) => {
    const s = Math.min(1, Math.max(0, along(x, y)));
    return ppmNear + s * (ppmFar - ppmNear);
  };
  const distToNet = (x: number, y: number) => {
    const dx = seg.e2[0] - seg.e1[0], dy = seg.e2[1] - seg.e1[1];
    const t = Math.max(0, Math.min(1,
      ((x - seg.e1[0]) * dx + (y - seg.e1[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (seg.e1[0] + t * dx), y - (seg.e1[1] + t * dy));
  };

  const pts = track
    .filter((p) => p[3] >= 1.0)
    .map((p) => ({
      t: clipT0 + p[0],
      x: p[1] * source.width,
      y: p[2] * source.height,
    }));

  const landings = events
    .filter((e) => e.kind === "bounce" && e.u !== null && e.v !== null
      && e.u >= 0 && e.u <= TABLE_W_M && e.v >= 0 && e.v <= 2.74)
    .slice()
    .sort((a, b) => a.t - b.t);

  let i = LEG_FRAMES;
  while (i < pts.length - LEG_FRAMES) {
    const at = pts[i];
    const before = along(at.x, at.y) - along(pts[i - LEG_FRAMES].x, pts[i - LEG_FRAMES].y);
    const after = along(pts[i + LEG_FRAMES].x, pts[i + LEG_FRAMES].y) - along(at.x, at.y);
    const span = pts[i + LEG_FRAMES].t - pts[i - LEG_FRAMES].t;
    const turned = Math.abs(before) >= LEG_MIN_TRAVEL
      && Math.abs(after) >= LEG_MIN_TRAVEL
      && before * after < 0
      && span <= 0.6;
    if (!turned) { i++; continue; }
    // The scan can flag the turn a frame or two early, where the ball is
    // still centimetres short of where it actually turns. Judging the
    // distance there and skipping on threw away Julian's point 6: flagged
    // at 0.39 m, rejected by the 0.35 band, and the true turning point at
    // 0.25 m was jumped over. So find the extremum of the trajectory
    // inside the window first, and judge THAT point.
    let j = i - LEG_FRAMES;
    for (let k = i - LEG_FRAMES; k <= i + LEG_FRAMES; k++) {
      const sk = along(pts[k].x, pts[k].y);
      const sj = along(pts[j].x, pts[j].y);
      if (before > 0 ? sk > sj : sk < sj) j = k;
    }
    const p = pts[j];
    i = Math.max(i, j) + LEG_FRAMES;
    const distM = distToNet(p.x, p.y) / ppmAt(p.x, p.y);
    if (distM > NET_DEATH_BAND_M) continue;
    const drops = landings.filter(
      (e) => e.t > p.t && e.t <= p.t + 2.0,
    );
    if (drops.length < NET_DEATH_MIN_BOUNCES) continue;
    if (drops[0].t - p.t > NET_DEATH_FIRST_DROP_S) continue;
    let quick = true;
    for (let j = 1; j < NET_DEATH_MIN_BOUNCES; j++) {
      if (drops[j].t - drops[j - 1].t > NET_DEATH_BOUNCE_GAP_S) quick = false;
    }
    if (!quick) continue;
    const sides = new Set(drops.map((e) => ((e.v as number) < NET_V_M ? "near" : "far")));
    if (sides.size !== 1) continue;
    return {
      loser: [...sides][0] as "near" | "far",
      at: p.t,
      distM,
      px: [p.x, p.y],
    };
  }
  return null;
}

export function netDeathLoser(
  death: NetDeath | null,
  userPhysicalSide: "near" | "far" | null,
): "user" | "opponent" | null {
  if (death === null || userPhysicalSide === null) return null;
  return death.loser === userPhysicalSide ? "user" : "opponent";
}
