import type { DetectedEvent } from "./serveAccuracyModel.ts";

/**
 * The other way a point ends: the ball never comes down on the table again.
 *
 * The dead run reads the ball dying ON the table. Everything else — into
 * the net and away, long, wide — leaves the table and is invisible to it.
 * That is 82 of the 174 scored points across these two matches, and the
 * reconstruction is right on 48% of them.
 *
 * The read is short. Take the last bounce that landed on the table.
 * Whoever's half it landed on plays the next shot. If that shot never
 * puts the ball back on the table, the player who hit it loses — and if
 * no shot follows at all and the ball sails off past their end, they
 * never returned it and lose the same way.
 *
 * Chris's point 14 is the case Adil brought: his shot hits the net and
 * goes off the side. The net is the cause, and no part of this rule knows
 * that or needs to. The last landing is on Chris's half, Chris plays the
 * next shot, nothing lands. Chris loses. The reconstruction said the
 * opposite.
 *
 * Trying to see the net itself was a dead end worth recording. The ball
 * track does show the trajectory reversing, but a detector built on it
 * fires on three quarters of all points at loose settings and slides
 * smoothly to zero as the threshold tightens, with the two matches
 * disagreeing at every step — no knee anywhere. The missing quantity is
 * height: a ball high over the far end and a ball touching the net occupy
 * the same pixel. A prism-exit terminator built from the ball track hit
 * the same wall and measured 74%. That is not going to be climbed from
 * the bounce list or from a 2D track.
 */

const NET_V_M = 2.74 / 2;
const TABLE_WIDTH_M = 1.525;
const TABLE_LENGTH_M = 2.74;

/**
 * Two touches a fifth of a second apart are one shot seen twice, not two
 * shots. Merging them is what lets point 14 through: its last shot is
 * logged as contacts 0.23 s apart, and counting events instead of shots
 * read that as a rally still in progress.
 */
export const OFF_TABLE_SHOT_GAP_S = 0.3;

/**
 * How far below the table's edge line, in metres at that spot, a detected
 * bounce has to sit before it counts as the floor. The floor is 0.76 m
 * down; half a metre is comfortably past detection noise. Point 12's
 * mis-projected return sat 28 px under the edge — inside this band, so it
 * reads as "too close to call" rather than as the point ending.
 */
export const FLOOR_BELOW_EDGE_M = 0.5;

/**
 * A bounce the homography places off the table but within this of the
 * lines is an edge ball or a landing with projection error — Julian's
 * point 52 has a real landing projected 0.12 m past the end line. Beyond
 * it, the projection itself says floor: the worker's own rejects carry
 * readings like u=3.45, a bounce two metres wide of the table.
 */
export const OFF_TABLE_OVERSHOOT_M = 0.5;

/**
 * A racket touch this soon after the supposed floor bounce means the ball
 * was not dead — a save, or the bounce was never floor at all. A pickup
 * after a finished point comes seconds later, not within half of one.
 * This single gate removed both residual wrong calls in the sweep.
 */
export const TOUCH_AFTER_FLOOR_S = 0.4;

/**
 * How many landings back the alternation test looks.
 *
 * It used to read the whole rally, and that punished long points for
 * being long. Julian's point 21 runs eleven shots; one landing is missed
 * around the fifth, the halves repeat there, and the gate threw away a
 * read that depends on none of it — the rule uses the LAST landing and
 * the shot after it, so a gap in the middle of the rally is no evidence
 * against it. Every extra shot was another chance to be disqualified for
 * an irrelevant reason.
 *
 * Three is the knee: 34 fires and 32 right, against 31 and 29 reading the
 * whole rally. Two reaches 38 but starts calling points wrong (Julian 68),
 * because with a single pair there is nothing left to notice a missed
 * landing right at the end — which is the one that would matter.
 */
export const OFF_TABLE_ALT_TAIL = 3;

