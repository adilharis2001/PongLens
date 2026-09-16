"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Point } from "@/lib/types";
import {
  computeScoredCards,
  scoredCardsGate,
  type ScoredCardsGate,
} from "@/lib/placement/scoredCards";
import { computeMatchScore } from "./gameScore";
import {
  computeMatchAnalysis,
  type MatchAnalysis as Analysis,
} from "./matchAnalysis";
import { computeMatchStats, type MatchStats } from "./matchStats";
import type { CustomReasonLabels } from "./scorecard";
import type { ServeInfo } from "./serving";
import type { Side } from "./sides";
import type { MapLabels } from "./PlacementMap";
import { LooksWrongButton, MarkedWrongNotice } from "./PlacementFeedback";
import { usePlacementMapCards } from "./PlacementAggregate";
import { Segmented } from "./placementTable";
import { buildScoredCards } from "./ScoredCards";
import type { PlacementLifecycleController } from "./usePlacementLifecycle";
import {
  Card,
  CountBar,
  Empty,
  OWNER_VOICE,
  Pair,
  Pct,
  SplitBar,
  StatRow,
  viewerVoice,
} from "./cards";

export {
  Card,
  CardBody,
  CountBar,
  Empty,
  Pair,
  Pct,
  SplitBar,
  StatRow,
} from "./cards";

/**
 * Match analysis as ONE deck of cards: one per screen on mobile with a
 * scroll-snap swipe, a two-column grid on desktop where there's room to
 * see them at once.
 *
 * Everything the match can say lives here, in a fixed order so the swipe
 * is predictable: what the score says (Overview, why you lost, the serve
 * follow-ups), then what the video says once enough of the match is
 * scored (point length, serve speed and variety, the serve maps, where
 * points ended), then a placeholder for what is still to come. The serve
 * maps used to be a section of their own with a second dot pager; the
 * Beta chip now rides on each card the ball engine feeds, not on a
 * heading (Adil, 2026-09-15).
 *
 * Every card states what it doesn't know. A cut with no data says so in
 * plain words rather than drawing an empty chart, because an empty chart
 * reads as "you have no weaknesses" instead of "you haven't filled this in".
 *
 * The same deck is what a coach and a share-link viewer get (Adil,
 * 2026-09-15), read-only: no gate, no lifecycle card, no flag button, and
 * the players' names where the owner reads "you". The cards themselves are
 * shared, so the three surfaces cannot drift apart.
 */

/* -------------------------------------------------------------- momentum */

/**
 * The running point differential as a mountain: above the line you're
 * pulling away, below it you're being pulled away from. Vertical ticks mark
 * game boundaries. One bar per point, so runs read as slopes.
 */
export function MomentumChart({ momentum }: { momentum: Analysis["momentum"] }) {
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

/* ------------------------------------------------------- state cards */

/** Full width on a phone, content width on desktop (the app's button rule). */
const ACTION_BUTTON =
  "glow-cta mt-4 min-h-11 w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60 sm:w-auto";

/**
 * The one card that says what is still to do, and it is always the last
 * card until nothing is left: which end the owner played (the maps cannot
 * be oriented without it), scoring (the overview and the video cards need
 * 75% of the points, the bar the highlights use, so the rallies behind
 * them are confirmed), and the detailed analysis. The steps are in order,
 * not side by side (Adil, 2026-09-15): scoring confirms the cuts, the
 * servers and the winners, and the worker reads the corrected point
 * windows when it runs, so generating is offered only once the match is
 * scored. Until then the card asks for one thing. An analysis that already
 * exists, or is running, shows as a status row at any time. Copy for the
 * analysis row is the lifecycle's own (placementRetry.ts), so the Tools
 * row and this card never disagree.
 */
function Check() {
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-glow/15 text-cyan-glow">
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </span>
  );
}

const SECONDARY_BUTTON =
  "min-h-11 flex-1 rounded-full border border-edge px-4 py-2.5 text-sm font-semibold text-zinc-100 transition-colors hover:border-cyan-glow/50 sm:flex-none";

function NextStepRow({
  title,
  done,
  children,
}: {
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-zinc-100">{title}</p>
        {done && <Check />}
      </div>
      {children}
    </div>
  );
}

