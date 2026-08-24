import type { DetectedEvent } from "./serveAccuracyModel";

/**
 * The ball bouncing itself out, with nobody hitting it.
 *
 * When a shot hits the net and drops, or lands twice because nobody could
 * reach it, the ball is dead but still moving: it bounces repeatedly on ONE
 * half, in quick succession, going almost nowhere sideways, with the gaps
 * shrinking as it loses height. Nobody plays five shots in 1.3 seconds, so
 * that pattern is not a rally — it is the end of one.
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
 * Measured over both fully scored matches, on the 21 points where it
 * fires it names the winner correctly 19 times. The worker's own call is
 * right on 12 of those same 21.
 */

/** Three is the knee. Two is often just a rally exchange. */
export const DEAD_RUN_MIN = 3;
/**
 * Longest gap between two bounces of one run. Sweeping this from 0.35 to
 * 0.60 s does not move the result at all, which says the runs are tightly
 * clustered and the threshold is not doing the work.
 */
export const DEAD_RUN_MAX_GAP_S = 0.45;
/** A dead ball drops; it does not travel across the table. */
export const DEAD_RUN_MAX_LATERAL_M = 0.35;
const NET_V_M = 2.74 / 2;

export interface DeadRun {
  events: DetectedEvent[];
  /** Which half of the table it died on, in the camera's frame. */
  half: "near" | "far";
  startsAt: number;
  /** How close the first bounce was to the net: a net cord is under ~0.4 m. */
  metresFromNet: number;
}

export function findDeadRuns(events: readonly DetectedEvent[]): DeadRun[] {
  const runs: DeadRun[] = [];
  let cur: DetectedEvent[] = [];
  const flush = () => {
    if (cur.length >= DEAD_RUN_MIN) {
      const us = cur.map((e) => e.u as number);
      if (Math.max(...us) - Math.min(...us) <= DEAD_RUN_MAX_LATERAL_M) {
        const v = cur[0].v as number;
        runs.push({
          events: cur,
          half: v < NET_V_M ? "near" : "far",
          startsAt: cur[0].t,
          metresFromNet: Math.abs(v - NET_V_M),
        });
      }
    }
    cur = [];
  };
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    // A racket touch ends any run: the ball was alive after all.
    if (e.kind === "contact") { flush(); continue; }
    if (e.kind !== "bounce" || e.u === null || e.v === null) continue;
    const half = e.v < NET_V_M ? "near" : "far";
    const last = cur[cur.length - 1];
    if (
      last
      && e.t - last.t <= DEAD_RUN_MAX_GAP_S
      && ((last.v as number) < NET_V_M ? "near" : "far") === half
    ) {
      cur.push(e);
    } else {
      flush();
      cur = [e];
    }
  }
  flush();
  return runs;
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
  return last.half === userPhysicalSide ? "user" : "opponent";
}
