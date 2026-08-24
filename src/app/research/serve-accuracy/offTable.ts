import type { DetectedEvent } from "./serveAccuracyModel";

/**
 * The other way a point ends: the ball never comes down on the table again.
 *
 * The dead run reads the ball dying ON the table. Everything else — into
 * the net and away, long, wide — leaves the table and is invisible to it.
 * That is 82 of the 174 scored points across these two matches, and the
 * reconstruction is right on 48% of them.
 *
 * The read is short. Take the last bounce that landed on the table.
 * Whoever's half it landed on plays the next shot. If a bat touch follows
 * and nothing lands after it, that shot did not make the table, and the
 * player who hit it loses the point.
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
 * the same pixel. That is the same wall the prism ran into, and it is not
 * going to be climbed from the bounce list or from a 2D track.
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

export interface OffTableCall {
  /** The last bounce that actually landed on the table. */
  lastLanding: DetectedEvent;
  /** Which half it landed on, and so who played the shot that failed. */
  struckBy: "near" | "far";
  /** Shots played after that landing, touches merged into shots. */
  shotsAfter: number;
  /**
   * Whether the bounces swapped halves every time after the serve. A half
   * repeating means a landing was missed, and then "whoever's half it
   * landed on plays next" is reading the wrong shot.
   */
  alternates: boolean;
  /** Both gates passed: the call is worth showing. */
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

export function findOffTable(
  events: readonly DetectedEvent[],
): OffTableCall | null {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const landings = sorted.filter(onTable);
  if (landings.length === 0) return null;
  const lastLanding = landings[landings.length - 1];

  const after = sorted.filter((e) => e.t > lastLanding.t + 0.03);
  const touches = after.filter((e) => e.kind === "contact");
  if (touches.length === 0) return null;

  let shotsAfter = 1;
  for (let i = 1; i < touches.length; i++) {
    if (touches[i].t - touches[i - 1].t > OFF_TABLE_SHOT_GAP_S) shotsAfter += 1;
  }

  // The serve lands twice on the same side of the net by design, so the
  // alternation test starts after it.
  let alternates = true;
  for (let i = 2; i < landings.length; i++) {
    if (halfOf(landings[i].v as number) === halfOf(landings[i - 1].v as number)) {
      alternates = false;
    }
  }

  return {
    lastLanding,
    struckBy: halfOf(lastLanding.v as number),
    shotsAfter,
    alternates,
    trusted: alternates && shotsAfter === 1,
  };
}

/**
 * Who lost, when the call is one worth making.
 *
 * Ungated the rule is right on 57 of 82, which is not far enough above
 * the reconstruction's 39 to be worth showing. Requiring the bounces to
 * alternate and exactly one shot to follow the last landing leaves 41
 * points and 36 right. Adding a third gate — the serve landing on the
 * server's own half first — reads 13 of 13, but thirteen points is not
 * evidence of a better rule, only of a smaller sample, so it is left out.
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
  if (call === null) return null;
  if (!call.alternates) return "a landing was missed";
  if (call.shotsAfter !== 1) return `${call.shotsAfter} shots after the last landing`;
  return null;
}
