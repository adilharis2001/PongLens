import type { DetectedEvent } from "./serveAccuracyModel";
import { netSegment } from "./netDeath";
import { inPrism, prismPolygon, type Pt } from "./prism";

/**
 * The fourth way to see a point end: the ball never came back over the net.
 *
 * This is the rule Adil asked for by name, and the biggest bite of the
 * no-call pile: mid-rally, a shot lands on one half, and the player there
 * simply never gets the ball back — a whiff, a ball out of reach, a return
 * that dies before the net. The bounce list alone could never carry it,
 * because "no bounce detected on the other side" is exactly what a MISSED
 * detection looks like. The ungated version of this idea reads 70% and was
 * rightly never shipped.
 *
 * The track is what makes it safe. Split by what the ball does at the net
 * after the last landing: if the track shows it never crossing back within
 * two seconds, no return can have landed, and the player on the landing's
 * half lost — regardless of what the bounce detector saw or missed. If it
 * DID cross, the hard question ("did it land over there?") is exactly the
 * one the bounce record cannot answer, so refuse and leave the point to
 * the other rules. Crossing detection is robust where landing detection is
 * not, and every gate here defends one measured failure:
 *
 * - the last landing must sit a rally-plausible time after the previous
 *   event. Chris 89's "last landing" arrives 1.57 s after anything else —
 *   the next point's serve, not this rally.
 * - the landing must be confirmed by the track: a V — descent, touch,
 *   rise — at its time and place. Chris 72's original "landing" was a
 *   fly-over the track sails straight through.
 * - a mostly-static window is the tracker locked on furniture, not the
 *   ball. Julian 30's window sits pixel-still for 1.6 s, faking both
 *   coverage and "no crossing". No evidence, no call.
 * - a crossing must MOVE. A ball crossing the net travels; a static
 *   distractor that happens to sit past the net line does not.
 *
 * 21 of the 174 scored points, 20 right. The one wrong, Chris 72, has a
 * track-confirmed landing and no return crossing — the recorded evidence
 * agrees with the rule and disagrees with the tap, which carries its own
 * ~10% noise. It stays on the wrong list until someone watches the video.
 */

const NET_V_M = 2.74 / 2;
const TABLE_W_M = 1.525;
const TABLE_L_M = 2.74;

/** How long the ball has to come back over the net before the point is
 *  called. Crossings are scanned for longer (NO_RETURN_SCAN_S) so a slow,
 *  deep return still cancels the call. */
export const NO_RETURN_WINDOW_S = 1.2;
export const NO_RETURN_SCAN_S = 2.0;
/** The window must hold at least this fraction of its expected frames. */
export const NO_RETURN_MIN_COVER = 0.3;
/** Consecutive frames past the net line that make a crossing... */
const CROSS_SUSTAIN = 4;
/** ...provided they travel at least this far along the table (as a
 *  fraction of its length — a static distractor fails this). */
const CROSS_MIN_TRAVEL = 0.05;
/**
 * ...and provided this many of them are inside the prism, the volume a
 * rally actually lives in.
 *
 * This is the difference between a return and a deflection. Adil's point
 * 20 on the Julian match: his bat turns an attacking shot up and away, the
 * ball sails high over the far end and never comes back. Projected flat
 * onto the table axis that reads as "past the net", so the rule saw a
 * crossing, assumed the rally continued, and refused — the ball was over
 * the ROOM, not over the table.
 *
 * All four frames is too strict: a real return can clip the prism boundary
 * for a frame on its way through, and demanding four breaks Julian's point
 * 55. Three of four is where it settles.
 */
const CROSS_MIN_IN_PRISM = 3;
/** The last landing must follow the previous event within a rally. */
const RALLY_GAP_S = 1.2;

export interface NoReturnCall {
  loser: "near" | "far";
  lastLanding: DetectedEvent;
}

interface Geo {
  quad: [number, number][];
  nearMid: [number, number];
  axis: [number, number];
  axisLen2: number;
  sNet: number;
  /** Null when the corners will not make one; the prism test then passes
   *  everything, leaving the rule exactly as strict as it was before. */
  prism: readonly Pt[] | null;
}

function buildGeo(corners: Record<string, [number, number]> | null): Geo | null {
  if (!corners) return null;
  const near = Object.entries(corners)
    .filter(([k]) => k.includes("near")).map(([, v]) => v)
    .sort((a, b) => a[0] - b[0]);
  const far = Object.entries(corners)
    .filter(([k]) => k.includes("far")).map(([, v]) => v)
    .sort((a, b) => a[0] - b[0]);
  if (near.length !== 2 || far.length !== 2) return null;
  const [A, B] = near;
  const [D, C] = far;
  const seg = netSegment(corners);
  if (!seg) return null;
  const nearMid: [number, number] = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const farMid: [number, number] = [(D[0] + C[0]) / 2, (D[1] + C[1]) / 2];
  const axis: [number, number] = [farMid[0] - nearMid[0], farMid[1] - nearMid[1]];
  const axisLen2 = axis[0] * axis[0] + axis[1] * axis[1];
  const netMid = [(seg.e1[0] + seg.e2[0]) / 2, (seg.e1[1] + seg.e2[1]) / 2];
  return {
    quad: [A, B, C, D], nearMid, axis, axisLen2,
    sNet: ((netMid[0] - nearMid[0]) * axis[0] + (netMid[1] - nearMid[1]) * axis[1]) / axisLen2,
    prism: prismPolygon(corners),
  };
}

