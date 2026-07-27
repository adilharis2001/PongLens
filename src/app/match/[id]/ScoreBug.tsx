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
export function ScoreBug({
  score,
  you,
  them,
  className,
  style,
}: {
  score: MatchScore;
  you: string;
  them: string;
  className?: string;
  /** Measured placement (the host anchors this to the picture, not the
   *  player element — see Player's `frame`). */
  style?: React.CSSProperties;
}) {
  // Sized down ~18% from the first pass: a scorebug is a glance, and at the
  // original size it was competing with the match for attention.
  // Portrait takes another 25% off. Landscape fills the screen with picture
  // and carries the larger version comfortably; portrait shows the match in
  // a band across the middle, where the same box reads as a label stuck on
  // a small picture rather than a mark in the corner of a big one.
  const cell =
    "flex h-[15px] items-center justify-center px-1.5 text-[10px] font-semibold leading-none tabular-nums portrait:h-[11px] portrait:px-1 portrait:text-[9px]";
  return (
    <div
      style={style}
      className={`pointer-events-none overflow-hidden rounded-md border border-white/10 bg-ink/85 py-[3px] shadow-lg shadow-black/40 backdrop-blur-sm portrait:py-[2px] ${className ?? ""}`}
    >
      {/* grid-flow-col over two rows: every column is one game, filled top
          (you) then bottom (them) — the same order the cells are written. */}
      <div className="grid grid-flow-col grid-rows-2 items-center">
        <span className="flex h-[15px] items-center gap-1.5 pl-1.5 pr-2.5 portrait:h-[11px] portrait:gap-1 portrait:pl-1 portrait:pr-2">
          <span className="h-2.5 w-[2.5px] shrink-0 rounded-sm bg-cyan-glow portrait:h-2 portrait:w-[2px]" />
          <span className="max-w-[6rem] truncate text-[10px] font-medium leading-none text-zinc-200 portrait:max-w-[4.5rem] portrait:text-[9px]">
            {you}
          </span>
        </span>
        <span className="flex h-[15px] items-center gap-1.5 pl-1.5 pr-2.5 portrait:h-[11px] portrait:gap-1 portrait:pl-1 portrait:pr-2">
          <span className="h-2.5 w-[2.5px] shrink-0 rounded-sm bg-magenta-glow portrait:h-2 portrait:w-[2px]" />
          <span className="max-w-[6rem] truncate text-[10px] font-medium leading-none text-zinc-200 portrait:max-w-[4.5rem] portrait:text-[9px]">
            {them}
          </span>
        </span>

        {/* One fragment per game, so its two cells stay adjacent and land in
            the same column. Fragments are not grid items. */}
        {score.games.map((g, i) => (
          <Fragment key={i}>
            <span className={`${cell} text-zinc-400`}>{g.you}</span>
            <span className={`${cell} text-zinc-400`}>{g.them}</span>
          </Fragment>
        ))}

        <span className={`${cell} rounded-t-md bg-cyan-glow/10 text-white`}>
          {score.current.you}
        </span>
        <span className={`${cell} rounded-b-md bg-cyan-glow/10 text-white`}>
          {score.current.them}
        </span>
      </div>
    </div>
  );
}