export interface OffTableGeometry {
  /** Calibrated corners in source pixels, the pipeline's A/B near, C/D far. */
  corners: Record<string, [number, number]>;
}

export interface OffTableCall {
  /** The last bounce that actually landed on the table. */
  lastLanding: DetectedEvent;
  /** Which half it landed on, and so who played the shot that failed. */
  struckBy: "near" | "far";
  /** Shots played after that landing, touches merged into shots. */
  shotsAfter: number;
  /** How the point was seen to end. "shot": the shot after the landing
   *  never came down; "unreturned": no shot at all, the ball sailed off
   *  past the loser's end; "open": no terminator seen, the older read. */
  via: "shot" | "unreturned" | "open";
  /** The floor bounce that ended it, when one was seen. */
  endedBy: DetectedEvent | null;
  /** Why the call is withheld, or null when it is trusted. */
  refusal: string | null;
  /** Convenience: refusal === null. */
  trusted: boolean;
}

function onTable(e: DetectedEvent): boolean {
  return e.kind === "bounce"
    && e.u !== null && e.v !== null
    && e.u >= 0 && e.u <= TABLE_WIDTH_M
    && e.v >= 0 && e.v <= TABLE_LENGTH_M;
}

function halfOf(v: number): "near" | "far" {
  return v < NET_V_M ? "near" : "far";
}

/**
 * The landings, with the ones that are not landings taken out.
 *
 * Two kinds of impostor, both found on Julian's point 21. A "bounce"
 * logged at the same instant as a racket touch is the bat being seen
 * twice, not the ball hitting the table. And two landings a tenth of a
 * second apart on the same half are one landing detected twice — a real
 * second bounce comes later than that, and belongs to the dead run.
 *
 * Left in, both fake a repeated half and disqualify the point through the
 * alternation gate.
 */
export function dedupeLandings(sorted: readonly DetectedEvent[]): DetectedEvent[] {
  const out: DetectedEvent[] = [];
  for (const e of sorted) {
    if (!onTable(e)) continue;
    if (sorted.some((x) => x.kind === "contact" && Math.abs(x.t - e.t) < 0.02)) continue;
    const prev = out[out.length - 1];
    if (prev
      && e.t - prev.t < 0.15
      && halfOf(e.v as number) === halfOf(prev.v as number)) continue;
    out.push(e);
  }
  return out;
}

/** Metres outside the table rectangle, 0 when on it. */
function overshootM(e: DetectedEvent): number | null {
  if (e.u === null || e.v === null) return null;
  const du = Math.max(0 - e.u, e.u - TABLE_WIDTH_M, 0);
  const dv = Math.max(0 - e.v, e.v - TABLE_LENGTH_M, 0);
  return Math.hypot(du, dv);
}

interface Geometry {
  quad: [number, number][];
  nearMid: [number, number];
  axis: [number, number];
  axisLen2: number;
  ppmNear: number;
  ppmFar: number;
}

function buildGeometry(g: OffTableGeometry | null | undefined): Geometry | null {
  const c = g?.corners;
  if (!c) return null;
  const near = Object.entries(c).filter(([k]) => k.includes("near")).map(([, v]) => v);
  const far = Object.entries(c).filter(([k]) => k.includes("far")).map(([, v]) => v);
  if (near.length !== 2 || far.length !== 2) return null;
  const [A, B] = near;
  const [D, C2] = far;
  const nearMid: [number, number] = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const farMid: [number, number] = [(D[0] + C2[0]) / 2, (D[1] + C2[1]) / 2];
  const axis: [number, number] = [farMid[0] - nearMid[0], farMid[1] - nearMid[1]];
  return {
    quad: [A, B, C2, D],
    nearMid,
    axis,
    axisLen2: axis[0] * axis[0] + axis[1] * axis[1],
    ppmNear: Math.hypot(B[0] - A[0], B[1] - A[1]) / TABLE_WIDTH_M,
    ppmFar: Math.hypot(C2[0] - D[0], C2[1] - D[1]) / TABLE_WIDTH_M,
  };
}

