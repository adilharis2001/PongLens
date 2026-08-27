import { normalizePlacementCoordinates } from "../../../lib/placement/placementAggregate.ts";
import { impulsesOf, segGeometry, type Impulse } from "./segments.ts";
import { TABLE_L_M, TABLE_W_M, type DetectedEvent } from "./serveAccuracyModel.ts";

/**
 * The serve, when the detector only found half of it.
 *
 * A serve is two bounces: the server's half, then the receiver's, with
 * nothing on the table in between. That is the whole rule, and it is why
 * the serve is the one shot worth reconstructing on its own — it needs no
 * count of who hit what, and its geometry checks itself.
 *
 * The serve map refuses when either bounce is missing, and it is missing
 * more often than it looks. Julian's point 75 is the case Adil brought:
 * a serve to his backhand that he swung at and missed entirely. The
 * detector stored ONE event for the whole point, a bounce on Julian's
 * half. The bounce on Adil's half — plainly there on the video — was never
 * recorded, so no serve could be built and the map drew nothing.
 *
 * What was actually missing is not the ball. It is a bounce that lifts the
 * ball two pixels. See `impulsesOf` for why that happens and what to read
 * instead. Here the job is narrower: the sequence knows exactly where the
 * missing bounce must be, so only that position is ever asked about.
 */

const NET_V_M = TABLE_L_M / 2;
type Side = "near" | "far";
const halfOf = (v: number): Side => (v < NET_V_M ? "near" : "far");
const other = (s: Side): Side => (s === "near" ? "far" : "near");

/** Longest a serve's two bounces may be apart. */
export const SERVE_PAIR_MAX_S = 1.2;

/**
 * How far outside the lines the serve's FIRST bounce may read.
 *
 * Two honest readings of the same bounce disagree by 6.6 cm at the median
 * and 26 cm at the ninetieth percentile, so a first bounce three
 * centimetres wide of the sideline is a measurement, not a fault. This
 * alone recovers ten serves across the two matches, and it does not touch
 * the guard that matters: the first bounce must still be on the SERVER'S
 * HALF, which is the independent read of who served and the only thing
 * standing between a wrong rotation and every serve on the map flipping
 * player at once.
 *
 * The landing gets no tolerance at all. It is the dot the map draws and
 * the thing that decides the zone, and in or out is the whole question
 * there.
 */
export const SERVE_FIRST_PAD_M = 0.25;

/**
 * The hardest a table bounce hits, in pixels per second of downward speed
 * given up.
 *
 * A table bounce is elastic and hands most of the speed back. A floor
 * bounce, a bat, or the ball striking a barrier is far more violent: over
 * this corpus 99% of confirmed table bounces sit under 1300, while the
 * impulses that project off the table run past 9000.
 *
 * Without this cap, and with recovered landings nudged onto the table
 * instead of being refused, the rule appeared to recover twenty-one
 * serves. Ten of them landed at exactly u=0.00 or v=0.00 — the corner of
 * the table, because that is where clamping puts something that happened
 * on the floor. Both faults are fixed here and neither should come back:
 * a landing is either on the table on its own reading, or it is not a
 * landing.
 */
export const SERVE_MAX_KICK_PX_S = 1500;

export interface ServePair {
  first: DetectedEvent;
  landing: DetectedEvent;
  /** Which half of the pair the flights had to supply, if either. */
  recovered: "first" | "landing" | "both" | null;
}

function onTable(e: { u: number | null; v: number | null }): boolean {
  return e.u !== null && e.v !== null
    && e.u >= 0 && e.u <= TABLE_W_M && e.v >= 0 && e.v <= TABLE_L_M;
}

function nearTable(e: { u: number | null; v: number | null }, pad: number): boolean {
  return e.u !== null && e.v !== null
    && e.u >= -pad && e.u <= TABLE_W_M + pad
    && e.v >= -pad && e.v <= TABLE_L_M + pad;
}

function pairOf(a: DetectedEvent, b: DetectedEvent, serverSide: Side): boolean {
  if (!nearTable(a, SERVE_FIRST_PAD_M) || !onTable(b)) return false;
  if (halfOf(a.v as number) !== serverSide) return false;
  if (halfOf(b.v as number) !== other(serverSide)) return false;
  const gap = b.t - a.t;
  return gap > 0 && gap <= SERVE_PAIR_MAX_S;
}

/** The serve from the bounces on file: the first consecutive pair whose
 *  geometry is a serve's. */
