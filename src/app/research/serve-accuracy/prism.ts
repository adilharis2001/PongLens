/**
 * The volume a rally lives inside, and the moment the ball leaves it.
 *
 * A port of prism_polygon / in_prism / final_exits in worker/points_endon.py
 * (lab s47, s49), so the research page draws the same shape the end-on
 * assembler reasons about rather than a second guess at it.
 *
 * The idea: lift the calibrated table quad by a fixed height in METRES and
 * take the convex hull of the eight points. The lift is converted to pixels
 * separately at each end, because the far end of the table is smaller in
 * frame — one pixel height would be a different real height at each end.
 * The ball leaves that region exactly once per point, when it is finally
 * missed.
 */

/** How high above the table a ball may plausibly be. */
export const PRISM_H_M = 1.6;
/** Out of the volume, or unseen, this long means it is not coming back. */
export const RETURN_GAP_S = 1.8;
const TABLE_W_M = 1.525;

export type Pt = readonly [number, number];

function hull(points: Pt[]): Pt[] {
  // Andrew's monotone chain. The lifted quad is convex in practice, but a
  // bad calibration can order the corners oddly and a hull is cheap.
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (src: Pt[]) => {
    const out: Pt[] = [];
    for (const p of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) {
        out.pop();
      }
      out.push(p);
    }
    return out;
  };
  const lower = build(pts);
  const upper = build([...pts].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * The prism in image space, from the four calibrated corners.
 *
 * Corner keys are the pipeline's: A/B near (the end lower in frame),
 * C/D far. Near and far are each sorted by x so left and right are read
 * from the picture rather than from the label.
 */
export function prismPolygon(
  corners: Record<string, [number, number]>,
): Pt[] | null {
  const near = Object.entries(corners)
    .filter(([k]) => k.includes("near"))
    .map(([, v]) => v)
    .sort((a, b) => a[0] - b[0]);
  const far = Object.entries(corners)
    .filter(([k]) => k.includes("far"))
    .map(([, v]) => v)
    .sort((a, b) => a[0] - b[0]);
  if (near.length !== 2 || far.length !== 2) return null;
  const [A, B] = near;
  const [D, C] = far;
  const ppmNear = Math.hypot(B[0] - A[0], B[1] - A[1]) / TABLE_W_M;
  const ppmFar = Math.hypot(C[0] - D[0], C[1] - D[1]) / TABLE_W_M;
  const pts: Pt[] = [];
  for (const [P, ppm] of [
    [A, ppmNear],
    [B, ppmNear],
    [C, ppmFar],
    [D, ppmFar],
  ] as const) {
    pts.push([P[0], P[1]]);
    pts.push([P[0], P[1] - ppm * PRISM_H_M]);
  }
  return hull(pts);
}

/** Ray casting. Convexity is not assumed. */
export function inPrism(poly: readonly Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (
      yi > y !== yj > y
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Moments the ball leaves the volume and does not come back.
 *
 * Leaving counts two ways: crossing the boundary, or simply vanishing for
 * longer than the return gap — a ball the tracker loses on its way out of
 * frame has still left. A return inside the gap cancels the exit.
 */
export function finalExits(
  track: readonly (readonly number[])[],
  poly: readonly Pt[],
  width: number,
  height: number,
): number[] {
  const states = track.map(
    ([t, fx, fy]) => [t, inPrism(poly, fx * width, fy * height)] as const,
  );
  const exits: number[] = [];
  for (let i = 1; i < states.length; i += 1) {
    const [tPrev, inPrev] = states[i - 1];
    const [tCur, inCur] = states[i];
    if (!inPrev) continue;
    if (!(!inCur || tCur - tPrev >= RETURN_GAP_S)) continue;
    let back = false;
    for (let j = i; j < states.length; j += 1) {
      const [t2, in2] = states[j];
      if (t2 - tPrev > RETURN_GAP_S) break;
      if (in2) { back = true; break; }
    }
    if (!back) exits.push(tPrev);
  }
  return exits;
}
