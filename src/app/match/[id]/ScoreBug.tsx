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
}: {
  score: MatchScore;
  you: string;
  them: string;
  className?: string;
}) {
  const cell =
    "flex h-[18px] items-center justify-center px-2 text-[11px] font-semibold leading-none tabular-nums";
  return (
    <div
      className={`pointer-events-none overflow-hidden rounded-lg border border-white/10 bg-ink/85 py-1 shadow-lg shadow-black/40 backdrop-blur-sm ${className ?? ""}`}
    >
      {/* grid-flow-col over two rows: every column is one game, filled top
          (you) then bottom (them) — the same order the cells are written. */}
      <div className="grid grid-flow-col grid-rows-2 items-center">
        <span className="flex h-[18px] items-center gap-1.5 pl-2 pr-3">
          <span className="h-3 w-[3px] shrink-0 rounded-sm bg-cyan-glow" />
          <span className="max-w-[7rem] truncate text-[11px] font-medium leading-none text-zinc-200">
            {you}
          </span>
        </span>
        <span className="flex h-[18px] items-center gap-1.5 pl-2 pr-3">
          <span className="h-3 w-[3px] shrink-0 rounded-sm bg-magenta-glow" />
          <span className="max-w-[7rem] truncate text-[11px] font-medium leading-none text-zinc-200">
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