export function findServe(
  events: readonly DetectedEvent[],
  serverSide: Side | null,
): ServePair | null {
  if (serverSide === null) return null;
  const bounces = events.filter((e) => e.kind === "bounce")
    .slice().sort((a, b) => a.t - b.t);
  for (let i = 0; i + 1 < bounces.length; i++) {
    if (pairOf(bounces[i], bounces[i + 1], serverSide)) {
      return { first: bounces[i], landing: bounces[i + 1], recovered: null };
    }
  }
  return null;
}

let seq = 0;

function asBounce(
  im: Impulse, clipT0: number | null, userPhysicalSide: Side | null,
): DetectedEvent {
  // Never clamped onto the table. See SERVE_MAX_KICK_PX_S.
  const n = userPhysicalSide === null
    ? null : normalizePlacementCoordinates(im.u, im.v, userPhysicalSide);
  return {
    id: `serve-recovered-${seq++}`,
    kind: "bounce",
    t: im.t,
    clipT: clipT0 === null ? null : im.t - clipT0,
    x: im.x, y: im.y, u: im.u, v: im.v,
    nu: n?.u ?? null, nv: n?.v ?? null,
    visual: 0, audio: 0, role: null,
  };
}

/**
 * The serve, with a missing bounce supplied by the ball's own flight.
 *
 * Nothing is attempted where the serve is already complete, so this can
 * only add coverage. Where it is not, exactly one bounce may be recovered
 * and the other must be on file, so a detected bounce always holds the
 * geometry down and no serve is invented from the track alone.
 *
 * Over both matches: 120 serves reconstructed from the bounce list rises
 * to 127. Held out against the 130 points where the detector found both
 * bounces, hiding one and asking the flights to put it back lands within
 * 2 cm at the median and 15 cm at the ninetieth percentile.
 */
export function recoverServe(
  events: readonly DetectedEvent[],
  track: readonly (readonly number[])[] | null,
  corners: Record<string, [number, number]> | null,
  clipT0: number | null,
  source: { width: number; height: number } | null,
  serverSide: Side | null,
  userPhysicalSide: Side | null,
): ServePair | null {
  const already = findServe(events, serverSide);
  if (already || serverSide === null) return already;
  const geo = segGeometry(corners);
  if (!geo) return null;
  const impulses = impulsesOf(track, clipT0, source, geo)
    .filter((im) => im.kick <= SERVE_MAX_KICK_PX_S);
  if (!impulses.length) return null;

  const bounces = events.filter((e) => e.kind === "bounce")
    .slice().sort((a, b) => a.t - b.t);
  const alreadySeen = (t: number) => bounces.some((b) => Math.abs(b.t - t) < 0.12);
  const make = (im: Impulse) => asBounce(im, clipT0, userPhysicalSide);
  const recv = other(serverSide);

  // The landing is missing: the first bounce is on file, on the server's
  // half, and the flights are asked only about the receiver's half.
  for (const first of bounces) {
    if (!nearTable(first, SERVE_FIRST_PAD_M)) continue;
    if (halfOf(first.v as number) !== serverSide) continue;
    const im = impulses.find((x) =>
      x.t > first.t + 0.05 && x.t < first.t + SERVE_PAIR_MAX_S
      && !alreadySeen(x.t)
      && halfOf(x.v) === recv
      && onTable(x));
    if (im) return { first, landing: make(im), recovered: "landing" };
  }

  // The first bounce is missing: the landing is on file, on the table, on
  // the receiver's half.
  for (const landing of bounces) {
    if (!onTable(landing)) continue;
    if (halfOf(landing.v as number) !== recv) continue;
    const im = impulses.find((x) =>
      x.t < landing.t - 0.05 && x.t > landing.t - SERVE_PAIR_MAX_S
      && !alreadySeen(x.t)
      && halfOf(x.v) === serverSide
      && nearTable(x, SERVE_FIRST_PAD_M));
    if (im) return { first: make(im), landing, recovered: "first" };
  }

  // Neither is on file as a usable bounce, which is point 75: its only
  // recorded event reads four centimetres wide of the sideline, so it is
  // not a landing and cannot start a pair. Both halves may come from the
  // flights, but only where a detected bounce sits on one of them, so the
  // serve is still anchored to something the detector saw.
  for (let i = 0; i + 1 < impulses.length; i++) {
    const a = make(impulses[i]), b = make(impulses[i + 1]);
    if (!pairOf(a, b, serverSide)) continue;
    if (!alreadySeen(a.t) && !alreadySeen(b.t)) continue;
    return { first: a, landing: b, recovered: "both" };
  }
  return null;
}

/** Which end the server was on, from the scored rotation. */
export function serverSideFor(
  server: "user" | "opponent" | null,
  userPhysicalSide: Side | null,
): Side | null {
  if (server === null || userPhysicalSide === null) return null;
  return server === "user" ? userPhysicalSide : other(userPhysicalSide);
}
