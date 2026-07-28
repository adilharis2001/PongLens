"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MatchAnalysis as Analysis, Count, Tally } from "./matchAnalysis";
import type { MatchStats } from "./matchStats";

/**
 * Match analysis as a deck of cards: one per screen on mobile with a
 * scroll-snap swipe, a two-column grid on desktop where there's room to see
 * them at once.
 *
 * Every card states what it doesn't know. A cut with no data says so in
 * plain words rather than drawing an empty chart, because an empty chart
 * reads as "you have no weaknesses" instead of "you haven't filled this in".
 */

/* ---------------------------------------------------------------- shells */

/**
 * The scrolling part of a card. A fixed tile that clips its content would
 * otherwise just look truncated, so a fade sits over the bottom edge while
 * there is more to reach, and clears once you get there.
 */
function CardBody({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () =>
      setMore(el.scrollHeight - el.scrollTop > el.clientHeight + 4);
    check();
    el.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      el.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  return (
    <div className="relative mt-3 sm:min-h-0 sm:flex-1">
      <div ref={ref} className="sm:h-full sm:overflow-y-auto sm:pr-1">
        {children}
      </div>
      {more && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-10 bg-gradient-to-t from-surface via-surface/80 to-transparent sm:block" />
      )}
    </div>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    /* Mobile: a snap target sized by its content, so the page scrolls
       normally and nothing is hidden behind a nested scroller.
       Desktop: a fixed-height tile in the 2x2, with the BODY scrolling when
       a card has more in it than the others. Equal tiles beat honest
       heights here — four different heights in a grid leave holes that read
       as broken rather than as data. */
    <div className="flex w-[86%] shrink-0 snap-center flex-col rounded-2xl border border-edge bg-surface p-4 sm:h-[30rem] sm:w-full">
      <h3 className="shrink-0 text-sm font-semibold text-zinc-100">{title}</h3>
      {hint && <p className="mt-0.5 shrink-0 text-xs text-zinc-500">{hint}</p>}
      <CardBody>{children}</CardBody>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-6 text-center text-xs leading-relaxed text-zinc-500">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ rows */

export function StatRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-zinc-400">{label}</span>
      <span className="shrink-0 text-xs font-semibold tabular-nums">
        {children}
      </span>
    </div>
  );
}

export function Pct({
  played,
  won,
  pct,
}: {
  played: number;
  won: number;
  pct: number | null;
}) {
  if (pct === null) return <span className="text-zinc-500">—</span>;
  return (
    <>
      <span className="text-cyan-glow">{pct}%</span>
      <span className="ml-1.5 text-[11px] font-normal text-zinc-500">
        {won}/{played}
      </span>
    </>
  );
}

export function Pair({ you, them }: { you: number; them: number }) {
  return (
    <>
      <span className="text-cyan-glow">{you}</span>
      <span className="text-zinc-600">–</span>
      <span className="text-magenta-soft">{them}</span>
    </>
  );
}

