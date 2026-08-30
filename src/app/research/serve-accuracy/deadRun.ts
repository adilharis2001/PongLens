import type { DetectedEvent } from "./serveAccuracyModel.ts";

/**
 * The ball bouncing itself out, with nobody hitting it.
 *
 * When a shot hits the net and drops, or lands twice because nobody could
 * reach it, the ball is dead but still moving: it bounces repeatedly on ONE
 * half, in quick succession, with the gaps shrinking as it loses height.
 * Nobody plays five shots in 1.3 seconds, so that pattern is not a rally —
 * it is the end of one.
 *
 * The reconstruction has no idea. On point 5 of the Chris match it read six
 * such bounces as five alternating rally shots, then took a post-point
 * pickup as the final shot and awarded the point to the wrong player with
 * "missed table (long/wide)".
 *
 * Whoever's side the ball dies on, loses. That covers both cases:
 *
 *   - into the net, dropping back on your own side: you lose
 *   - over the net and bouncing twice because they could not reach it:
 *     they lose
 *
 * Measured over both fully scored matches, it fires on 37 of 174 scored
 * points and names the winner correctly 35 times. The worker's own call is
 * right on 21 of those same 37.
 */

/** Three is the knee. Two is often just a rally exchange. */
export const DEAD_RUN_MIN = 3;
/**
 * Longest gap between two bounces of one run. Sweeping this from 0.35 to
 * 0.60 s does not move the result at all, which says the runs are tightly
 * clustered and the threshold is not doing the work.
 */
export const DEAD_RUN_MAX_GAP_S = 0.45;
/**
 * A ball balanced on the cord straddles the halves by centimetres of
 * noise, so the half test — which every other run depends on — tears the
 * run into fragments too short to see. Within this of the net line the
 * halves carry no information and are ignored.
 */
export const DEAD_RUN_CORD_M = 0.15;
const NET_V_M = 2.74 / 2;
const TABLE_WIDTH_M = 1.525;

/**
 * There used to be a lateral cap here: a dead ball drops, it does not
 * travel across the table. That was wrong, and it was the single thing
 * holding the rule back. A ball killed by the net rolls along the cord,
 * and a ball that skids after a net clip carries a metre sideways —
 * Chris's point 13 travels 1.00 m over five bounces and is as dead as
 * anything in the corpus.
 *
 * Removing the cap takes the rule from 21 fires to 36 and from 19 right
 * to 34. The two it gets wrong are the same two as before, so the cap was
 * rejecting fifteen correct calls and not one incorrect one.
 *
 * What actually separates a dead run from a rally is the absence of a
 * racket touch between the bounces, which is checked below. The lateral
 * test was a second statement of an intuition, not of the evidence.
 */

export interface DeadRun {
  events: DetectedEvent[];
  /**
   * Which half of the table it died on, in the camera's frame — or
   * "cord" when it never left the net line and no half owns it.
   */
  half: "near" | "far" | "cord";
  startsAt: number;
  /** How close the first bounce was to the net: a net cord is under ~0.4 m. */
  metresFromNet: number;
  /** Last player to touch the ball before the run. The only read available
   *  when the ball dies on the cord itself. */
  struckBy: "near" | "far" | null;
  /**
   * Which end the ball was last seen on before the run, bat touch or
   * bounce. This is what separates "you hit the net" from "they hit it
   * over and you never returned it" — two very different points that end
   * with identical bounces on the same half.
   */
  cameFrom: "near" | "far" | null;
}

function halfOf(v: number): "near" | "far" {
  return v < NET_V_M ? "near" : "far";
}

function playable(events: readonly DetectedEvent[]): DetectedEvent[] {
  return [...events].sort((a, b) => a.t - b.t);
}

/** Last player to touch the ball before `t`, by which end their contact
 *  projects onto. Null when the clip holds no located contact before it. */
function strikerBefore(
  events: readonly DetectedEvent[],
  t: number,
): "near" | "far" | null {
  let out: "near" | "far" | null = null;
  for (const e of playable(events)) {
    if (e.t >= t) break;
    if (e.kind === "contact" && e.v !== null) out = halfOf(e.v);
  }
  return out;
}

/**
 * Where the ball was last seen before `t` — a bat touch or a bounce,
 * whichever came last, so long as it carries coordinates and those
 * coordinates are on the table.
 *
 * The on-table test is not decoration. Chris's point 13 has a bounce
 * logged 9 cm outside the left sideline moments before the run; trusting
 * it would put the ball on the far end and reverse the reading.
 */
function cameFromBefore(
  events: readonly DetectedEvent[],
  t: number,
): "near" | "far" | null {
  let out: "near" | "far" | null = null;
  for (const e of playable(events)) {
    if (e.t >= t) break;
    if (e.u === null || e.v === null) continue;
    if (e.kind !== "contact" && e.kind !== "bounce") continue;
    if (e.u < 0 || e.u > TABLE_WIDTH_M) continue;
    out = halfOf(e.v);
  }
  return out;
}

