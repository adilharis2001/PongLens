"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { BottomSheet } from "@/components/BottomSheet";
import type { Point } from "@/lib/types";
import {
  collectServePlacementObservations,
  collectTrustedPlacementObservations,
  trustedPlacementPointCount,
  type PlacementZone,
} from "@/lib/placement/placementAggregate";
import {
  buildPlacementAggregateView,
  placementAggregateCaption,
  placementFilterFromAxes,
  placementHeatMapTitle,
  placementServeFilter,
  placementViewIsScored,
  type PlacementAggregateShot,
  type PlacementAggregateWho,
} from "@/lib/placement/placementAggregateView";
import type { Side } from "./sides";
import type { MapLabels } from "./PlacementMap";
import type { ServeInfo } from "./serving";
import { PlacementHeatMap, readableZone } from "./PlacementHeatMap";
import {
  PlacementLandings,
  Segmented,
  THEM_COLOR,
  YOU_COLOR,
} from "./placementTable";
import { Card, OWNER_VOICE, type Voice } from "./cards";

const SHOTS: { key: PlacementAggregateShot; label: string }[] = [
  { key: "serves", label: "Serves" },
  { key: "rally", label: "Rally" },
];

/**
 * A point the owner flagged as wrong stops feeding every map. That is what
 * the flag promises ("this point's map is wrong"), and a landing the owner
 * has disowned would otherwise still colour the heat map.
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
  servesOnly = false,
): number {
  const collect = servesOnly
    ? collectServePlacementObservations
    : collectTrustedPlacementObservations;
  return trustedPlacementPointCount(
    collect({
      points: unflaggedPlacementPoints(points),
      userSide,
      gameIndexByPoint,
      serving,
    }),
  );
}

/**
 * The placement maps as two cards of the Match analysis deck: where the
 * serves landed, and the same landings as a heat map with win rates.
 *
 * They used to be a section of their own with a second dot pager under
 * the analysis deck. One deck now (Adil, 2026-09-15): the maps swipe with
 * the other cards, the Game filter lives on the section and reaches them
 * through `gameFilter`, and whose serves are drawn is a control ON the
 * cards, because it is the one thing only these two cards answer.
 *
 * A hook rather than a component because the deck is one flat list of
 * cards; the maps cannot be a component that renders two siblings into
 * someone else's grid. The zone sheet it returns is rendered by the deck.
 */
