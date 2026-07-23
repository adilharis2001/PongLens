/**
 * The point-list panel of the mockup — loosely mirrors the real match
 * page's timeline cards (numbered circle, duration, winner tag), with one
 * row highlighted as "now playing".
 */

type MockPoint = {
  n: number;
  at: string;
  shots: number;
  winner: "you" | "them" | null;
  playing?: boolean;
};

const POINTS: MockPoint[] = [
  { n: 10, at: "0:32", shots: 5, winner: "you" },
  { n: 11, at: "0:37", shots: 9, winner: "them" },
  { n: 12, at: "0:41", shots: 7, winner: "you", playing: true },
  { n: 13, at: "0:46", shots: 3, winner: "them" },
  { n: 14, at: "0:52", shots: 11, winner: null },
];

export function PointList() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between border-b border-edge/60 px-4 py-3">
        <span className="text-sm font-semibold text-zinc-100">Points</span>
        <span className="font-mono text-xs font-bold tabular-nums text-zinc-300">
          <span className="text-cyan-glow">2</span>
          <span className="text-zinc-400">-</span>
          <span className="text-magenta-soft">1</span>
          <span className="mx-1 text-zinc-400">·</span>
          10-8
        </span>
      </div>
      <ul className="flex-1 space-y-2 overflow-hidden p-3">
        {POINTS.map((p) => (
          <li
            key={p.n}
            aria-current={p.playing || undefined}
            className={`flex items-center gap-2.5 rounded-xl border p-2.5 ${
              p.playing
                ? "border-cyan-glow/60 bg-cyan-glow/5"
                : "border-edge bg-surface"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold tabular-nums ${
                p.playing
                  ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                  : "border-edge bg-ink/60 text-zinc-300"
              }`}
            >
              {p.n}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-zinc-100">
                Point {p.n}
                {p.winner && (
                  <span
                    className={`ml-2 text-[10px] font-medium ${
                      p.winner === "you" ? "text-emerald-400" : "text-zinc-400"
                    }`}
                  >
                    {p.winner === "you" ? "You won" : "They won"}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-[11px] tabular-nums text-zinc-400">
                {p.at} · {p.shots}-shot rally
              </span>
            </span>
            {p.playing ? (
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-cyan-glow">
                Playing
              </span>
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5 shrink-0 text-zinc-400"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5.5v13l11-6.5-11-6.5Z" />
              </svg>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