/** A won/lost split bar: cyan for points won, magenta for points lost. */
export function SplitBar({ row }: { row: Tally }) {
  const total = row.won + row.lost;
  const pct = total > 0 ? Math.round((row.won / total) * 100) : 0;
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-zinc-300">{row.label}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
          <span className="font-semibold text-cyan-glow">{pct}%</span> · {total}
        </span>
      </div>
      <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-ink">
        <div
          className="bg-cyan-glow"
          style={{ width: `${total ? (row.won / total) * 100 : 0}%` }}
        />
        <div
          className="bg-magenta-glow/70"
          style={{ width: `${total ? (row.lost / total) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}

/** A plain count bar, sized against the biggest count in its group. */
export function CountBar({
  row,
  max,
  tone = "magenta",
}: {
  row: Count;
  max: number;
  tone?: "magenta" | "cyan";
}) {
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-zinc-300">{row.label}</span>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-zinc-400">
          {row.count}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink">
        <div
          className={tone === "cyan" ? "h-full bg-cyan-glow" : "h-full bg-magenta-glow/70"}
          style={{ width: `${max ? (row.count / max) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- momentum */

/**
 * The running point differential as a mountain: above the line you're
 * pulling away, below it you're being pulled away from. Vertical ticks mark
 * game boundaries. One bar per point, so runs read as slopes.
 */
function MomentumChart({ momentum }: { momentum: Analysis["momentum"] }) {
  const { steps, peak, trough } = momentum;
  const n = steps.length;
  const span = Math.max(peak, -trough, 1);
  const h = span * 2;

  return (
    <svg
      viewBox={`0 0 ${n} ${h}`}
      preserveAspectRatio="none"
      className="h-28 w-full"
      role="img"
      aria-label={`Point differential across ${n} points`}
    >
      {steps.map((s, i) =>
        s.diff === 0 ? null : (
          <rect
            key={i}
            x={i}
            y={s.diff > 0 ? span - s.diff : span}
            width={1}
            height={Math.abs(s.diff)}
            className={s.diff > 0 ? "fill-cyan-glow/70" : "fill-magenta-glow/60"}
          />
        )
      )}
      {/* level */}
      <line
        x1={0}
        y1={span}
        x2={n}
        y2={span}
        className="stroke-zinc-600"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {/* game boundaries */}
      {steps.map((s, i) =>
        s.endsGame && i < n - 1 ? (
          <line
            key={`g${i}`}
            x1={i + 1}
            y1={0}
            x2={i + 1}
            y2={h}
            className="stroke-edge"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ) : null
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ deck */

export function AnalysisCards({
  stats,
  analysis,
  neutral = false,
  youLabel = "Me",
  children,
}: {
  stats: MatchStats;
  analysis: Analysis;
  /** Neutral / third-party match: the stats belong to a named player. */
  neutral?: boolean;
  youLabel?: string;
  /** Deep-dive subsections rendered under the deck, inside this section. */
  children?: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  // Which card is centred, for the dots. Derived from scroll position rather
  // than tracked on tap, so a swipe and a dot always agree.
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    if (!card) return;
    const stride = card.offsetWidth + 12;
    setActive(Math.round(el.scrollLeft / stride));
  }, []);

  const { momentum, serve, mistakes, placement } = analysis;
  const whose = neutral ? `${youLabel}'s` : "your";
  const scored = stats.won + stats.lost;
  const incomplete = !stats.hasData || stats.detailed < scored;

  const cards: React.ReactNode[] = [
    /* Momentum and the numbers are one card: both come free from the
       confirmed winners, both are always populated, and neither fills a card
       on its own. The chart says what happened, the rows say by how much. */
    <Card key="overview" title="Overview">
      {momentum.steps.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Point differential
          </p>
          <MomentumChart momentum={momentum} />
        </div>
      )}
      {!stats.hasData ? (
        <Empty>Score a full game to see {whose} stats.</Empty>
      ) : (
        <div className="divide-y divide-edge/60">
          {momentum.bestRun && (
            <StatRow label="Best run">
              <span
                className={
                  momentum.bestRun.who === "user"
                    ? "text-cyan-glow"
                    : "text-magenta-soft"
                }
              >
                {momentum.bestRun.len} in a row
                <span className="ml-1.5 text-[11px] font-normal text-zinc-500">
                  {momentum.bestRun.who === "user" ? "you" : "them"}
                </span>
              </span>
            </StatRow>
          )}
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
            <p className="py-2 text-xs text-zinc-500">
              Set who served first to see serve stats.
            </p>
          )}
          <StatRow label="At 9+ in the game">
            <Pct {...stats.pressure} />
          </StatRow>
          <StatRow label="After losing a point">
            <Pct {...stats.bounceBack} />
          </StatRow>
          <StatRow label="Points won–lost">
            <Pair you={stats.won} them={stats.lost} />
          </StatRow>
          <StatRow label="Furthest ahead / behind">
            <Pair you={momentum.peak} them={-momentum.trough} />
          </StatRow>
          <StatRow label="Lead changes">
            <span className="text-zinc-200">{momentum.leadChanges}</span>
          </StatRow>
          {stats.gamesYou + stats.gamesThem > 0 && (
            <StatRow label="Games won">
              <Pair you={stats.gamesYou} them={stats.gamesThem} />
            </StatRow>
          )}
        </div>
      )}
    </Card>,

    <Card key="serve" title="Serve" hint="Share of those points you won">
      {serve.described === 0 ? (
        <Empty>
          No serves described yet. Add one from a receive error, an ace or a
          clean winner and this fills in.
        </Empty>
      ) : (
        <>
          {serve.mine.spins.length > 0 && (
            <>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                My serves ({serve.mine.count})
              </p>
              {serve.mine.spins.map((r) => (
                <SplitBar key={r.label} row={r} />
              ))}
              {serve.mine.lengths.length > 0 && (
                <div className="mt-2 border-t border-edge/60 pt-2">
                  {serve.mine.lengths.map((r) => (
                    <SplitBar key={r.label} row={r} />
                  ))}
                </div>
              )}
            </>
          )}
          {serve.theirs.spins.length > 0 && (
            <>
              <p className="mb-1 mt-4 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Their serves ({serve.theirs.count})
              </p>
              {serve.theirs.spins.map((r) => (
                <SplitBar key={r.label} row={r} />
              ))}
            </>
          )}
          <p className="mt-3 text-[11px] text-zinc-600">
            One match is a small sample — the count beside each bar says how
            small.
          </p>
        </>
      )}
    </Card>,

    <Card key="mistakes" title="Mistakes" hint="Only points you lost">
      {mistakes.errors.length === 0 && mistakes.reasons.length === 0 ? (
        <Empty>
          Nothing recorded yet. Say how points ended, and why you lost them,
          and the pattern shows up here.
        </Empty>
      ) : (
        <>
          {mistakes.errors.length > 0 && (
            <>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Where your misses went
              </p>
              {mistakes.errors.map((r) => (
                <CountBar
                  key={r.label}
                  row={r}
                  max={Math.max(...mistakes.errors.map((e) => e.count))}
                />
              ))}
            </>
          )}
          {mistakes.reasons.length > 0 && (
            <>
              <p className="mb-1 mt-3 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Why you lost them
              </p>
              {mistakes.reasons.slice(0, 6).map((r) => (
                <CountBar
                  key={r.label}
                  row={r}
                  max={Math.max(...mistakes.reasons.map((e) => e.count))}
                />
              ))}
              <p className="mt-3 text-[11px] text-zinc-600">
                Self-reported on {mistakes.reasonsGiven} of {mistakes.totalLost}{" "}
                lost points.
              </p>
            </>
          )}
        </>
      )}
    </Card>,

    <Card
      key="placement"
      title="Placement"
      hint="Where the deciding ball went"
    >
      {placement.total === 0 ? (
        <Empty>
          No placements recorded yet. They come from the Placement question on
          a point.
        </Empty>
      ) : (
        <>
          {placement.won.length > 0 && (
            <>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Points you won
              </p>
              {placement.won.map((r) => (
                <CountBar
                  key={r.label}
                  row={r}
                  tone="cyan"
                  max={Math.max(...placement.won.map((e) => e.count))}
                />
              ))}
            </>
          )}
          {placement.lost.length > 0 && (
            <>
              <p className="mb-1 mt-3 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Points you lost
              </p>
              {placement.lost.map((r) => (
                <CountBar
                  key={r.label}
                  row={r}
                  max={Math.max(...placement.lost.map((e) => e.count))}
                />
              ))}
            </>
          )}
          <p className="mt-3 text-[11px] text-zinc-600">
            Over {placement.total} points with a placement.
          </p>
        </>
      )}
      {/* the summary's deep-dive: the camera's view of the same question */}
      <a
        href="#ball-map"
        className="mt-3 inline-block text-[11px] font-semibold text-cyan-glow transition-colors hover:text-white"
      >
        Where the ball landed →
      </a>
    </Card>,
  ];

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Match analysis</h2>
      {neutral && (
        <p className="mt-1 text-sm text-zinc-500">{youLabel}&apos;s analysis</p>
      )}
      {/* The cards are only as good as what has been confirmed, so say so
          while there is still detail missing — and stop saying it once
          there isn't, rather than nagging forever. */}
      {incomplete && (
        <p className="mt-1 text-sm text-zinc-500">
          Score the points and answer the follow-ups to fill this in.
        </p>
      )}

      <div
        ref={scroller}
        onScroll={onScroll}
        /* Mobile: a snap carousel, one card per screen. Desktop: a plain
           2x2 of equal tiles — with four cards that is the arrangement with
           no ragged edge and no gaps, and each tile absorbs its own overflow
           rather than pushing the ones beside it around. */
        className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible"
      >
        {cards}
      </div>

      {/* dots: the swipe affordance, mobile only */}
      <div className="mt-2 flex justify-center gap-1.5 sm:hidden">
        {cards.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              i === active ? "w-4 bg-cyan-glow" : "w-1.5 bg-edge"
            }`}
          />
        ))}
      </div>

      {children}
    </section>
  );
}
