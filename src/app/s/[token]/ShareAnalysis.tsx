"use client";

import { useMemo } from "react";
import type { Point } from "@/lib/types";
import { AnalysisCards } from "@/app/match/[id]/AnalysisCards";
import { clipPad, effectivePad } from "@/app/match/[id]/clipEdit";
import { computeMatchScore } from "@/app/match/[id]/gameScore";
import { computeMatchAnalysis } from "@/app/match/[id]/matchAnalysis";
import { computeMatchStats } from "@/app/match/[id]/matchStats";
import type { MapLabels } from "@/app/match/[id]/PlacementMap";
import { computeServing } from "@/app/match/[id]/serving";

/**
 * The match analysis deck on the public page: the same cards the owner and
 * their coach swipe through, in the read-only voice. Everything here is
 * derived from the confirmed winners, the serve rotation and the ball
 * track, which is what the link already shows in the video. What is NOT
 * here is deliberate and arrives as absence: the owner's self-reported
 * loss reasons and serve tagging are never in the share payload, so the
 * two cards that read them never appear.
 *
 * The numbers are computed in the browser from the points rather than
 * on the server, because the Game filter on the deck recomputes them per
 * game and a Map does not survive the server-to-client boundary.
 */
export function ShareAnalysis({
  points,
  firstServer,
  userSide,
  labels,
  servesOnly,
  pads,
  placementTrusted,
}: {
  /** The link's visible points, placement already reduced for the page. */
  points: Point[];
  firstServer: "user" | "opponent" | null;
  userSide: "near" | "far" | null;
  labels: MapLabels;
  /** app_config placement_serves_only (132), read on the server. */
  servesOnly: boolean;
  /** The match's clip pads, for the point clock the video cards use. */
  pads: { pre: number; post: number } | null;
  /** Placement is ready, unflagged, and drew enough to show. */
  placementTrusted: boolean;
}) {
  const score = useMemo(() => computeMatchScore(points), [points]);
  const serving = useMemo(
    () => computeServing(points, firstServer),
    [points, firstServer],
  );
  // Players change ends every game, so the uploader's physical side flips
  // on odd games. The same walk the match page does.
  const gameIndexByPoint = useMemo(() => {
    const byPoint = new Map<string, number>();
    let game = 0;
    for (const p of points) {
      byPoint.set(p.id, game);
      if (score.boundaryAfter.has(p.id)) game += 1;
    }
    return byPoint;
  }, [points, score]);
  const stats = useMemo(
    () => computeMatchStats(points, serving, score),
    [points, serving, score],
  );
  const analysis = useMemo(
    () => computeMatchAnalysis(points, serving),
    [points, serving],
  );
  const pad = useMemo(() => clipPad(null, pads), [pads]);
  // A link whose players have no names falls back to "You" and "Them",
  // which is wrong on a stranger's screen; the deck says who is who.
  const named = useMemo(
    () => ({
      ...labels,
      you: labels.you === "You" ? "Player" : labels.you,
      them: labels.them === "Them" ? "Opponent" : labels.them,
    }),
    [labels],
  );

  return (
    <AnalysisCards
      viewer="public"
      stats={stats}
      analysis={analysis}
      youLabel={named.you}
      scoredType
      points={points}
      userSide={userSide}
      gameIndexByPoint={gameIndexByPoint}
      serving={serving}
      prePad={(p) => effectivePad(pad, p.tight_start, p.tight_end).pre}
      customReasonLabels={new Map()}
      labels={named}
      servesOnly={servesOnly}
      placement={placementTrusted ? { trusted: true, flagged: false } : null}
    />
  );
}