function inQuad(geo: Geometry, x: number, y: number): boolean {
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

/** y of the quad's lower boundary at this x. */
function lowerEdgeY(geo: Geometry, x: number): number {
  const poly = geo.quad;
  let best = -Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((xi <= x && x <= xj) || (xj <= x && x <= xi)) {
      if (xi === xj) { best = Math.max(best, yi, yj); continue; }
      best = Math.max(best, yi + ((yj - yi) * (x - xi)) / (xj - xi));
    }
  }
  if (best === -Infinity) {
    let d = Infinity;
    for (const [cx, cy] of poly) {
      const dd = Math.abs(cx - x);
      if (dd < d) { d = dd; best = cy; }
    }
  }
  return best;
}

/** 0 at the near end line, 1 at the far end line, along the table axis. */
function axisFraction(geo: Geometry, x: number, y: number): number {
  return ((x - geo.nearMid[0]) * geo.axis[0] + (y - geo.nearMid[1]) * geo.axis[1])
    / geo.axisLen2;
}

function pixelsPerMetreAt(geo: Geometry, x: number, y: number): number {
  const s = Math.min(1, Math.max(0, axisFraction(geo, x, y)));
  return geo.ppmNear + s * (geo.ppmFar - geo.ppmNear);
}

/**
 * What a bounce in the window is, once it is not a clean table landing.
 *
 * "floor": the ball is provably dead — projected well past the lines, or
 * its pixel sits more than half a metre under the table's edge.
 * "ambiguous": everything that might still be a landing we failed to
 * place — inside the quad, hugging the edge line, just past the lines, or
 * carrying no pixel at all. One of these before the terminator poisons
 * the whole read.
 */
function classify(geo: Geometry | null, e: DetectedEvent): "table" | "floor" | "ambiguous" {
  if (onTable(e)) return "table";
  const over = overshootM(e);
  if (over !== null) return over >= OFF_TABLE_OVERSHOOT_M ? "floor" : "ambiguous";
  if (geo === null || e.x === null || e.x === undefined) return "ambiguous";
  const x = e.x as number, y = e.y as number;
  if (inQuad(geo, x, y)) return "ambiguous";
  const drop = y - lowerEdgeY(geo, x);
  return drop > FLOOR_BELOW_EDGE_M * pixelsPerMetreAt(geo, x, y) ? "floor" : "ambiguous";
}