function inQuad(geo: Geo, x: number, y: number): boolean {
  const poly = geo.quad;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function onTable(e: DetectedEvent): boolean {
  return e.kind === "bounce"
    && e.u !== null && e.v !== null
    && e.u >= 0 && e.u <= TABLE_W_M
    && e.v >= 0 && e.v <= TABLE_L_M;
}

export function findNoReturn(
  events: readonly DetectedEvent[],
  track: readonly (readonly number[])[] | null,
  corners: Record<string, [number, number]> | null,
  clipT0: number | null,
  source: { width: number; height: number } | null,
): NoReturnCall | null {
  if (!track || clipT0 === null || !source) return null;
  const geo = buildGeo(corners);
  if (!geo) return null;

  const sorted = [...events].sort((a, b) => a.t - b.t);
  const landings = sorted.filter(onTable);
  if (!landings.length) return null;
  const L = landings[landings.length - 1];
  const H: "near" | "far" = (L.v as number) < NET_V_M ? "near" : "far";
  const hNear = H === "near";

  // part of this rally, not the next point
  const prev = sorted.filter((e) => e.t < L.t - 0.03);
  if (prev.length && L.t - prev[prev.length - 1].t > RALLY_GAP_S) return null;

  const tp = track.filter((q) => q[3] >= 1.0)
    .map((q) => ({ t: clipT0 + q[0], x: q[1] * source.width, y: q[2] * source.height }));

  // the landing itself must be in the track: descent, touch, rise
  let vSeen = false;
  for (let i = 2; i < tp.length - 2; i++) {
    const p = tp[i];
    if (Math.abs(p.t - L.t) > 0.25) continue;
    if (L.x == null || Math.hypot(p.x - (L.x as number), p.y - (L.y as number)) > 120) continue;
    if (p.y - tp[i - 2].y > 3 && p.y - tp[i + 2].y > 3) { vSeen = true; break; }
  }
  if (!vSeen) return null;

  const winEnd = L.t + NO_RETURN_WINDOW_S;
  const scanEnd = L.t + NO_RETURN_SCAN_S;

  // an unplaced bounce inside the quad is a landing we cannot rule on
  const blind = sorted.some((e) => e.kind === "bounce"
    && (e.u === null || e.v === null) && e.t > L.t && e.t <= winEnd
    && e.x != null && inQuad(geo, e.x as number, e.y as number));
  if (blind) return null;

  const winPts = tp.filter((p) => p.t > L.t && p.t <= winEnd);
  const expected = NO_RETURN_WINDOW_S / 0.0334;
  if (winPts.length / expected < NO_RETURN_MIN_COVER) return null;

  // a frozen track is furniture, not the ball
  let still = 0;
  for (let i = 1; i < winPts.length; i++) {
    if (Math.hypot(winPts[i].x - winPts[i - 1].x, winPts[i].y - winPts[i - 1].y) < 3) still++;
  }
  if (winPts.length > 1 && still / (winPts.length - 1) > 0.5) return null;

  // did the ball come back over the net?
  const along = (p: { x: number; y: number }) =>
    ((p.x - geo.nearMid[0]) * geo.axis[0] + (p.y - geo.nearMid[1]) * geo.axis[1]) / geo.axisLen2;
  const scanPts = tp.filter((p) => p.t > L.t && p.t <= scanEnd);
  for (let i = 0; i + CROSS_SUSTAIN <= scanPts.length; i++) {
    const run = scanPts.slice(i, i + CROSS_SUSTAIN);
    const onOther = run.every((p) => (along(p) < geo.sNet) !== hNear);
    if (!onOther) continue;
    const travel = Math.abs(along(run[run.length - 1]) - along(run[0]));
    const steps = run.every((p, k) =>
      k === 0 || Math.hypot(p.x - run[k - 1].x, p.y - run[k - 1].y) < 250);
    const inside = geo.prism === null
      ? CROSS_MIN_IN_PRISM
      : run.filter((p) => inPrism(geo.prism as readonly Pt[], p.x, p.y)).length;
    if (travel >= CROSS_MIN_TRAVEL && steps && inside >= CROSS_MIN_IN_PRISM) {
      return null;
    }
  }

  return { loser: H, lastLanding: L };
}

export function noReturnLoser(
  call: NoReturnCall | null,
  userPhysicalSide: "near" | "far" | null,
): "user" | "opponent" | null {
  if (call === null || userPhysicalSide === null) return null;
  return call.loser === userPhysicalSide ? "user" : "opponent";
}
