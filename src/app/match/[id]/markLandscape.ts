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
  /** The smaller second line inside a gate tile (GATE_COPY), when the
   *  marker opens on points already there. */
  detail?: string;
}

/* ------------------------------------------------------------ the gate */

/**
 * The line under each gate button when the marker opens on points already
 * there (post-rollout audit B, wording approved by Adil 2026-09-26). The
 * portrait pad and the desktop card show it as a 12 px grey line under the
 * button; the landscape rail as a smaller second line inside the tile. The
 * iPhone carries the same words (MarkerCopy).
 */
export const GATE_COPY = {
  /** Keep marking, on a pass with points still without a winner: it plays
   *  the first of them (handCut.gateStart). */
  keepScoring: "Start from the points already here and fix or score each one.",
  /** Keep marking, on a pass whose points are all called: back to the end
   *  of the last point, marking. */
  carryOn: "Carry on from the last point to the end of the match.",
  /** Start again, which clears the marks after "Clear all marks?". */
  startAgain: "Clear every point and mark the whole match yourself.",
} as const;

export interface GateButton {
  label: string;
  action: PairAction;
  /** The one cyan button; the rest are outlined. */
  lit: boolean;
  /** Its line, or null where the button needs none. */
  detail: string | null;
}

/**
 * The gate's buttons, top to bottom, for every layout: one lit button,
 * "Review the points" under it on a called draft the match runs on past,
 * and "Start again" at the foot when a processed match is marked again
 * with marks to clear.
 *
 * `opened` is how the screen was opened (handCut.openAs). Only the gates
 * that open on points already there carry lines: "Keep marking" says
 * which of its two jobs it does (score the points here, or carry on past
 * the last one), and "Start again" says what it clears. "Begin Cutting",
 * "Begin review" and "Review the points" need no line.
 */
export function gateButtons(
  opened: "fresh" | "scoring" | "review" | "choice",
  startAgain = false
): GateButton[] {
  const buttons: GateButton[] =
    opened === "choice"
      ? [
          { label: "Keep marking", action: "keepMarking", lit: true, detail: GATE_COPY.carryOn },
          { label: "Review the points", action: "reviewPoints", lit: false, detail: null },
        ]
      : opened === "scoring"
        ? // Its action stays the fresh gate's, as on the iPhone; every gate
          // action goes through handCut.gateStart, which reads `opened`.
          [{ label: "Keep marking", action: "beginCutting", lit: true, detail: GATE_COPY.keepScoring }]
        : opened === "review"
          ? [{ label: "Begin review", action: "beginReview", lit: true, detail: null }]
          : [{ label: "Begin Cutting", action: "beginCutting", lit: true, detail: null }];
  if (startAgain) {
    buttons.push({ label: "Start again", action: "startAgain", lit: false, detail: GATE_COPY.startAgain });
  }
  return buttons;
}

/**
 * The gate's share of the rail, tile by tile. The approved board's split
 * (0.58 / 0.42 for Keep marking over Review the points) stands. With Start
 * again at the foot its tile carries a line of its own, which needs about
 * a third of a phone's rail to be read, so the tiles above give way.
 */
function gateShares(count: number, startAgain: boolean): number[] {
  if (!startAgain) return count === 2 ? [0.58, 0.42] : [1];
  return count === 3 ? [0.4, 0.24, 0.36] : [0.62, 0.38];
}

/** Type sizes for a gate tile's second line: small, and a step up only
 *  where the rail is wide. */
export function gateDetailFont(tileW: number): number {
  return tileW >= 150 ? 12 : 10;
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
 * unlit "Start again" at the foot of the gate for that same case. The
 * gate's tiles are gateButtons, with their lines as `detail`.
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
    const buttons = gateButtons(s.opened, !!s.startAgain);
    const shares = gateShares(buttons.length, !!s.startAgain);
    return buttons.map((b, i) => ({
      label: b.label,
      action: b.action,
      tone: b.lit ? "lit" : "unlit",
      share: shares[i],
      ...(b.detail ? { detail: b.detail } : {}),
    }));
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
