"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { BetaPill } from "@/components/BetaPill";
import type { Point } from "@/lib/types";
import {
  collectTrustedPlacementObservations,
  TABLE_LENGTH_M,
  TABLE_WIDTH_M,
  trustedPlacementPointCount,
} from "@/lib/placement/placementAggregate";
import {
  buildPlacementAggregateView,
  placementAggregateCaption,
  placementFilterFromAxes,
  placementPageFromScroll,
  placementPageOffset,
  type PlacementAggregatePage,
  type PlacementAggregateShot,
  type PlacementAggregateWho,
} from "@/lib/placement/placementAggregateView";
import type { Side } from "./sides";
import {
  LooksWrongButton,
  MarkedWrongNotice,
} from "./PlacementFeedback";
import type { MapLabels } from "./PlacementMap";
import type { ServeInfo } from "./serving";
import { PlacementHeatMap } from "./PlacementHeatMap";
import {
  Segmented,
  Table,
  THEM_COLOR,
  TH,
  TW,
  TX,
  TY,
  YOU_COLOR,
} from "./placementTable";

const SHOTS: { key: PlacementAggregateShot; label: string }[] = [
  { key: "serves", label: "Serves" },
  { key: "rally", label: "Rally" },
];

const PAGES: { key: PlacementAggregatePage; label: string }[] = [
  { key: "landings", label: "Landings" },
  { key: "heatmap", label: "Heat map" },
];

/** Deck gap in px — must match the `gap-3` on the scroller below. */
const DECK_GAP = 12;

/**
 * A point the owner flagged as wrong stops feeding every map. That is what
 * makes the flag an override rather than a comment: it changes what the
 * match-level maps are built from, so a rally the vision plainly botched
 * can't keep skewing the aggregate the owner is trying to read.
 */
export function unflaggedPlacementPoints(points: Point[]): Point[] {
  return points.some((point) => point.placement_flagged)
    ? points.filter((point) => !point.placement_flagged)
    : points;
}

/**
 * Count points that contribute at least one observation to the exact map or
 * heat map. This is the same strict definition both aggregate pages use.
 */
export function mappedPointCount(
  points: Point[],
  userSide: Side | null = null,
  gameIndexByPoint: Map<string, number> = new Map(),
  serving: Map<string, ServeInfo> = new Map(),
): number {
  return trustedPlacementPointCount(
    collectTrustedPlacementObservations({
      points: unflaggedPlacementPoints(points),
      userSide,
      gameIndexByPoint,
      serving,
    }),
  );
}

/**
 * One view of the same filtered landings. Mirrors the AnalysisCards deck
 * shell on purpose: a snap target sized by its content on mobile (so the
 * page scrolls normally), a plain grid cell on desktop.
 */
function MapCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-[86%] shrink-0 snap-center flex-col rounded-2xl border border-edge bg-surface p-4 sm:w-full">
      <h3 className="shrink-0 text-sm font-semibold text-zinc-100">{title}</h3>
      <div className="mt-3 flex flex-1 flex-col justify-center">{children}</div>
    </div>
  );
}

/**
 * Match-level placement: where the ball landed across every point with a
 * trusted bounce, always drawn with the user at the bottom.
 *
 * THREE AXES, RANKED — the section used to stack all three as equal
 * centered rows (game pills, four shot tabs, a landings/heat-map toggle)
 * plus a floating caption, which is what made it read as clutter:
 *   - WHICH SHOTS is the question you actually came to ask, so it gets the
 *     one prominent control row — split into whose/which, because four flat
 *     labels ("Their rally shots") overflowed a phone and clipped mid-word;
 *   - GAME SCOPE is changed rarely, so it rides in the header beside the
 *     title as compact numbers;
 *   - LANDINGS vs HEAT MAP stops being a control at all. The two views are
 *     a card deck (swipe on mobile, side by side on desktop, where the
 *     comparison is the point), so the toggle and its duplicate dot pager
 *     collapse into one affordance.
 */
