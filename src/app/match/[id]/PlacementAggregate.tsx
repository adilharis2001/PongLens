"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Point } from "@/lib/types";
import {
  collectTrustedPlacementObservations,
  TABLE_LENGTH_M,
  TABLE_WIDTH_M,
  trustedPlacementPointCount,
  type PlacementAggregateFilter,
} from "@/lib/placement/placementAggregate";
import {
  buildPlacementAggregateView,
  placementAggregateFilterCopy,
  placementPageFromScroll,
  placementPageOffset,
  type PlacementAggregatePage,
} from "@/lib/placement/placementAggregateView";
import type { Side } from "./sides";
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

const FILTERS: {
  key: PlacementAggregateFilter;
  label: string;
}[] = [
  { key: "myServes", label: "My serves" },
  { key: "theirServes", label: "Their serves" },
  { key: "myRally", label: "My rally shots" },
  { key: "theirRally", label: "Their rally shots" },
];

const PAGES: {
  key: PlacementAggregatePage;
  label: string;
}[] = [
  { key: "landings", label: "Landings" },
  { key: "heatmap", label: "Heat map" },
];

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
      points,
      userSide,
      gameIndexByPoint,
      serving,
    }),
  );
}

export function PlacementAggregate({
  points,
  userSide,
  gameIndexByPoint,
  serving,
  labels,
  ownerHandedness = null,
  emptyMessage = null,
}: {
  points: Point[];
  userSide: Side | null;
  gameIndexByPoint: Map<string, number>;
  serving: Map<string, ServeInfo>;
  labels: MapLabels;
  emptyMessage?: string | null;
  ownerHandedness?: "right" | "left" | null;
}) {
  const [filter, setFilter] =
    useState<PlacementAggregateFilter>("myServes");
  const [page, setPage] =
    useState<PlacementAggregatePage>("landings");
  const [gameFilter, setGameFilter] = useState<number | null>(null);
  const pagerRef = useRef<HTMLDivElement | null>(null);

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

  const showPage = useCallback(
    (nextPage: PlacementAggregatePage) => {
      setPage(nextPage);
      const pager = pagerRef.current;
      if (!pager) return;
      pager.scrollTo({
        left: placementPageOffset(
          nextPage,
          pager.clientWidth,
        ),
        behavior: "smooth",
      });
    },
    [],
  );
  const handlePagerScroll = useCallback(() => {
    const pager = pagerRef.current;
    if (!pager) return;
    setPage(
      placementPageFromScroll(
        pager.scrollLeft,
        pager.clientWidth,
      ),
    );
  }, []);

  const helperCopy = placementAggregateFilterCopy(filter);
  const mine =
    filter === "myServes" || filter === "myRally";
  const tone = mine ? YOU_COLOR : THEM_COLOR;
  const anyPlacement = allObservations.length > 0;

  return (
    <section className="mt-8">
      <h3 className="text-base font-semibold">
        Where the ball landed
      </h3>
      <p className="mt-1 text-xs text-zinc-500">
        Trusted landings from the whole match.
      </p>

      <div className="mt-3 rounded-2xl border border-edge bg-surface p-4 sm:max-w-sm lg:max-w-none">
        {!anyPlacement && emptyMessage !== null ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            {emptyMessage}
          </p>
        ) : userSide === null ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            Tell us which side you played to orient the placement
            maps.
          </p>
        ) : !anyPlacement ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            No high-confidence placement data is available for this
            match yet.
          </p>
        ) : (
          <>
            {gameCount >= 2 && (
              <div className="mb-3 flex flex-wrap justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setGameFilter(null)}
                  aria-pressed={gameFilter === null}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    gameFilter === null
                      ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                      : "border-edge bg-ink/40 text-zinc-400 hover:border-cyan-glow/40"
                  }`}
                >
                  All match
                </button>
                {Array.from({ length: gameCount }, (_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setGameFilter(index)}
                    aria-pressed={gameFilter === index}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      gameFilter === index
                        ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                        : "border-edge bg-ink/40 text-zinc-400 hover:border-cyan-glow/40"
                    }`}
                  >
                    Game {index + 1}
                  </button>
                ))}
              </div>
            )}

            <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex min-w-max justify-center">
                <Segmented
                  ariaLabel="Which trusted landings"
                  value={filter}
                  onChange={setFilter}
                  options={FILTERS}
                />
              </div>
            </div>
            <p className="mt-2 text-center text-xs text-zinc-400">
              {helperCopy}
            </p>

            <div className="mt-3 flex justify-center">
              <Segmented
                ariaLabel="Placement view"
                value={page}
                onChange={showPage}
                options={PAGES}
              />
            </div>

            <div
              ref={pagerRef}
              onScroll={handlePagerScroll}
              className="mt-2 flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <div className="w-full shrink-0 snap-center">
                <div className="mx-auto w-full max-w-sm lg:max-w-md">
                  <Table
                    topLabel={labels.them}
                    bottomLabel={labels.you}
                  >
                    {(filter === "theirServes"
                      || filter === "theirRally")
                      && ownerHandedness && (
                        <>
                          <text
                            x={TX + 6}
                            y={TY + TH - 7}
                            fontSize="8"
                            fill="#71717a"
                          >
                            {ownerHandedness === "right"
                              ? "BH"
                              : "FH"}
                          </text>
                          <text
                            x={TX + TW - 6}
                            y={TY + TH - 7}
                            fontSize="8"
                            fill="#71717a"
                            textAnchor="end"
                          >
                            {ownerHandedness === "right"
                              ? "FH"
                              : "BH"}
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
                  <p className="-mt-2 text-center text-xs text-zinc-500">
                    No trusted landings in this view.
                  </p>
                )}
              </div>

              <div className="w-full shrink-0 snap-center">
                {view.sparse ? (
                  <div className="flex min-h-[356px] items-center justify-center px-6">
                    <p className="max-w-xs text-center text-sm text-zinc-500">
                      Not enough trusted landings in this view yet.
                    </p>
                  </div>
                ) : (
                  <div className="mx-auto w-full max-w-sm lg:max-w-md">
                    <PlacementHeatMap
                      observations={view.observations}
                      filter={filter}
                      labels={labels}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="mt-1 flex justify-center gap-1.5">
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

            <p className="mt-2 text-center text-xs text-zinc-400">
              {view.landingCount} trusted{" "}
              {view.landingCount === 1 ? "landing" : "landings"} from{" "}
              {view.pointCount}{" "}
              {view.pointCount === 1 ? "point" : "points"}.
            </p>
            <p className="mt-1 text-center text-[10px] text-zinc-600">
              Mapped for {used} of {totalVisible}{" "}
              {totalVisible === 1 ? "point" : "points"} at 70%+
              confidence.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
