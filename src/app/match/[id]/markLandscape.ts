/**
 * "Mark the points" on a phone held sideways: where every zone goes.
 *
 * Approved 2026-09-24 as drawn in the landscape mockups
 * (docs/superpowers/specs/2026-09-24-ios-hand-cut-landscape-mockup.dc.html,
 * canvas https://claude.ai/artifact/J7kQo15ZN2SFAZBvfeLJrt). This is that
 * board's renderVals() arithmetic, number for number, so the web and the
 * iPhone build the same screen from one statement of it:
 *
 *   - a solid top bar, 42 tall, across the whole width
 *   - a solid bottom bar, 41 tall plus the bottom safe area
 *   - between them the picture, as wide as its aspect ratio allows inside
 *     the height left, with a rail either side at least 96 wide
 *   - 12 px of margin inside the left and right safe areas
 *
 * Pure on purpose: the web measures the window and hands the numbers in,
 * and the Swift port runs the same function over the same inputs
 * (markLandscape.test.ts holds the cases).
 */

export const TOP_BAR_H = 42;
export const BOTTOM_BAR_H = 41;
/** Space between a rail and the picture, and between tiles in a rail. */
export const RAIL_GAP = 8;
/** A rail is never narrower than this: Scorekeeper's floor. */
export const MIN_RAIL = 96;
/** Inside the left and right safe areas, before the first zone. */
export const SIDE_MARGIN = 12;
/** The Let tile, shorter than Me and Them. */
export const LET_H = 44;

export interface SafeInsets {
  left: number;
  right: number;
  bottom: number;
}

export interface MarkLandscape {
  /** Width the rails, the picture and the bars' contents share. */
  avail: number;
  /** Left edge of that width (the left safe area plus the margin). */
  x0: number;
  /** Height between the two bars. */
  midH: number;
  /** The picture's box. */
  boxW: number;
  boxH: number;
  /** A rail's share of the width, gap included, and its tiles' width. */
  rail: number;
  tileW: number;
  /** Top of the rails and the picture, centred between the bars. */
  yMid: number;
  leftX: number;
  picX: number;
  rightX: number;
  /** The bottom bar: where it starts and how tall it is, safe area in. */
  bottomTop: number;
  bottomH: number;
  /** Type sizes that step with the rail's width. */
  pairFont: number;
  answerFont: number;
  /** Me and Them are this tall; Let is LET_H. */
  answerH: number;
  /** Each tile of a two-tile pair. */
  pairHalf: number;
}

/**
 * The layout for a `w` x `h` screen with the given safe areas.
 *
 * `aspect` is the video's width over height. The approved boards are
 * 16:9, which is the default and every case the mockup draws; another
 * shape keeps the same rules with its own box rather than a 16:9 box
 * with bars inside it.
 */
export function markLandscape(
  w: number,
  h: number,
  insets: SafeInsets = { left: 0, right: 0, bottom: 0 },
  aspect = 16 / 9
): MarkLandscape {
  const sl = insets.left;
  const sr = insets.right;
  const sb = insets.bottom;
  const ar = aspect > 0 && Number.isFinite(aspect) ? aspect : 16 / 9;

  const avail = w - sl - sr - 2 * SIDE_MARGIN;
  const midH = h - sb - TOP_BAR_H - BOTTOM_BAR_H;
  const boxW = Math.max(0, Math.min(avail - 2 * MIN_RAIL, midH * ar));
  const boxH = boxW / ar;
  const rail = Math.max(MIN_RAIL, (avail - boxW) / 2);
  const tileW = rail - RAIL_GAP;
  const x0 = sl + SIDE_MARGIN;
  const yMid = TOP_BAR_H + (midH - boxH) / 2;
  const leftX = x0;
  const picX = x0 + rail;
  const rightX = picX + boxW + RAIL_GAP;

  return {
    avail,
    x0,
    midH,
    boxW,
    boxH,
    rail,
    tileW,
    yMid,
    leftX,
    picX,
    rightX,
    bottomTop: TOP_BAR_H + midH,
    bottomH: BOTTOM_BAR_H + sb,
    pairFont: tileW >= 150 ? 22 : tileW >= 100 ? 19 : 16,
    answerFont: tileW >= 150 ? 30 : tileW >= 100 ? 26 : 22,
    answerH: (boxH - 2 * RAIL_GAP - LET_H) / 2,
    pairHalf: (boxH - RAIL_GAP) / 2,
  };
}

