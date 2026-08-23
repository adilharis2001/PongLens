"use client";

import { Fragment } from "react";
import type { MatchScore } from "./gameScore";

/**
 * The broadcast score bug, bottom-left over the video — the same table the
 * exported reel burns in (worker.py::_reel_scorebug), so a match looks the
 * same whether you are watching it here or watching the file you shared:
 *
 *     | Adil      11   6 |[ 3 ]|
 *     | Vaibhav    9  11 |[ 1 ]|
 *
 * Rows are the players with their cyan/magenta accent bars, one muted column
 * per completed game, and the game in progress in a tinted box.
 *
 * Feed it the score ENTERING the rally on screen, not including it: watching
 * a point while the scoreboard already counts it gives the ending away.
 */
/**
 * Panel height as a share of the picture's height.
 *
 * Not a taste call: worker.py::_reel_scorebug builds the burnt-in table at
 * ~12% of the frame (86 design px on 1080, times its 1.5 owner bump), so
 * matching it is what makes the app and the shared file look alike.
 */
const PANEL_SHARE = 0.1194;
/** Panel = two rows plus its own padding, in units of the row height. */
const PANEL_ROWS = 2.4;

/**
 * Where the bug sits, given the picture's box inside its player.
 *
 * Bottom-left of the PICTURE, 12px in — exactly where worker.py burns it
 * into an exported reel. A <video> is a letterbox: in a portrait takeover
 * a 16:9 file is a band across the middle with a couple of hundred dead
 * pixels above and below, so anything anchored to the ELEMENT's corners
 * floats out in the black, nowhere near the match.
 *
 * The `chromeFloor` only bites when the picture reaches the bottom of its
 * player — landscape, desktop, a card whose box IS the picture. There the
 * bug has to clear the transport row. It must NOT be applied
 * unconditionally: holding it ~56px up permanently left it hovering in
 * the middle of nothing on every letterboxed layout, which is the defect
 * the public page shipped with.
 *
 * This is Player.tsx's rule, lifted out so a second surface cannot
 * re-derive it and get it wrong. Player.tsx still carries the original
 * inline at its own call site — it is a 7,000-line file that also holds
 * Keep score, and it is not worth opening for this. Change both together
 * or neither.
 */
export function scoreBugPlacement({
  left,
  bottomGap,
  chromeFloor,
}: {
  /** Black bar to the LEFT of the picture, inside the player's box. */
  left: number;
  /** Black bar BELOW the picture, inside the player's box. */
  bottomGap: number;
  /** How far up the player's own controls reach. */
  chromeFloor: number;
}): { left: number; bottom: number } {
  return {
    left: Math.max(12, left + 12),
    bottom: Math.max(chromeFloor, bottomGap + 12),
  };
}

export function ScoreBug({
  score,
  you,
  them,
  className,
  style,
  pictureHeight,
}: {
  score: MatchScore;
  you: string;
  them: string;
  className?: string;
  /** Measured placement (the host anchors this to the picture, not the
   *  player element — see Player's `frame`). */
  style?: React.CSSProperties;
  /** The picture's on-screen height. Everything below is a fraction of it.
   *  Fixed pixel sizes looked right on a phone and vanished on a desktop:
   *  the same 36px panel is 12% of a 219px-tall portrait picture and under
   *  4% of a 920px-tall one, so the bug shrank exactly as the video grew. */
  pictureHeight?: number;
}) {
  // One unit: the row height. A floor keeps the phone where it already was
  // (11px rows, which is both today's portrait size and ~12% of a portrait
  // picture — it was only ever desktop that drifted).
  const u =
    pictureHeight && pictureHeight > 0
      ? Math.max(11, (PANEL_SHARE * pictureHeight) / PANEL_ROWS)
      : 15;
  // Digits get a floor of their own. Scaling them straight off the row
  // would take the phone down to ~7px, smaller than it is today: below a
  // certain size a score has to stay legible even if it stops being
  // proportional.
  const digit = Math.max(9, u * 0.667);

  const cellStyle: React.CSSProperties = {
    height: u,
    fontSize: digit,
    paddingLeft: u * 0.4,
    paddingRight: u * 0.4,
  };
  const cell =
    "flex items-center justify-center font-semibold leading-none tabular-nums";
  const nameRow: React.CSSProperties = {
    height: u,
    gap: u * 0.4,
    paddingLeft: u * 0.4,
    paddingRight: u * 0.667,
  };
  const barStyle: React.CSSProperties = {
    height: u * 0.667,
    width: Math.max(2, u * 0.167),
  };
  const nameStyle: React.CSSProperties = {
    fontSize: digit,
    maxWidth: u * 6.4,
  };

  return (
    <div
      // A stable hook for the demo capture, which needs to point at the bug
      // itself: everything else about it is utility classes that change
      // whenever the styling does.
      data-scorebug=""
      style={{ ...style, paddingTop: u * 0.2, paddingBottom: u * 0.2 }}
      className={`pointer-events-none overflow-hidden rounded-md border border-white/10 bg-ink/85 shadow-lg shadow-black/40 backdrop-blur-sm ${className ?? ""}`}
    >
      {/* grid-flow-col over two rows: every column is one game, filled top
          (you) then bottom (them) — the same order the cells are written. */}
      <div className="grid grid-flow-col grid-rows-2 items-center">
        <span className="flex items-center" style={nameRow}>
          <span
            className="shrink-0 rounded-sm bg-cyan-glow"
            style={barStyle}
          />
          <span
            className="truncate font-medium leading-none text-zinc-200"
            style={nameStyle}
          >
            {you}
          </span>
        </span>
        <span className="flex items-center" style={nameRow}>
          <span
            className="shrink-0 rounded-sm bg-magenta-glow"
            style={barStyle}
          />
          <span
            className="truncate font-medium leading-none text-zinc-200"
            style={nameStyle}
          >
            {them}
          </span>
        </span>

        {/* One fragment per game, so its two cells stay adjacent and land in
            the same column. Fragments are not grid items. */}
        {score.games.map((g, i) => (
          <Fragment key={i}>
            <span className={`${cell} text-zinc-400`} style={cellStyle}>
              {g.you}
            </span>
            <span className={`${cell} text-zinc-400`} style={cellStyle}>
              {g.them}
            </span>
          </Fragment>
        ))}

        <span
          className={`${cell} rounded-t-md bg-cyan-glow/10 text-white`}
          style={cellStyle}
        >
          {score.current.you}
        </span>
        <span
          className={`${cell} rounded-b-md bg-cyan-glow/10 text-white`}
          style={cellStyle}
        >
          {score.current.them}
        </span>
      </div>
    </div>
  );
}
