import type { MatchStats } from "./matchStats";

/**
 * Owner-only match statistics, DERIVED from the scored points (see
 * matchStats.ts). Before any point is scored it stays a quiet teaching
 * card — no hard error — so the section is never a dead end. Everything
 * shown is reliable: winners are user-confirmed, servers are
 * rotation-derived.
 */

/** One stat row: label left, value right — same visual language as Tools. */
function StatRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-sm text-zinc-300">{label}</span>
      <span className="shrink-0 text-sm font-semibold tabular-nums">
        {children}
      </span>
    </div>
  );
}

/** A win % with the honest raw count beside it, or a muted em dash. */
function Pct({ played, won, pct }: { played: number; won: number; pct: number | null }) {
  if (pct === null) return <span className="text-zinc-500">—</span>;
  return (
    <>
      <span className="text-cyan-glow">{pct}%</span>
      <span className="ml-1.5 text-xs font-normal text-zinc-500">
        {won}/{played}
      </span>
    </>
  );
}

/** cyan-you / magenta-them pair, matching the ScoreLine language. */
function Pair({ you, them }: { you: number; them: number }) {
  return (
    <>
      <span className="text-cyan-glow">{you}</span>
      <span className="text-zinc-600">–</span>
      <span className="text-magenta-soft">{them}</span>
    </>
  );
}

export function MatchStatistics({
  stats,
  neutral = false,
  youLabel = "Me",
}: {
  stats: MatchStats;
  /** Neutral / third-party match: stats belong to a named player, not the
   *  uploader, so the framing names them instead of saying "your". */
  neutral?: boolean;
  /** The reference (bottom) player's name — used only when neutral. */
  youLabel?: string;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Match Statistics</h2>
      {neutral && (
        <p className="mt-1 text-sm text-zinc-500">{youLabel}&apos;s stats</p>
      )}

      <div className="mt-3 overflow-hidden rounded-2xl border border-edge bg-surface sm:max-w-sm">
        {!stats.hasData ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">
            Score a full game to see {neutral ? `${youLabel}'s` : "your"} stats.
          </p>
        ) : (
          <div className="divide-y divide-edge/60">
            {stats.serverKnown ? (
              <>
                <StatRow label="Serve win %">
                  <Pct {...stats.serve} />
                </StatRow>
                <StatRow label="Receive win %">
                  <Pct {...stats.receive} />
                </StatRow>
              </>
            ) : (
              <p className="px-4 py-3 text-xs text-zinc-500">
                Set who served first to see serve stats.
              </p>
            )}
            <StatRow label="Points won–lost">
              <Pair you={stats.won} them={stats.lost} />
            </StatRow>
            {stats.gamesYou + stats.gamesThem > 0 && (
              <StatRow label="Games won">
                <Pair you={stats.gamesYou} them={stats.gamesThem} />
              </StatRow>
            )}
            {stats.longestStreak > 0 && (
              <StatRow label="Longest point streak">
                <span className="text-cyan-glow">{stats.longestStreak}</span>
              </StatRow>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