export function usePlacementMapCards({
  points: allPoints,
  gameFilter,
  userSide,
  gameIndexByPoint,
  serving,
  labels,
  ownerHandedness = null,
  servesOnly = false,
  enabled = true,
  onOpenPoint,
  voice = OWNER_VOICE,
}: {
  points: Point[];
  gameFilter: number | null;
  userSide: Side | null;
  gameIndexByPoint: Map<string, number>;
  serving: Map<string, ServeInfo>;
  labels: MapLabels;
  ownerHandedness?: "right" | "left" | null;
  /** app_config placement_serves_only (132): serves only, no shot axis. */
  servesOnly?: boolean;
  /** False when the owner flagged the match's maps: no cards at all. */
  enabled?: boolean;
  /** Open one point from a heat map zone's list. Without it the zones stay pictures. */
  onOpenPoint?: (pointId: string) => void;
  /** "you" for the owner; the players' names for a coach or a share link. */
  voice?: Voice;
}): {
  cards: ReactNode[];
  /** The zone sheet, rendered by the deck so it can sit over every card. */
  overlay: ReactNode;
  /** Points with a trusted landing, across every game. */
  mapped: number;
  /** Whether any map can be drawn at all, before the game filter. */
  hasMaps: boolean;
} {
  const [who, setWho] = useState<PlacementAggregateWho>("me");
  const [shot, setShot] = useState<PlacementAggregateShot>("serves");
  const [zoneSheet, setZoneSheet] = useState<{
    zone: PlacementZone;
    pointIds: string[];
  } | null>(null);
  const closeZoneSheet = useCallback(() => setZoneSheet(null), []);

  const points = useMemo(() => unflaggedPlacementPoints(allPoints), [allPoints]);
  const filter = servesOnly
    ? placementServeFilter(who)
    : placementFilterFromAxes(who, shot);

  const allObservations = useMemo(
    () =>
      (servesOnly
        ? collectServePlacementObservations
        : collectTrustedPlacementObservations)({
        points,
        userSide,
        gameIndexByPoint,
        serving,
      }),
    [points, userSide, gameIndexByPoint, serving, servesOnly],
  );
  const observations = useMemo(
    () =>
      gameFilter === null
        ? allObservations
        : allObservations.filter(
            (observation) =>
              (gameIndexByPoint.get(observation.pointId) ?? 0) === gameFilter,
          ),
    [allObservations, gameFilter, gameIndexByPoint],
  );
  const view = useMemo(
    () => buildPlacementAggregateView(observations, filter),
    [observations, filter],
  );
  const mapped = useMemo(
    () => trustedPlacementPointCount(allObservations),
    [allObservations],
  );
  const hasMaps = allObservations.length > 0;

  const caption = placementAggregateCaption(
    filter,
    view.landingCount,
    view.pointCount,
    { your: voice.your, their: voice.their },
  );
  const heatScored = placementViewIsScored(view.observations, filter);
  const mine = who === "me";
  const tone = mine ? YOU_COLOR : THEM_COLOR;

  const zonePoints = zoneSheet
    ? zoneSheet.pointIds
        .map((id) => {
          const index = allPoints.findIndex((point) => point.id === id);
          return index < 0 ? null : { index, point: allPoints[index] };
        })
        .filter((row): row is { index: number; point: Point } => row !== null)
        .sort((a, b) => a.index - b.index)
    : [];

  if (!enabled || !hasMaps || userSide === null) {
    return { cards: [], overlay: null, mapped, hasMaps };
  }

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        ariaLabel="Whose shots"
        value={who}
        onChange={setWho}
        options={[
          { key: "me", label: labels.you },
          { key: "them", label: labels.them },
        ]}
      />
      {/* Rally landings are not shown at the confidence they can be
          reconstructed at, so in serve mode there is no second thing to
          choose between and the control comes off entirely. */}
      {!servesOnly && (
        <Segmented
          ariaLabel="Which shots"
          value={shot}
          onChange={setShot}
          options={SHOTS}
        />
      )}
    </div>
  );

  const cards: ReactNode[] = [
    <Card
      key="landings"
      title={servesOnly ? "Serve landings" : "Landings"}
      hint={caption}
      beta
    >
      {controls}
      <div className="mx-auto mt-3 w-full max-w-[240px]">
        <PlacementLandings
          observations={view.observations}
          tone={tone}
          topLabel={labels.them}
          bottomLabel={labels.you}
          ownerHandedness={ownerHandedness}
          showHands={!mine}
        />
      </div>
      {view.landingCount === 0 && (
        <p className="text-center text-xs text-zinc-500">
          No trusted landings in this view.
        </p>
      )}
    </Card>,
    <Card
      key="heatmap"
      title={placementHeatMapTitle(heatScored)}
      hint={onOpenPoint ? "Tap a zone to see its points" : caption}
      beta
    >
      {controls}
      {view.sparse ? (
        <p className="px-6 py-10 text-center text-sm text-zinc-500">
          Not enough trusted landings in this view yet.
        </p>
      ) : (
        <div className="mx-auto mt-3 w-full max-w-[240px]">
          <PlacementHeatMap
            observations={view.observations}
            filter={filter}
            labels={labels}
            onSelectZone={
              onOpenPoint
                ? (zone, pointIds) => setZoneSheet({ zone, pointIds })
                : undefined
            }
          />
        </div>
      )}
    </Card>,
  ];

  const overlay = (
    <BottomSheet
      open={zoneSheet !== null}
      portal
      title={zoneSheet ? readableZone(zoneSheet.zone) : ""}
      subtitle={
        zoneSheet
          ? `${zonePoints.length} ${zonePoints.length === 1 ? "point" : "points"} with a ${
              servesOnly ? "serve" : "shot"
            } by ${mine ? voice.you : labels.them} landing here.`
          : undefined
      }
      onClose={closeZoneSheet}
      closeLabel="Close the zone's points"
    >
      <ul className="mt-4 space-y-2">
        {zonePoints.map(({ index, point }) => {
          const game = (gameIndexByPoint.get(point.id) ?? 0) + 1;
          const outcome =
            point.confirmed_winner === "user"
              ? voice.youWon
              : point.confirmed_winner === "opponent"
                ? voice.theyWon
                : "Not scored";
          return (
            <li key={point.id}>
              <button
                type="button"
                onClick={() => {
                  closeZoneSheet();
                  onOpenPoint?.(point.id);
                }}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-edge px-3 py-2.5 text-left text-sm transition-colors hover:border-cyan-glow/50"
              >
                <span className="font-semibold text-zinc-100">
                  Point {index + 1}
                  <span className="ml-2 text-xs font-normal text-zinc-500">
                    Game {game}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-xs font-semibold ${
                    point.confirmed_winner === "user"
                      ? "text-cyan-glow"
                      : point.confirmed_winner === "opponent"
                        ? "text-magenta-soft"
                        : "text-zinc-500"
                  }`}
                >
                  {outcome}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );

  return { cards, overlay, mapped, hasMaps };
}
