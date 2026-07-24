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

export function MatchStatistics({ stats }: { stats: MatchStats }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Match Statistics</h2>

      <div className="mt-3 overflow-hidden rounded-2xl border border-edge bg-surface sm:max-w-sm">
        {!stats.hasData ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">
            Score a full game to see your stats.
          </p>
        ) : (
          <div className="divide-y divide-edge/60">
            {stats.serverKnown ? (
              <>
                <StatRow label="Serve win %">
                  <Pct {...stats.serve} />
                </StatRow>
                <StatRow label="2nd-serve win %">
                  <Pct {...stats.secondServe} />
                </StatRow>
                <StatRow label="Points won on serve">
                  <span className="text-cyan-glow">{stats.serve.won}</span>
                </StatRow>
                <StatRow label="Points won on receive">
                  <span className="text-cyan-glow">{stats.receive.won}</span>
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
