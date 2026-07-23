/**
 * Broadcast-style two-row scorebug, mirroring the real player's reel
 * overlay: name · serve dot · games · points, You in cyan / them in magenta.
 */

function Row({
  name,
  games,
  points,
  accent,
  serving,
}: {
  name: string;
  games: number;
  points: number;
  accent: "cyan" | "magenta";
  serving?: boolean;
}) {
  const bar = accent === "cyan" ? "bg-cyan-glow" : "bg-magenta-glow";
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5">
      <span aria-hidden="true" className={`h-3.5 w-1 rounded-full ${bar}`} />
      <span className="w-16 truncate text-[11px] font-semibold text-zinc-100 sm:w-20 sm:text-xs">
        {name}
      </span>
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          serving ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,.8)]" : "bg-transparent"
        }`}
      />
      <span className="w-4 text-center font-mono text-[11px] font-bold tabular-nums text-zinc-400 sm:text-xs">
        {games}
      </span>
      <span
        className={`w-6 rounded text-center font-mono text-xs font-bold tabular-nums sm:text-sm ${
          accent === "cyan"
            ? "bg-cyan-glow/15 text-cyan-glow"
            : "bg-magenta-glow/15 text-magenta-soft"
        }`}
      >
        {points}
      </span>
    </div>
  );
}

export function Scorebug() {
  return (
    <div
      role="img"
      aria-label="Score overlay: You lead M. Chen two games to one, ten points to eight, and are serving"
      className="overflow-hidden rounded-lg border border-edge/80 bg-ink/85 shadow-lg shadow-black/50 backdrop-blur-sm"
    >
      <div className="divide-y divide-edge/60">
        <Row name="You" games={2} points={10} accent="cyan" serving />
        <Row name="M. Chen" games={1} points={8} accent="magenta" />
      </div>
    </div>
  );
}
