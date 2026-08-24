import type { DetectedEvent } from "./serveAccuracyModel";

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
 * Within this of the net, the net did it: the ball hit the cord and
 * dropped, or clipped it and dribbled over.
 *
 * The 37 runs cluster hard — thirty of them start between 0.01 and 0.29 m
 * of the net, then a gap, then a thin tail out to 0.60 m. 0.30 is where
 * the gap is, so that is the line.
 *
 * What the tail is cannot be read from this number, and the honest answer
 * is to stop claiming. Chris's point 13 starts 0.42 m out and Adil, who
 * was there, says the net took it — and he is right: the ball touches the
 * net at 196.258 s, a racket touch follows, and only then does the run
 * begin. The net is upstream of the run, so the run's own distance cannot
 * see it. A first bounce near the net proves the net was involved; a first
 * bounce away from it proves nothing either way.
 */
export const DEAD_RUN_NET_CORD_M = 0.3;

export type DeadRunReason = "net" | "unknown";

export function deadRunReason(run: DeadRun): DeadRunReason {
  if (run.half === "cord") return "net";
  return run.metresFromNet <= DEAD_RUN_NET_CORD_M ? "net" : "unknown";
}

/** How the point ended, from the loser's side of the table. Says nothing
 *  about the cause when the run cannot support one. */
export function deadRunReasonCopy(run: DeadRun): string {
  return deadRunReason(run) === "net"
    ? "hit the net"
    : "let the ball die there";
}