function NextStepCard({
  gate,
  scoredType,
  sideMissing,
  onSetUserSide,
  controller,
  onScore,
}: {
  gate: ScoredCardsGate;
  scoredType: boolean;
  sideMissing: boolean;
  onSetUserSide?: (side: Side) => void;
  controller: PlacementLifecycleController | null;
  onScore?: () => void;
}) {
  const view = controller?.view ?? null;
  const analysisReady = view !== null && view.toolStatus === "Ready";
  // Generate (or try again) comes after scoring; a practice match has
  // nothing to score and gets it straight away. Once the bar is met the
  // scoring row steps aside: the one thing left to do is the analysis.
  const offerAnalysis = !scoredType || gate.open;
  const showScoring = scoredType && !gate.open;
  const showAnalysis =
    view !== null && !analysisReady && (view.poll || offerAnalysis);
  return (
    <Card title="What's next">
      <div className="divide-y divide-edge/60">
        {sideMissing && onSetUserSide && (
          <NextStepRow title="Which end did you play from?">
            <div className="mt-3 flex gap-2">
              <button type="button" className={SECONDARY_BUTTON} onClick={() => onSetUserSide("near")}>
                Bottom of video
              </button>
              <button type="button" className={SECONDARY_BUTTON} onClick={() => onSetUserSide("far")}>
                Top of video
              </button>
            </div>
          </NextStepRow>
        )}
        {showScoring && (
          <NextStepRow title="Score the match">
            <p className="mt-0.5 text-xs text-zinc-400">
              {analysisReady
                ? "Unlocks the overview, point length, serve speed and where points ended."
                : "Unlocks the overview and the detailed analysis."}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink">
              <div
                className="h-full bg-cyan-glow"
                style={{ width: `${Math.min(100, Math.round(gate.share * 100))}%` }}
              />
            </div>
            <p className="mt-2 text-xs tabular-nums text-zinc-300">
              {gate.scored} of {gate.eligible} points scored
              {!gate.open && (
                <span className="text-zinc-500"> · {gate.required} needed</span>
              )}
            </p>
            {onScore && (
              <button type="button" onClick={onScore} className={ACTION_BUTTON}>
                {gate.scored === 0 ? "Score the match" : "Keep scoring"}
              </button>
            )}
          </NextStepRow>
        )}
        {controller && view && showAnalysis && (
          <NextStepRow title="Detailed analysis">
            {!view.poll && view.actionKind === null && (
              <p className="mt-0.5 text-xs text-zinc-400">Not available for this video.</p>
            )}
            {view.actionKind === "generate" && (
              <p className="mt-0.5 text-xs text-zinc-400">
                Unlocks the serve maps, point length, serve speed and where points ended.
              </p>
            )}
            {view.actionKind === "retry" && (
              <p className="mt-0.5 text-xs text-zinc-400">The table was hard to detect.</p>
            )}
            {view.poll && (
              <p className="mt-3 flex items-center gap-2 text-xs text-zinc-300">
                <span
                  aria-hidden="true"
                  className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-glow/30 border-t-cyan-glow"
                />
                {view.toolStatus}
              </p>
            )}
            {offerAnalysis && view.actionKind && view.actionLabel && (
              <button
                type="button"
                disabled={controller.submitting}
                onClick={() => {
                  void controller.requestAction();
                }}
                className={ACTION_BUTTON}
              >
                {controller.submitting ? "Starting…" : view.actionLabel}
              </button>
            )}
            {controller.error && (
              <p aria-live="polite" className="mt-3 text-sm text-red-300">
                {controller.error}
              </p>
            )}
          </NextStepRow>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ deck */

export interface AnalysisPlacement {
  /** Placement is ready and unflagged: the video cards may read it. */
  trusted: boolean;
  /** The owner said this match's maps are wrong (matches.placement_flagged). */
  flagged: boolean;
  /** The owner's generate / generating / try-again lifecycle. A viewer has none. */
  controller?: PlacementLifecycleController;
  matchId?: string;
  /** The owner's flag button. A viewer cannot mark the maps wrong. */
  onFlagChange?: (flagged: boolean) => void;
}

/** Who is reading: the owner (undefined), their coach, or a share link. */
export type AnalysisViewer = "coach" | "public";

export function AnalysisCards({
  stats,
  analysis,
  neutral = false,
  youLabel = "Me",
  scoredType,
  points,
  userSide,
  gameIndexByPoint,
  serving,
  prePad,
  customReasonLabels,
  labels,
  ownerHandedness = null,
  servesOnly = false,
  placement = null,
  onOpenPoint,
  onScore,
  onSetUserSide,
  viewer,
}: {
  stats: MatchStats;
  analysis: Analysis;
  /** Neutral / third-party match: the stats belong to a named player. */
  neutral?: boolean;
  youLabel?: string;
  /** The match type keeps a score; practice does not, and gets maps only. */
  scoredType: boolean;
  points: Point[];
  userSide: Side | null;
  gameIndexByPoint: Map<string, number>;
  serving: Map<string, ServeInfo>;
  /** Effective pre pad of a point's clip, seconds (clipEdit.effectivePad). */
  prePad: (point: Point) => number;
  customReasonLabels: CustomReasonLabels;
  labels: MapLabels;
  ownerHandedness?: "right" | "left" | null;
  /** app_config placement_serves_only (132). */
  servesOnly?: boolean;
  /** Null on a hand-cut match: no ball track, no table, nothing to offer. */
  placement?: AnalysisPlacement | null;
  /** Open one point from a heat map zone's list. */
  onOpenPoint?: (pointId: string) => void;
  /** Open the scorer, for the card that asks for more scoring. */
  onScore?: () => void;
  /** Record which end the owner played from, for the next-step card. */
  onSetUserSide?: (side: Side) => void;
  /**
   * Set for a coach or a share link: the deck is read-only and speaks in
   * the players' names. The public page also drops the teaser, which is a
   * promise to the owner.
   */
  viewer?: AnalysisViewer;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [gameFilter, setGameFilter] = useState<number | null>(null);

  // Distance between card origins: card width plus the deck's gap, read
  // from the layout so the mobile and desktop gaps both count.
  const stride = useCallback(() => {
    const el = scroller.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return 0;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 12;
    return card.offsetWidth + gap;
  }, []);

  // Which card is at the front, for the dots. Derived from scroll position
  // rather than tracked on tap, so a swipe and a dot always agree.
  const onScroll = useCallback(() => {
    const el = scroller.current;
    const step = stride();
    if (!el || !step) return;
    setActive(Math.round(el.scrollLeft / step));
  }, [stride]);

  // The desktop's way to swipe: one card at a time, either direction.
  const page = useCallback(
    (direction: 1 | -1) => {
      const el = scroller.current;
      const step = stride();
      if (!el || !step) return;
      el.scrollBy({ left: direction * step, behavior: "smooth" });
    },
    [stride],
  );

  const gameCount = useMemo(() => {
    let max = -1;
    for (const point of points) {
      max = Math.max(max, gameIndexByPoint.get(point.id) ?? 0);
    }
    return max + 1;
  }, [points, gameIndexByPoint]);

  // The Game filter reaches every card. The score cards are recomputed
  // for one game from the same functions the whole-match numbers came
  // from, so a filtered Overview is the real thing and not an estimate.
  const filteredPoints = useMemo(
    () =>
      gameFilter === null
        ? points
        : points.filter(
            (point) => (gameIndexByPoint.get(point.id) ?? 0) === gameFilter,
          ),
    [points, gameFilter, gameIndexByPoint],
  );
  const viewStats = useMemo(
    () =>
      gameFilter === null
        ? stats
        : computeMatchStats(
            filteredPoints,
            serving,
            computeMatchScore(filteredPoints),
          ),
    [gameFilter, stats, filteredPoints, serving],
  );
  const viewAnalysis = useMemo(
    () =>
      gameFilter === null
        ? analysis
        : computeMatchAnalysis(
            filteredPoints,
            serving,
            new Map(),
            customReasonLabels,
          ),
    [gameFilter, analysis, filteredPoints, serving, customReasonLabels],
  );

  const gate = useMemo(() => scoredCardsGate(points), [points]);
  const scoredCards = useMemo(
    () =>
      scoredType && gate.open
        ? computeScoredCards({
            points,
            userSide,
            gameIndexByPoint,
            serving,
            prePad,
            placementTrusted: placement?.trusted ?? false,
            gameFilter,
          })
        : null,
    [
      scoredType,
      gate.open,
      points,
      userSide,
      gameIndexByPoint,
      serving,
      prePad,
      placement?.trusted,
      gameFilter,
    ],
  );

  const voice = viewer ? viewerVoice(youLabel, labels.them) : OWNER_VOICE;

  const maps = usePlacementMapCards({
    points,
    gameFilter,
    userSide,
    gameIndexByPoint,
    serving,
    labels,
    ownerHandedness,
    servesOnly,
    enabled: placement !== null && !placement.flagged,
    onOpenPoint,
    voice,
    // Until the match is scored the server behind "Me / Them" is the
    // camera's guess, checked only by the serve's own first bounce.
    serverEstimated: scoredType && !gate.open,
  });

  const { momentum, serve, mistakes } = viewAnalysis;
  const whose = neutral ? `${youLabel}'s` : "your";

  /**
   * How much a cut needs before it earns a card.
   *
   * Two data points do not make a pattern — "Misread the spin: 1" beside
   * "Lost focus: 1" is a chart of nothing, and a deck where two cards say
   * "nothing recorded yet" reads as a broken feature rather than an empty
   * one. Three is the floor the placement views already use.
   */
  const MIN_SAMPLES = 3;

  // What is still to do, for the owner: an end to name (the maps cannot
  // be oriented without it), points to score, an analysis to generate or
  // retry. While any of it is open the deck ends on the next-step card;
  // once none is, and only then, it ends on the teaser. A viewer gets the
  // teaser only for a match that is complete, and never the card.
  const placementView = placement?.controller?.view ?? null;
  const sideMissing =
    userSide === null && placement !== null && placement.trusted;
  const analysisPending =
    placementView !== null
    && !placement?.flagged
    && (placementView.poll || placementView.actionKind !== null);
  // Scoring is a step only up to the bar; past it the deck has what it
  // needs and the card asks for nothing more about the score.
  const nextStep =
    !viewer
    && ((scoredType && !gate.open)
      || (sideMissing && onSetUserSide !== undefined)
      || analysisPending);
  const complete = viewer
    ? gate.open && (placement === null || placement.trusted)
    : !nextStep;

  const cards: React.ReactNode[] = [
    /* Momentum and the numbers are one card: both come free from the
       confirmed winners, both are always populated, and neither fills a card
       on its own. The chart says what happened, the rows say by how much. */
    scoredType && gate.open ? (
      <Card key="overview" title="Overview">
        {momentum.steps.length > 0 && (
          <div className="mb-3">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Point differential
            </p>
            <MomentumChart momentum={momentum} />
          </div>
        )}
        {!viewStats.hasData ? (
          <Empty>
            {viewer
              ? "Stats appear once a full game is scored."
              : `Score a full game to see ${whose} stats.`}
          </Empty>
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
                    {momentum.bestRun.who === "user" ? voice.you : voice.them}
                  </span>
                </span>
              </StatRow>
            )}
            {viewStats.serverKnown ? (
              <>
                <StatRow label="Serve win %">
                  <Pct {...viewStats.serve} />
                </StatRow>
                <StatRow label="Receive win %">
                  <Pct {...viewStats.receive} />
                </StatRow>
              </>
            ) : (
              <p className="py-2 text-xs text-zinc-500">
                Set who served first to see serve stats.
              </p>
            )}
            <StatRow label="At 9+ in the game">
              <Pct {...viewStats.pressure} />
            </StatRow>
            <StatRow label="After losing a point">
              <Pct {...viewStats.bounceBack} />
            </StatRow>
            <StatRow label="Points won–lost">
              <Pair you={viewStats.won} them={viewStats.lost} />
            </StatRow>
            <StatRow label="Furthest ahead / behind">
              <Pair you={momentum.peak} them={-momentum.trough} />
            </StatRow>
            <StatRow label="Lead changes">
              <span className="text-zinc-200">{momentum.leadChanges}</span>
            </StatRow>
            {viewStats.gamesYou + viewStats.gamesThem > 0 && (
              <StatRow label="Games won">
                <Pair you={viewStats.gamesYou} them={viewStats.gamesThem} />
              </StatRow>
            )}
          </div>
        )}
      </Card>
    ) : null,

    /* Right after the overview: it is the one question the scorecard still
       asks, so it comes before the serve breakdown rather than behind it. */
    scoredType && mistakes.reasonsGiven >= MIN_SAMPLES ? (
      <Card
        key="mistakes"
        title={viewer ? `Why ${youLabel} lost` : "Why you lost"}
        hint={`Only points ${voice.you} lost`}
      >
        {mistakes.reasons.slice(0, 8).map((r) => (
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
      </Card>
    ) : null,

    scoredType && serve.described >= MIN_SAMPLES ? (
      <Card key="serve" title="Serve" hint={`Share of those points ${voice.you} won`}>
        {serve.mine.spins.length > 0 && (
          <>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              {voice.myServes} ({serve.mine.count})
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
              {voice.theirServes} ({serve.theirs.count})
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
      </Card>
    ) : null,

    /* The video's cards: serve stats first, then the maps, then the
       endings, so the deck walks from the serve into the point. */
    ...buildScoredCards(scoredCards, labels, "serves", voice),
    ...maps.cards,
    ...buildScoredCards(scoredCards, labels, "endings", voice),

    nextStep ? (
      <NextStepCard
        key="next"
        gate={gate}
        scoredType={scoredType}
        sideMissing={sideMissing}
        onSetUserSide={onSetUserSide}
        controller={placement?.controller ?? null}
        onScore={onScore}
      />
    ) : null,

    /* The deck ends on what is still to come. A placeholder card rather than
       a line of copy, so the swipe reaches a real last card and the promise
       sits where the next card will. Dashed border: it is a space, not a
       result. */
    scoredType && complete && viewer !== "public" ? (
      <div
        key="teaser"
        className="flex w-[86%] shrink-0 snap-center flex-col items-center justify-center rounded-2xl border border-dashed border-edge bg-surface/60 p-6 text-center sm:h-[30rem] sm:w-[calc(50%-0.5rem)] sm:snap-start"
      >
        <div className="flex items-end gap-1.5" aria-hidden="true">
          {[18, 30, 12, 24, 20].map((height, i) => (
            <span
              key={i}
              className="w-2 rounded-sm bg-cyan-glow/20"
              style={{ height }}
            />
          ))}
        </div>
        <p className="mt-5 text-sm font-semibold text-zinc-100">
          More match analysis cards coming soon.
        </p>
      </div>
    ) : null,
  ].filter(Boolean);

  if (cards.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-lg font-semibold">Match analysis</h2>
        <div className="flex items-center gap-3">
          {gameCount >= 2 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Game</span>
              <Segmented
                ariaLabel="Which games"
                value={gameFilter === null ? "all" : String(gameFilter)}
                onChange={(key) =>
                  setGameFilter(key === "all" ? null : Number(key))
                }
                options={[
                  { key: "all", label: "All", srLabel: "All games" },
                  ...Array.from({ length: gameCount }, (_, index) => ({
                    key: String(index),
                    label: String(index + 1),
                    srLabel: `Game ${index + 1}`,
                  })),
                ]}
              />
            </div>
          )}
          {/* Arrows for a mouse; a trackpad or a finger swipes the deck
              directly. Mobile has the swipe and the dots and needs no
              buttons. */}
          <div className="hidden items-center gap-1.5 sm:flex">
            <button
              type="button"
              aria-label="Previous cards"
              onClick={() => page(-1)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-edge text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Next cards"
              onClick={() => page(1)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-edge text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      {neutral && (
        <p className="mt-1 text-sm text-zinc-500">{youLabel}&apos;s analysis</p>
      )}

      <div
        ref={scroller}
        onScroll={onScroll}
        /* One snap carousel on every surface: one card per screen on a
           phone, two per view on desktop, the same swipe either way. Each
           card absorbs its own overflow rather than pushing the ones
           beside it around. */
        className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-4"
      >
        {cards}
      </div>

      {/* dots: where you are in the deck */}
      <div className="mt-2 flex justify-center gap-1.5">
        {cards.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              i === active ? "w-4 bg-cyan-glow" : "w-1.5 bg-edge"
            }`}
          />
        ))}
      </div>

      {/* The whole-match escape hatch: when the table calibration is off
          every camera card is wrong together, so the flag belongs to the
          deck, not to any one card. */}
      {placement?.flagged && placement.onFlagChange && placement.matchId && (
        <MarkedWrongNotice
          className="mt-3"
          matchId={placement.matchId}
          onUndo={() => placement.onFlagChange?.(false)}
        />
      )}
      {placement && !placement.flagged && placement.onFlagChange && maps.cards.length > 0 && (
        <div className="mt-3 flex justify-center">
          <LooksWrongButton
            label="This match's placement maps are wrong"
            onFlag={() => placement.onFlagChange?.(true)}
          />
        </div>
      )}

      {maps.overlay}
    </section>
  );
}
