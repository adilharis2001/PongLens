import { TABLE_L_M, type DetectedEvent } from "./serveAccuracyModel.ts";

/**
 * Every touch in a point, in order, named the way a player would name it.
 *
 * The page already draws these on the clip and on the little court, but a
 * ring appearing on a video for a third of a second does not tell you
 * whether you are looking at the serve's second bounce or the third ball of
 * the rally. This turns the same events into a readable list.
 *
 * WHICH PARTS SURVIVE A WRONG SERVER. The half a bounce landed on comes
 * from the ball's table coordinate and the end the uploader was on, so it
 * is right whatever the rotation believes. The words "serve" and "rally",
 * on the other hand, come from the reconstruction's shot list, which is
 * built for an assumed server — so those are flagged, and the list is
 * written to read correctly with them stripped out. That ordering matters:
 * the first bounce of a serve is on the server's OWN half, so a list that
 * keeps its halves honest lets you settle who served by eye even when the
 * rotation has drifted.
 */

export type Half = "yours" | "theirs" | null;

export interface Touch {
  event: DetectedEvent;
  /** 1-based position among all this point's touches. */
  n: number;
  /** "Serve, 1st bounce" / "Rally bounce 2" / "Hit" / "Net". */
  label: string;
  half: Half;
  /** The label came from the shot list, so a wrong server can move it. */
  fromServer: boolean;
  /** Seconds into the clip; null when the clip offset is unknown. */
  at: number | null;
}

/**
 * Which half a bounce landed on, in the uploader's own terms.
 *
 * v runs from 0 at the near end of the table to TABLE_L_M at the far end,
 * so v below the halfway mark is the near half. Whether that is "yours"
 * depends on the end the uploader was on for THIS point — ends swap every
 * game, which is why the caller passes the point's side and not the match's.
 */
export function halfOf(
  e: Pick<DetectedEvent, "v">,
  userPhysicalSide: "near" | "far" | null,
): Half {
  if (e.v === null || userPhysicalSide === null) return null;
  return (e.v < TABLE_L_M / 2) === (userPhysicalSide === "near")
    ? "yours"
    : "theirs";
}

const ORDINAL = ["1st", "2nd", "3rd"];
const ordinal = (n: number) => ORDINAL[n - 1] ?? `${n}th`;

/**
 * The touches of one point, ordered and named.
 *
 * Bounces carry their own running count, so "3rd bounce after the serve"
 * means the third time the ball hit the table once the serve was over,
 * which is the number a player would say. Racket contacts are not numbered
 * — they interleave with the bounces and numbering both makes neither
 * readable.
 */
export function touchList(
  events: readonly DetectedEvent[],
  userPhysicalSide: "near" | "far" | null,
): Touch[] {
  const ordered = [...events].sort((a, b) => a.t - b.t);
  // A clip opens before the point does. It routinely carries the tail of
  // the previous rally and the server bouncing the ball on the table before
  // they serve, so the first bounce in the list is often not the first
  // bounce of the point — counting from it called a leftover from the last
  // rally "the 1st bounce after the serve". Everything before the serve's
  // own first bounce is named as such and left out of the count.
  const serveAt = ordered.findIndex((e) => e.role === "serve_first_bounce");
  const landingAt = ordered.findIndex((e) => e.role === "serve_landing");
  const hasServe = serveAt >= 0 || landingAt >= 0;
  const startsAt = landingAt >= 0 ? landingAt : serveAt;
  let rallyBounce = 0;
  return ordered.map((event, i) => {
    const half = halfOf(event, userPhysicalSide);
    let label: string;
    let fromServer = false;
    if (event.role === "serve_first_bounce") {
      label = "Serve, 1st bounce";
      fromServer = true;
    } else if (event.role === "serve_landing") {
      label = "Serve, 2nd bounce";
      fromServer = true;
    } else if (event.kind === "bounce") {
      if (hasServe && i < startsAt) {
        label = "Before the serve";
        fromServer = true;
      } else {
        rallyBounce += 1;
        // Without a serve to count from there is no "after the serve" to
        // claim, so the bounces are numbered and nothing more is implied.
        label = hasServe
          ? `${ordinal(rallyBounce)} bounce after the serve`
          : `Bounce ${rallyBounce}`;
        fromServer = hasServe;
      }
    } else if (event.kind === "contact") {
      label = "Hit";
      fromServer = event.role === "contact";
    } else if (event.kind === "net") {
      label = "Net";
    } else if (event.kind === "out") {
      label = "Out";
    } else if (event.kind === "impact") {
      label = "Impact";
    } else {
      label = event.kind;
    }
    return { event, n: i + 1, label, half, fromServer, at: event.clipT };
  });
}

/**
 * Which touch the playhead is sitting on, or -1.
 *
 * A touch holds the highlight from its own moment until the next one, so
 * there is always exactly one lit while the ball is in play; before the
 * first touch nothing is lit. A 30fps event is a single instant, and
 * lighting it only for that instant would flicker past unseen.
 */
export function activeTouch(touches: readonly Touch[], now: number): number {
  let active = -1;
  for (let i = 0; i < touches.length; i += 1) {
    const at = touches[i].at;
    if (at === null) continue;
    if (at <= now + 0.02) active = i;
    else break;
  }
  return active;
}