export function PlacementAggregate({
  points: allPoints,
  matchId,
  flagged,
  onFlagChange,
  userSide,
  gameIndexByPoint,
  serving,
  labels,
  ownerHandedness = null,
  emptyMessage = null,
}: {
  points: Point[];
  matchId: string;
  /** The owner said this match's maps are wrong (matches.placement_flagged);
   *  the section stands down to a single undoable line. */
  flagged: boolean;
  onFlagChange: (flagged: boolean) => void;
  userSide: Side | null;
  gameIndexByPoint: Map<string, number>;
  serving: Map<string, ServeInfo>;
  labels: MapLabels;
  emptyMessage?: string | null;
  ownerHandedness?: "right" | "left" | null;
}) {
  const [who, setWho] = useState<PlacementAggregateWho>("me");
  const [shot, setShot] = useState<PlacementAggregateShot>("serves");
  const [page, setPage] =
    useState<PlacementAggregatePage>("landings");
  const [gameFilter, setGameFilter] = useState<number | null>(null);
  const deckRef = useRef<HTMLDivElement | null>(null);

  // Points the owner flagged one at a time never reach any of the maths
  // below — see unflaggedPlacementPoints.
  const points = useMemo(() => unflaggedPlacementPoints(allPoints), [allPoints]);

  const filter = placementFilterFromAxes(who, shot);

  const gameCount = useMemo(() => {
    let max = -1;
    for (const point of points) {
      max = Math.max(
        max,
        gameIndexByPoint.get(point.id) ?? 0,
      );
    }
    return max + 1;
  }, [points, gameIndexByPoint]);

  const allObservations = useMemo(
    () =>
      collectTrustedPlacementObservations({
        points,
        userSide,
        gameIndexByPoint,
        serving,
      }),
    [points, userSide, gameIndexByPoint, serving],
  );
  const observations = useMemo(
    () =>
      gameFilter === null
        ? allObservations
        : allObservations.filter(
            (observation) =>
              (gameIndexByPoint.get(observation.pointId) ?? 0)
              === gameFilter,
          ),
    [allObservations, gameFilter, gameIndexByPoint],
  );
  const view = useMemo(
    () => buildPlacementAggregateView(observations, filter),
    [observations, filter],
  );
  const used = useMemo(
    () => trustedPlacementPointCount(observations),
    [observations],
  );
  const totalVisible = useMemo(
    () =>
      gameFilter === null
        ? points.length
        : points.filter(
            (point) =>
              (gameIndexByPoint.get(point.id) ?? 0) === gameFilter,
          ).length,
    [points, gameFilter, gameIndexByPoint],
  );

  /** Distance between card origins: card width plus the deck's gap. */
  const stride = useCallback(() => {
    const card = deckRef.current?.firstElementChild as HTMLElement | null;
    return card ? card.offsetWidth + DECK_GAP : 0;
  }, []);

  const showPage = useCallback(
    (nextPage: PlacementAggregatePage) => {
      setPage(nextPage);
      const deck = deckRef.current;
      if (!deck) return;
      deck.scrollTo({
        left: placementPageOffset(nextPage, stride()),
        behavior: "smooth",
      });
    },
    [stride],
  );
  const handleDeckScroll = useCallback(() => {
    const deck = deckRef.current;
    if (!deck) return;
    setPage(placementPageFromScroll(deck.scrollLeft, stride()));
  }, [stride]);

  const caption = placementAggregateCaption(
    filter,
    view.landingCount,
    view.pointCount,
  );
  const mine = who === "me";
  const tone = mine ? YOU_COLOR : THEM_COLOR;
  const anyPlacement = allObservations.length > 0;

  // One message, not a deck of cards each saying nothing.
  const blocked =
    !anyPlacement && emptyMessage !== null
      ? emptyMessage
      : userSide === null
        ? "Tell us which side you played to orient the placement maps."
        : !anyPlacement
          ? "No high-confidence placement data is available for this match yet."
          : null;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Placement maps</h2>
          <BetaPill />
        </div>
        {!flagged && blocked === null && gameCount >= 2 && (
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
      </div>

      {flagged ? (
        <MarkedWrongNotice
          className="mt-2"
          matchId={matchId}
          onUndo={() => onFlagChange(false)}
        />
      ) : blocked !== null ? (
        <div className="mt-3 rounded-2xl border border-edge bg-surface p-4 sm:max-w-sm lg:max-w-none">
          <p className="py-6 text-center text-sm text-zinc-500">{blocked}</p>
        </div>
      ) : (
        <>
          {/* Coverage only. The confidence threshold used to ride on the
              end of this line, which read as a calibrated number the
              placement engine cannot actually stand behind. */}
          <p className="mt-1 text-sm text-zinc-500">
            Mapped for {used} of {totalVisible}{" "}
            {totalVisible === 1 ? "point" : "points"}.
          </p>

          {/* The one prominent control: whose shots, and which of them. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Segmented
              ariaLabel="Whose shots"
              value={who}
              onChange={setWho}
              options={[
                { key: "me", label: labels.you },
                { key: "them", label: labels.them },
              ]}
            />
            <Segmented
              ariaLabel="Which shots"
              value={shot}
              onChange={setShot}
              options={SHOTS}
            />
          </div>

          <div
            ref={deckRef}
            onScroll={handleDeckScroll}
            /* Mobile: a snap carousel where the second card peeks, which is
               what says there IS a second view. Desktop: both at once —
               exact landings beside density is the comparison worth having. */
            className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible"
          >
            <MapCard title="Landings">
              <div className="mx-auto w-full max-w-sm lg:max-w-md">
                <Table topLabel={labels.them} bottomLabel={labels.you}>
                  {!mine && ownerHandedness && (
                    <>
                      <text
                        x={TX + 6}
                        y={TY + TH - 7}
                        fontSize="8"
                        fill="#71717a"
                      >
                        {ownerHandedness === "right" ? "BH" : "FH"}
                      </text>
                      <text
                        x={TX + TW - 6}
                        y={TY + TH - 7}
                        fontSize="8"
                        fill="#71717a"
                        textAnchor="end"
                      >
                        {ownerHandedness === "right" ? "FH" : "BH"}
                      </text>
                    </>
                  )}
                  {view.observations.map((observation) => (
                    <circle
                      key={`${observation.pointId}-${observation.shotSeq}`}
                      cx={
                        TX
                        + (TW * observation.u)
                          / TABLE_WIDTH_M
                      }
                      cy={
                        TY
                        + TH
                          * (1
                            - observation.v
                              / TABLE_LENGTH_M)
                      }
                      r="5"
                      fill={tone}
                      fillOpacity="0.52"
                      stroke="#0c1222"
                      strokeWidth="0.75"
                    />
                  ))}
                </Table>
              </div>
              {view.landingCount === 0 && (
                <p className="text-center text-xs text-zinc-500">
                  No trusted landings in this view.
                </p>
              )}
            </MapCard>

            <MapCard title="Heat map">
              {view.sparse ? (
                <p className="px-6 py-10 text-center text-sm text-zinc-500">
                  Not enough trusted landings in this view yet.
                </p>
              ) : (
                <div className="mx-auto w-full max-w-sm lg:max-w-md">
                  <PlacementHeatMap
                    observations={view.observations}
                    filter={filter}
                    labels={labels}
                  />
                </div>
              )}
            </MapCard>
          </div>

          {/* dots: the swipe affordance, mobile only */}
          <div className="mt-2 flex justify-center gap-1.5 sm:hidden">
            {PAGES.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-label={`Show ${option.label}`}
                aria-pressed={page === option.key}
                onClick={() => showPage(option.key)}
                className={`h-1.5 rounded-full transition-all ${
                  page === option.key
                    ? "w-4 bg-cyan-glow"
                    : "w-1.5 bg-edge hover:bg-zinc-600"
                }`}
              />
            ))}
          </div>

          {/* One caption for the deck, not one per card: both cards render
              the SAME filtered landings, so per-card copy just repeated
              itself side by side on desktop. */}
          <p className="mt-2 text-center text-xs text-zinc-500">{caption}</p>

          {/* The whole-match escape hatch: when the table calibration is off
              every card above is wrong together, so the flag belongs to the
              section, not to any one card. */}
          <div className="mt-3 flex justify-center">
            <LooksWrongButton
              label="This match's placement maps are wrong"
              onFlag={() => onFlagChange(true)}
            />
          </div>
        </>
      )}
    </section>
  );
}