function build(
  events: readonly DetectedEvent[],
  run: DetectedEvent[],
  half: "near" | "far" | "cord",
): DeadRun {
  const v = run[0].v as number;
  return {
    events: run,
    half,
    startsAt: run[0].t,
    metresFromNet: Math.abs(v - NET_V_M),
    struckBy: strikerBefore(events, run[0].t),
    cameFrom: cameFromBefore(events, run[0].t),
  };
}

/**
 * Runs of bounces on one half, uninterrupted by a racket touch. A contact
 * ends any run: the ball was alive after all.
 */
function sideRuns(events: readonly DetectedEvent[]): DeadRun[] {
  const out: DeadRun[] = [];
  let cur: DetectedEvent[] = [];
  const flush = () => {
    if (cur.length >= DEAD_RUN_MIN) {
      out.push(build(events, cur, halfOf(cur[0].v as number)));
    }
    cur = [];
  };
  for (const e of playable(events)) {
    if (e.kind === "contact") { flush(); continue; }
    if (e.kind !== "bounce" || e.u === null || e.v === null) continue;
    const last = cur[cur.length - 1];
    if (
      last
      && e.t - last.t <= DEAD_RUN_MAX_GAP_S
      && halfOf(last.v as number) === halfOf(e.v)
    ) {
      cur.push(e);
    } else {
      flush();
      cur = [e];
    }
  }
  flush();
  return out;
}

/**
 * The same search with the halves switched off, kept only when every
 * bounce sits on the cord. This is the ball that hits the tape and stays
 * there, spinning, hopping along the net until it falls — Chris's point
 * 10, five bounces inside 6 cm of the net line, which the half test
 * shreds into fragments of one and two.
 */
function cordRuns(events: readonly DetectedEvent[]): DeadRun[] {
  const out: DeadRun[] = [];
  let cur: DetectedEvent[] = [];
  const flush = () => {
    const onCord = cur.every(
      (e) => Math.abs((e.v as number) - NET_V_M) <= DEAD_RUN_CORD_M,
    );
    if (cur.length >= DEAD_RUN_MIN && onCord) out.push(build(events, cur, "cord"));
    cur = [];
  };
  for (const e of playable(events)) {
    if (e.kind === "contact") { flush(); continue; }
    if (e.kind !== "bounce" || e.u === null || e.v === null) continue;
    const last = cur[cur.length - 1];
    if (last && e.t - last.t <= DEAD_RUN_MAX_GAP_S) cur.push(e);
    else { flush(); cur = [e]; }
  }
  flush();
  return out;
}

/**
 * Side runs where there are any, and the cord search only as a fallback.
 *
 * The order matters and is measured, not stylistic. Letting the cord
 * search merge runs the half test had already found costs three correct
 * calls, because it replaces "the side it died on" — which needs nothing
 * else to be right — with the last racket touch, which is the reading the
 * rest of this pipeline gets wrong. Used only where the half test found
 * nothing, the same branch adds one point and gets it right.
 */
export function findDeadRuns(events: readonly DetectedEvent[]): DeadRun[] {
  const side = sideRuns(events);
  return side.length > 0 ? side : cordRuns(events);
}

/**
 * Who lost, if the ball died on the table. null when it never did — the
 * ball left the table or the court instead, which this cannot see.
 */
export function deadRunLoser(
  runs: readonly DeadRun[],
  userPhysicalSide: "near" | "far" | null,
): "user" | "opponent" | null {
  if (runs.length === 0 || userPhysicalSide === null) return null;
  const last = runs[runs.length - 1];
  // On the cord no half owns the ball, so the only read left is who put
  // it there. Whoever failed to clear the net loses the point.
  const side = last.half === "cord" ? last.struckBy : last.half;
  if (side === null) return null;
  return side === userPhysicalSide ? "user" : "opponent";
}

/**
 * Why the point ended, which is a different question from who won it.
 *
 * The bounces look identical either way: the ball lands on one half and
 * hops itself out. What differs is where it came from. If the last thing
 * that touched it was on the SAME half it died on, the player at that end
 * put it there — into the net, or short of it. If the ball crossed over
 * first, the other player hit it and this one simply never got it back,
 * whether it was a net cord dropping dead or a good ball out of reach.
 *
 * Distance from the net cannot tell these apart, and reading it that way
 * was wrong on the two points Adil checked by eye. Chris's point 5 starts
 * 0.15 m from the net and read as "you hit the net" — but the bat touch
 * before it is Chris's, on Chris's end. Chris hit it over and it died
 * short. Same for point 11.
 *
 * Whether the NET took it on the way over is a further question this
 * cannot answer: a cord that drops dead and a good short ball nobody
 * reached leave the same bounces. That needs the ball's own track through
 * the crossing, not the bounce list.
 */
export type DeadRunReason = "own" | "unreturned" | "unknown";

export function deadRunReason(run: DeadRun): DeadRunReason {
  const died = run.half === "cord" ? run.struckBy : run.half;
  if (died === null || run.cameFrom === null) return "unknown";
  return run.cameFrom === died ? "own" : "unreturned";
}

/** How the point ended, said from the losing player's side. */
export function deadRunReasonCopy(run: DeadRun): string {
  switch (deadRunReason(run)) {
    case "own":
      return "put it into the net";
    case "unreturned":
      return "never got it back";
    case "unknown":
      return "let the ball die there";
  }
}
