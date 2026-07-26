"use client";

import { useMemo, useState } from "react";
import type { Point } from "@/lib/types";
import { physicalSideForGame, type Side } from "./sides";
import { hasPlacementBounces, type MapLabels } from "./PlacementMap";
import {
  makeMapXY,
  NET_Y,
  Segmented,
  Table,
  THEM_COLOR,
  YOU_COLOR,
} from "./placementTable";

/**
 * Match-level placement: every mappable bounce across all visible points,
 * normalized onto ONE frame (you always at the bottom) so ends swapping
 * between games never smear landings across both halves.
 *
 * For each point we orient with physicalSideForGame(userSide, gameIndex) —
 * the same per-game side the point map uses. Serves (the cleanest coaching
 * signal) lead: a serve's receiver-half bounce lands in the OPPONENT's half
 * (top) exactly when you served, and in YOUR half (bottom) when they did, so
 * we classify each serve by where it actually landed rather than by the
 * rotation guess, which disagrees with the vision on a large share of points.
 * Rally landings follow, colored by the vision's hitter. Only v2 (role-
 * tagged) placement is aggregated; legacy rows and points the vision couldn't
 * map are skipped and counted honestly.
 */

type AggView = "myServes" | "theirServes" | "rally";
type Dot = { x: number; y: number; mine: boolean };

/**
 * How many points contributed at least one mappable landing — the honest
 * "mapped for N of M" numerator, shared with the Tools-card row so the two
 * never disagree. Orientation doesn't affect the count, so this needs only
 * the points: a v2 row with any non-serve_1 bounce counts.
 */
export function mappedPointCount(points: Point[]): number {
  let n = 0;
  for (const p of points) {
    const placement = p.placement;
    if (!placement || !hasPlacementBounces(placement)) continue;
    if (!("v" in placement) || placement.v !== 2) continue;
    if (placement.bounces.some((b) => b.role !== "serve_1")) n += 1;
  }
  return n;
}

export function PlacementAggregate({
  points,
  userSide,
  gameIndexByPoint,
  labels,
}: {
  points: Point[];
  userSide: Side | null;
  gameIndexByPoint: Map<string, number>;
  labels: MapLabels;
}) {
  const [view, setView] = useState<AggView>("myServes");
  // null = whole match; otherwise a 0-based game index. Lets a player see how
  // placement / strategy shifted game to game (serves and rally alike).
  const [gameFilter, setGameFilter] = useState<number | null>(null);

  const gameCount = useMemo(() => {
    let max = -1;
    for (const p of points) {
      const g = gameIndexByPoint.get(p.id) ?? 0;
      if (g > max) max = g;
    }
    return max + 1;
  }, [points, gameIndexByPoint]);

  const agg = useMemo(() => {
    const myServes: Dot[] = [];
    const theirServes: Dot[] = [];
    const rally: Dot[] = [];

    for (const p of points) {
      const placement = p.placement;
      if (!placement || !hasPlacementBounces(placement)) continue;
      // Only v2 rows carry the roles the serve/rally split needs.
      if (!("v" in placement) || placement.v !== 2) continue;

      const gameIndex = gameIndexByPoint.get(p.id) ?? 0;
      // Game filter: skip points outside the selected game.
      if (gameFilter !== null && gameIndex !== gameFilter) continue;
      // Normalize: this point's bottom is the user's physical side THIS game.
      const bottom: Side = userSide
        ? physicalSideForGame(userSide, gameIndex)
        : "near";
      const mapXY = makeMapXY(bottom);

      for (const b of placement.bounces) {
        if (b.role === "serve_1") continue; // server's own-half bounce: noise
        const { x, y } = mapXY(b.u, b.v);
        if (b.role === "serve_2") {
          // Where the serve landed decides whose serve it was: the opponent's
          // half (top) means you served; your half (bottom) means they did.
          const iServed = y < NET_Y;
          (iServed ? myServes : theirServes).push({ x, y, mine: iServed });
        } else {
          // rally / final: colored by who hit the shot (vision's guess).
          rally.push({ x, y, mine: b.hitter_side === bottom });
        }
      }
    }

    return { myServes, theirServes, rally };
  }, [points, userSide, gameIndexByPoint, gameFilter]);

  // Same numerator the Tools-card row shows — one definition, never drifts.
  const used = useMemo(() => mappedPointCount(points), [points]);
  const totalVisible = points.length;
  const anyPlacement = used > 0;

  const views: { key: AggView; label: string }[] = [
    { key: "myServes", label: "My serves" },
    { key: "theirServes", label: "Their serves" },
    { key: "rally", label: "Rally" },
  ];

  const dots =
    view === "myServes"
      ? agg.myServes
      : view === "theirServes"
        ? agg.theirServes
        : agg.rally;

  const viewNote =
    view === "myServes"
      ? "Where your serves landed — the opponent's half."
      : view === "theirServes"
        ? "Where their serves landed — your half."
        : "Every rally landing, colored by who hit it.";

  const noun = view === "rally" ? "rally landing" : "serve";

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Placement map</h2>
      <p className="mt-1 text-xs text-zinc-500">
        If the camera angle wasn&apos;t ideal, placement may be off.
      </p>

      <div className="mt-3 rounded-2xl border border-edge bg-surface p-4 sm:max-w-sm lg:max-w-none">
        {userSide === null ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            Tell us which side you played (below) to see where the ball lands.
          </p>
        ) : !anyPlacement ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            No placement data for this match yet — the ball&apos;s bounces
            couldn&apos;t be mapped from the recording.
          </p>
        ) : (
          <>
            {/* Per-game filter — only once the match has more than one game.
                Lets you compare how placement shifted across games. */}
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
                {Array.from({ length: gameCount }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setGameFilter(i)}
                    aria-pressed={gameFilter === i}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      gameFilter === i
                        ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                        : "border-edge bg-ink/40 text-zinc-400 hover:border-cyan-glow/40"
                    }`}
                  >
                    Game {i + 1}
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-center">
              <Segmented
                ariaLabel="Which landings"
                value={view}
                onChange={setView}
                options={views}
              />
            </div>
            <p className="mt-2 text-center text-xs text-zinc-400">{viewNote}</p>

            <div className="mx-auto mt-3 w-full max-w-sm lg:max-w-md">
              <Table topLabel={labels.them} bottomLabel={labels.you}>
                {dots.map((d, i) => (
                  <circle
                    key={i}
                    cx={d.x}
                    cy={d.y}
                    r="5"
                    fill={d.mine ? YOU_COLOR : THEM_COLOR}
                    fillOpacity="0.5"
                    stroke="#0c1222"
                    strokeWidth="0.75"
                  />
                ))}
              </Table>
            </div>

            <p className="mt-1 text-center text-xs text-zinc-400">
              {dots.length === 0
                ? "No landings in this view."
                : `${dots.length} ${noun}${dots.length === 1 ? "" : "s"}`}
            </p>
            <p className="mt-2 text-center text-[10px] text-zinc-600">
              Mapped for {used} of {totalVisible} point
              {totalVisible === 1 ? "" : "s"}.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