/* ------------------------------------------------------------ right rail */

export type PairTone = "lit" | "unlit" | "off";

export type PairAction =
  | "beginCutting"
  | "beginReview"
  | "keepMarking"
  | "reviewPoints"
  | "begin"
  | "reset"
  | "end"
  | "adjust"
  | "confirm"
  | "resume"
  | "startAgain";

export interface PairTile {
  label: string;
  action: PairAction;
  tone: PairTone;
  /** Share of the rail's height: 1 is the whole rail. The caller turns
   *  it into pixels, taking the gap out when there are two. */
  share: number;
}

/**
 * The right rail's tiles, top to bottom: the pair, in the same two slots
 * whatever they mean, so nothing moves under a thumb. Before the session
 * starts it is the gate instead: one tile, or "Keep marking" over "Review
 * the points" for a draft that was left part way.
 *
 * `opened` is how the screen was opened (handCut.openAs): "choice" is the
 * part-way draft, "review" a finished one, "scoring" a draft with points
 * still to call (which only reaches the gate when a processed match is
 * being marked again), anything else a fresh pass. `startAgain` adds an
 * unlit "Start again" at the foot of the gate for that same case.
 *
 * With a rally open, the left slot takes the pad back to where the last
 * point ended: "Back to last point" (Adil, 2026-09-25; it was "Reset").
 */
export function railPair(s: {
  started: boolean;
  opened: "fresh" | "scoring" | "review" | "choice";
  /** A closed point is selected. */
  reviewing: boolean;
  /** Its edges are on the bar, waiting for Confirm. */
  adjusting: boolean;
  /** A rally is in progress. */
  open: boolean;
  /** A processed match marked again, with marks to clear. */
  startAgain?: boolean;
}): PairTile[] {
  if (!s.started) {
    const again: PairTile = { label: "Start again", action: "startAgain", tone: "unlit", share: 0.26 };
    if (s.opened === "choice") {
      return s.startAgain
        ? [
            { label: "Keep marking", action: "keepMarking", tone: "lit", share: 0.44 },
            { label: "Review the points", action: "reviewPoints", tone: "unlit", share: 0.3 },
            again,
          ]
        : [
            { label: "Keep marking", action: "keepMarking", tone: "lit", share: 0.58 },
            { label: "Review the points", action: "reviewPoints", tone: "unlit", share: 0.42 },
          ];
    }
    const first: PairTile =
      s.opened === "review"
        ? { label: "Begin review", action: "beginReview", tone: "lit", share: 1 }
        : s.opened === "scoring"
          ? { label: "Keep marking", action: "beginCutting", tone: "lit", share: 1 }
          : { label: "Begin Cutting", action: "beginCutting", tone: "lit", share: 1 };
    return s.startAgain ? [{ ...first, share: 0.74 }, again] : [first];
  }
  if (s.reviewing) {
    return s.adjusting
      ? [
          { label: "Confirm", action: "confirm", tone: "lit", share: 0.5 },
          { label: "Resume", action: "resume", tone: "off", share: 0.5 },
        ]
      : [
          { label: "Adjust", action: "adjust", tone: "lit", share: 0.5 },
          { label: "Resume", action: "resume", tone: "unlit", share: 0.5 },
        ];
  }
  return s.open
    ? [
        { label: "Back to last point", action: "reset", tone: "unlit", share: 0.5 },
        { label: "End Point", action: "end", tone: "lit", share: 0.5 },
      ]
    : [
        { label: "Begin Point", action: "begin", tone: "lit", share: 0.5 },
        { label: "End Point", action: "end", tone: "off", share: 0.5 },
      ];
}

/** A tile's height in pixels, for a rail `boxH` tall. */
export function pairTileHeight(tile: PairTile, count: number, boxH: number): number {
  if (count <= 1) return boxH;
  return (boxH - RAIL_GAP * (count - 1)) * tile.share;
}
