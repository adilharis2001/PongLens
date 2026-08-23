/**
 * How the match finished, as the scoreboard it deserves.
 *
 *     ▎Adil      11   8  11  11  │ 3 │
 *     ▎Julian     9  11   6   7  │ 1 │
 *
 * Deliberately the SAME table as the ScoreBug drawn over the video and the
 * one worker.py burns into an exported reel — rows with the cyan/magenta
 * accent bars, one muted column per game, the total in a tinted box. Three
 * surfaces, one way of reading a match.
 *
 * It sits BELOW the video, which is also where the spoiler question
 * answers itself: this only renders when the owner left the score on, and
 * a running scoreboard over the footage already tells you how it went.
 */

import type { GameSummary } from "@/app/match/[id]/gameScore";

export function ShareResult({
  you,
  them,
  games,
  gamesYou,
  gamesThem,
}: {
  you: string;
  them: string;
  /** Completed games in order, from computeMatchScore. */
  games: GameSummary[];
  gamesYou: number;
  gamesThem: number;
}) {
  // Nothing to state. A match with no completed game has a running score
  // and no result, and "0-0" under a video is not a result.
  if (games.length === 0) return null;

  const youWon = gamesYou > gamesThem;
  const themWon = gamesThem > gamesYou;

  // A best-of-seven eats the row. At five games "Vaibhav 2022" still had
  // room; at seven it truncated to "Vai…", and a two-row scoreboard whose
  // rows do not say who they belong to is not a scoreboard. The game
  // columns give way first — a game score is two characters and reads fine
  // narrower, where a name does not.
  const tight = games.length > 5;
  const cellW = tight ? "w-[22px] sm:w-8" : "w-7 sm:w-8";
  const cellText = tight ? "text-[13px]" : "text-sm";

  const row = (
    name: string,
    accent: string,
    scores: number[],
    total: number,
    won: boolean
  ) => (
    <div className="flex items-center gap-2 sm:gap-3">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className={`h-4 w-1 shrink-0 rounded-sm ${accent}`} />
        <span
          className={`truncate text-sm font-medium ${
            won ? "text-white" : "text-zinc-400"
          }`}
        >
          {name}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        {scores.map((s, i) => (
          <span
            key={i}
            className={`${cellW} ${cellText} text-center tabular-nums text-zinc-500`}
          >
            {s}
          </span>
        ))}
        <span
          className={`ml-1 w-8 rounded-md py-1 text-center text-base font-semibold tabular-nums sm:w-10 ${
            won ? "bg-cyan-glow/10 text-white" : "text-zinc-500"
          }`}
        >
          {total}
        </span>
      </span>
    </div>
  );

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold">Result</h2>
      <div className="mt-3 space-y-2.5 rounded-2xl border border-edge bg-surface p-4">
        {row(
          you,
          "bg-cyan-glow",
          games.map((g) => g.you),
          gamesYou,
          youWon
        )}
        {row(
          them,
          "bg-magenta-glow",
          games.map((g) => g.them),
          gamesThem,
          themWon
        )}
      </div>
    </section>
  );
}
