import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SpinReview } from "./SpinReview";
import type {
  SpinMatchRow,
  SpinNote,
  SpinPointRow,
  SpinPrediction,
} from "./serveSpinView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Serve spin",
  robots: { index: false, follow: false, nocache: true },
};

// Supabase caps a select at 1,000 rows; the corpus is bigger than that,
// and a silent cap here would read as "those matches have no serves".
async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
): Promise<T[]> {
  const page = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < page) return out;
  }
}

export default async function SpinResearchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/spin");

  // Admin only, like the other research pages: the videos sign through
  // /api/media-url under match RLS, and the corpus is the owner's
  // judgement alone.
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  const predictions = await fetchAll<SpinPrediction>(
    supabase,
    "spin_predictions",
    "point_id,algo,predicted_spin,confidence,ratio1,kick1_deg,hop_t,hop_speed,pre_speed,post_speed,serve_cut_s,quality",
  );

  // The covered matches are exactly the ones with prediction rows.
  const coveredIds = Array.from(new Set(predictions.map((p) => p.point_id)));
  const pointRows: {
    id: string;
    match_id: string;
    idx: number;
    cut_t0: number | null;
    serve_spin: "back" | "top" | "none" | null;
    serve_sidespin: boolean | null;
  }[] = [];
  for (let i = 0; i < coveredIds.length; i += 500) {
    const { data, error } = await supabase
      .from("points")
      .select("id,match_id,idx,cut_t0,serve_spin,serve_sidespin")
      .in("id", coveredIds.slice(i, i + 500));
    if (error) throw new Error(`points: ${error.message}`);
    pointRows.push(...(data ?? []));
  }

  const matchIdSet = Array.from(new Set(pointRows.map((p) => p.match_id)));
  const { data: matchRows, error: matchErr } = await supabase
    .from("matches")
    .select("id,opponent_name,venue,created_at")
    .in("id", matchIdSet);
  if (matchErr) throw new Error(`matches: ${matchErr.message}`);

  const notes = await fetchAll<SpinNote>(
    supabase,
    "spin_review_notes",
    "point_id,spin,side,strength,note,predicted_spin,predicted_confidence,algo,blind",
  );

  const byMatch = new Map<string, SpinPointRow[]>();
  for (const p of pointRows) {
    if (p.cut_t0 === null) continue;
    const row: SpinPointRow = {
      pointId: p.id,
      matchId: p.match_id,
      idx: p.idx,
      cutT0: Number(p.cut_t0),
      serveSpin: p.serve_spin,
      serveSidespin: p.serve_sidespin,
    };
    const list = byMatch.get(p.match_id) ?? [];
    list.push(row);
    byMatch.set(p.match_id, list);
  }
  const matches: SpinMatchRow[] = (matchRows ?? [])
    .map((m) => ({
      matchId: m.id as string,
      name: (m.opponent_name as string | null)?.trim() || m.id.slice(0, 8),
      venue: (m.venue as string | null) ?? null,
      points: (byMatch.get(m.id) ?? []).sort((a, b) => a.idx - b.idx),
    }))
    .filter((m) => m.points.length > 0)
    .sort((a, b) => b.points.length - a.points.length);

  return (
    <SpinReview
      matches={matches}
      predictions={predictions}
      initialNotes={notes}
    />
  );
}
