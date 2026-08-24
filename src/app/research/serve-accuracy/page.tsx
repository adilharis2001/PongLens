import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Match, Point } from "@/lib/types";
import { computeMatchScore } from "@/app/match/[id]/gameScore";
import { computeServing } from "@/app/match/[id]/serving";
import { diagnoseServePlacement } from "@/lib/placement/placementAggregate";
import { ServeAccuracy } from "./ServeAccuracy";
import {
  livePoints,
  type ServeAccuracyMatch,
  type ServeAccuracyRow,
} from "./serveAccuracyModel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Serve accuracy",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The two fully scored matches the serve rule was measured on. Hardcoded
 * because this page exists to answer "is it accurate on THESE", not to be
 * a general browser — a match picker would invite reading the numbers off
 * matches nobody has watched.
 */
const MATCHES = [
  { id: "ec6490f4-b835-4d82-882a-8fb2f1abc2e5", label: "Chris" },
  { id: "7e02fbb9-a3af-4686-84bc-d4b961ab9fed", label: "Julian" },
] as const;

export default async function ServeAccuracyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/serve-accuracy");

  // Admin only. Every clip signs through /api/media-url under the match
  // owner's RLS, so a reviewer who is not the owner sees dead cards.
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  const matches: ServeAccuracyMatch[] = [];
  for (const entry of MATCHES) {
    const [matchRes, pointsRes] = await Promise.all([
      supabase.from("matches").select("*").eq("id", entry.id).maybeSingle(),
      supabase
        .from("points")
        .select("*")
        .eq("match_id", entry.id)
        .order("idx", { ascending: true }),
    ]);
    const match = matchRes.data as Match | null;
    if (!match) continue;
    const all = (pointsRes.data ?? []) as Point[];
    const visible = livePoints(all);

    // The same walk the match page does: game index drives which end the
    // owner is on, and getting it wrong smears bounces across both halves.
    const score = computeMatchScore(visible);
    const gameIndexByPoint = new Map<string, number>();
    let game = 0;
    for (const p of visible) {
      gameIndexByPoint.set(p.id, game);
      if (score.boundaryAfter.has(p.id)) game += 1;
    }
    const serving = computeServing(visible, match.first_server);

    const diagnoses = diagnoseServePlacement({
      points: visible,
      userSide: match.user_side,
      gameIndexByPoint,
      serving,
    });
    const byId = new Map(visible.map((p) => [p.id, p]));
    const rows: ServeAccuracyRow[] = diagnoses.map((d) => {
      const point = byId.get(d.pointId);
      return {
        pointId: d.pointId,
        idx: point?.idx ?? 0,
        game: d.gameIndex + 1,
        server: d.server,
        winner: point?.confirmed_winner ?? null,
        isLet: point?.is_let === true,
        serve: d.observation
          ? { u: d.observation.u, v: d.observation.v }
          : null,
        final: d.finalLanding,
        rejection: d.rejection,
      };
    });

    matches.push({
      matchId: entry.id,
      label: entry.label,
      opponent: match.opponent_name ?? entry.label,
      rows,
    });
  }

  if (matches.length === 0) notFound();
  return <ServeAccuracy matches={matches} />;
}