export function findOffTable(
  events: readonly DetectedEvent[],
  geometry?: OffTableGeometry | null,
): OffTableCall | null {
  const geo = buildGeometry(geometry);
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const landings = dedupeLandings(sorted);
  if (landings.length === 0) return null;
  const lastLanding = landings[landings.length - 1];
  const struckBy = halfOf(lastLanding.v as number);

  // A half repeating means a landing was missed, and the read is then
  // following the wrong shot. Only the tail matters: the rule rests on
  // the last landing and the shot after it, so a gap earlier in the rally
  // is no evidence against it. The serve lands twice on the same side by
  // design, so the comparison never reaches back past the second landing.
  let alternates = true;
  const from = Math.max(2, landings.length - OFF_TABLE_ALT_TAIL + 1);
  for (let i = from; i < landings.length; i++) {
    if (halfOf(landings[i].v as number) === halfOf(landings[i - 1].v as number)) {
      alternates = false;
    }
  }

  const win = sorted.filter((e) => e.t > lastLanding.t + 0.03);
  const bounces = win.filter((e) => e.kind === "bounce");
  const terminator = bounces.find((e) => classify(geo, e) === "floor") ?? null;

  const make = (
    via: OffTableCall["via"],
    shotsAfter: number,
    refusal: string | null,
  ): OffTableCall => ({
    lastLanding, struckBy, shotsAfter, via,
    endedBy: terminator,
    refusal: !alternates ? "a landing was missed" : refusal,
    trusted: alternates && refusal === null,
  });

  if (terminator !== null) {
    const before = win.filter((e) => e.t < terminator.t);
    const touches = before.filter((e) => e.kind === "contact");
    let shots = touches.length ? 1 : 0;
    for (let i = 1; i < touches.length; i++) {
      if (touches[i].t - touches[i - 1].t > OFF_TABLE_SHOT_GAP_S) shots++;
    }
    if (before.some((e) => e.kind === "bounce" && classify(geo, e) === "ambiguous")) {
      return make("shot", shots, "the ball bounced somewhere too close to call");
    }
    if (win.some((e) => e.kind === "contact"
      && e.t >= terminator.t && e.t < terminator.t + TOUCH_AFTER_FLOOR_S)) {
      return make("shot", shots, "touched right after it dropped, so it was not dead");
    }
    if (shots > 1) {
      return make("shot", shots, `${shots} shots after the last landing`);
    }
    if (shots === 0) {
      // Untouched, the ball must leave past the end it landed on; a floor
      // bounce anywhere else means a touch was missed.
      const pastEnd = terminator.u !== null && terminator.v !== null
        ? (struckBy === "far"
          ? (terminator.v as number) > TABLE_LENGTH_M
          : (terminator.v as number) < 0)
        : geo !== null && terminator.x !== null && terminator.x !== undefined
          ? (struckBy === "far"
            ? axisFraction(geo, terminator.x as number, terminator.y as number) > 0.85
            : axisFraction(geo, terminator.x as number, terminator.y as number) < 0.15)
          : false;
      if (!pastEnd) {
        return make("unreturned", 0, "the ball died on the wrong side to have gone unreturned");
      }
      return make("unreturned", 0, null);
    }
    // One shot: when the toucher was located, it must be the same side.
    const located = touches.find((e) => e.v !== null);
    if (located && halfOf(located.v as number) !== struckBy) {
      return make("shot", 1, "the shot came from the wrong side");
    }
    return make("shot", 1, null);
  }

  // No terminator seen: the older read, unchanged — except that a point
  // whose record simply stops after the last landing now says so, rather
  // than returning nothing. 34 of the two matches' scored points end this
  // way: no touch, no floor bounce, no ending of any kind on record.
  const touches = win.filter((e) => e.kind === "contact");
  if (touches.length === 0) {
    return make("open", 0, "nothing followed the last landing");
  }
  let shots = 1;
  for (let i = 1; i < touches.length; i++) {
    if (touches[i].t - touches[i - 1].t > OFF_TABLE_SHOT_GAP_S) shots++;
  }
  const blind = win.some((e) => e.kind === "bounce"
    && (e.u === null || e.v === null) && e.t < touches[0].t + 0.03);
  if (blind) {
    return make("open", shots, "the ball bounced somewhere we could not place");
  }
  if (shots !== 1) {
    return make("open", shots, `${shots} shots after the last landing`);
  }
  return make("open", 1, null);
}

/**
 * Who lost, when the call is one worth making.
 *
 * With the floor terminator and its two consistency gates — untouched
 * balls must leave past the loser's end, and a touch within 0.4 s of the
 * floor bounce un-kills the ball — this fires on 35 of the 174 scored
 * points and is right on 34. The reconstruction is right on 16 of the
 * same 35. Before the terminator existed it was 32 fires and 30 right,
 * and the sweep that got here is in the git history: pixel margins 0.4
 * and 0.5 and overshoots 0.3 to 0.8 all land within a point of each
 * other, so no threshold is doing the work alone.
 */
export function offTableLoser(
  call: OffTableCall | null,
  userPhysicalSide: "near" | "far" | null,
): "user" | "opponent" | null {
  if (call === null || !call.trusted || userPhysicalSide === null) return null;
  return call.struckBy === userPhysicalSide ? "user" : "opponent";
}

/** Why the call is being withheld, for the review page. */
export function offTableWithheld(call: OffTableCall | null): string | null {
  return call?.refusal ?? null;
}
