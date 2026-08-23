"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { BetaPill } from "@/components/BetaPill";
import type { TrustedPlacementObservation } from "@/lib/placement/placementAggregate";
import {
  buildPlacementAggregateView,
  placementAggregateCaption,
  placementCoverageLine,
  placementFilterFromAxes,
  placementPageFromScroll,
  placementPageOffset,
  placementSectionTitle,
  placementServeFilter,
  type PlacementAggregatePage,
  type PlacementAggregateShot,
  type PlacementAggregateWho,
} from "@/lib/placement/placementAggregateView";
import { PlacementHeatMap } from "@/app/match/[id]/PlacementHeatMap";
import type { MapLabels } from "@/app/match/[id]/PlacementMap";
import {
  PlacementLandings,
  Segmented,
  THEM_COLOR,
  YOU_COLOR,
} from "@/app/match/[id]/placementTable";

/**
 * Where the ball landed, on the public page.
 *
 * The owner's version of this section (PlacementAggregate) carries three
 * things a viewer has no business with: per-point flagging, the
 * whole-match "these maps are wrong" escape hatch, and the game scope
 * (which needs the game index of every point). What is left is the part
 * worth showing someone — the same two cards, drawn by the same
 * components, from landings the SERVER already filtered down to the ones
 * the vision stands behind.
 *
 * The observations arrive pre-computed. The raw placement column is ~600
 * kB of JSON on a long match; running the trust rules on the server means
 * a few hundred small rows cross the wire instead.
 */

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

export function SharePlacement({
  observations,
  mappedPoints,
  totalPoints,
  labels,
  servesOnly = false,
}: {
  observations: TrustedPlacementObservation[];
  /** Points that contributed at least one trusted landing. */
  mappedPoints: number;
  totalPoints: number;
  labels: MapLabels;
  /** app_config placement_serves_only (132), read on the server. The page
   *  a stranger sees must not say "placement maps" over serves alone. */
  servesOnly?: boolean;
}) {
  const { you, them } = labels;
  const [who, setWho] = useState<PlacementAggregateWho>("me");
  const [shot, setShot] = useState<PlacementAggregateShot>("serves");
  const [page, setPage] = useState<PlacementAggregatePage>("landings");
  const deckRef = useRef<HTMLDivElement | null>(null);

  const filter = servesOnly
    ? placementServeFilter(who)
    : placementFilterFromAxes(who, shot);
  const view = useMemo(
    () => buildPlacementAggregateView(observations, filter),
    [observations, filter]
  );

  const stride = useCallback(() => {
    const card = deckRef.current?.firstElementChild as HTMLElement | null;
    return card ? card.offsetWidth + DECK_GAP : 0;
  }, []);
  const showPage = useCallback(
    (nextPage: PlacementAggregatePage) => {
      setPage(nextPage);
      deckRef.current?.scrollTo({
        left: placementPageOffset(nextPage, stride()),
        behavior: "smooth",
      });
    },
    [stride]
  );
  const handleDeckScroll = useCallback(() => {
    const deck = deckRef.current;
    if (!deck) return;
    setPage(placementPageFromScroll(deck.scrollLeft, stride()));
  }, [stride]);

  if (observations.length === 0) return null;

  const tone = who === "me" ? YOU_COLOR : THEM_COLOR;
  const caption = placementAggregateCaption(
    filter,
    view.landingCount,
    view.pointCount
  );

  return (
    <section className="mt-8">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">
          {placementSectionTitle(servesOnly)}
        </h2>
        <BetaPill />
      </div>
      {/* Coverage only. Not a confidence number — the placement engine
          cannot stand behind one, and printing it made it look as though
          it could. */}
      <p className="mt-1 text-sm text-zinc-500">
        {placementCoverageLine(servesOnly, mappedPoints, totalPoints)}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Segmented
          ariaLabel="Whose shots"
          value={who}
          onChange={setWho}
          options={[
            { key: "me", label: you },
            { key: "them", label: them },
          ]}
        />
        {!servesOnly && (
          <Segmented
            ariaLabel="Which shots"
            value={shot}
            onChange={setShot}
            options={SHOTS}
          />
        )}
      </div>

      <div
        ref={deckRef}
        onScroll={handleDeckScroll}
        className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible"
      >
        <MapCard title="Landings">
          <div className="mx-auto w-full max-w-sm lg:max-w-md">
            <PlacementLandings
              observations={view.observations}
              tone={tone}
              topLabel={them}
              bottomLabel={you}
            />
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

      <p className="mt-2 text-center text-xs text-zinc-500">{caption}</p>
    </section>
  );
}
