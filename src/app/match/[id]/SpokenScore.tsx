/**
 * The score the player called out at the phone while recording.
 *
 * A different kind of fact from the derived score: this is what the
 * player SAID between games, captured on the phone before anything was
 * processed. It is most useful in the hours before a match is scored —
 * typing the result into a league site, checking what happened — so it
 * renders whether or not scoring exists, and never feeds the scorekeeper.
 *
 * Same reading conventions as everywhere else a score appears: cyan is
 * the owner, magenta the opponent, the winner of each game bright and
 * the loser dimmed.
 */
export function SpokenScoreCard({
  scores,
  youLabel,
  themLabel,
}: {
  scores: { game: number; you: number; them: number }[];
  youLabel: string;
  themLabel: string;
}) {
  const rows = [...scores]
    .filter(
      (r) =>
        Number.isFinite(r?.game) &&
        Number.isFinite(r?.you) &&
        Number.isFinite(r?.them)
    )
    .sort((a, b) => a.game - b.game);
  if (rows.length === 0) return null;

  return (
    <div className="mt-3 overflow-x-auto rounded-2xl border border-edge bg-surface px-4 py-3">
      <table className="text-sm">
        <thead>
          <tr className="text-[10px] font-semibold text-zinc-500">
            <td className="pr-4 text-left font-semibold">Game</td>
            {rows.map((r) => (
              <td key={r.game} className="px-2 text-center tabular-nums">
                {r.game}
              </td>
            ))}
          </tr>
        </thead>
        <tbody className="font-semibold tabular-nums">
          <tr>
            <td className="max-w-32 truncate pr-4 text-left text-[13px] font-medium text-cyan-glow">
              {youLabel}
            </td>
            {rows.map((r) => (
              <td
                key={r.game}
                className={`px-2 text-center text-cyan-glow ${
                  r.you > r.them ? "" : "opacity-45"
                }`}
              >
                {r.you}
              </td>
            ))}
          </tr>
          <tr>
            <td className="max-w-32 truncate pr-4 text-left text-[13px] font-medium text-magenta-soft">
              {themLabel}
            </td>
            {rows.map((r) => (
              <td
                key={r.game}
                className={`px-2 text-center text-magenta-soft ${
                  r.them > r.you ? "" : "opacity-45"
                }`}
              >
                {r.them}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
