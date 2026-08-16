import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TableCalibrationReview } from "./TableCalibrationReview";
import type { CalibrationRow, Corner, Proposals, Verdict } from "./types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Table calibration review",
  robots: { index: false, follow: false, nocache: true },
};

interface RawRow {
  match_id: string;
  frame_key: string;
  frame_width: number;
  frame_height: number;
  source_width: number;
  source_height: number;
  duplicate_of: string | null;
  duplicate_reason: string | null;
  proposals: Proposals | null;
  corrected_corners: Corner[] | null;
  verdict: Verdict | null;
  notes: string | null;
  reviewed_at: string | null;
  matches:
    | {
        opponent_name: string | null;
        venue: string | null;
        placement_status: string | null;
        original_name: string | null;
      }
    | {
        opponent_name: string | null;
        venue: string | null;
        placement_status: string | null;
        original_name: string | null;
      }[]
    | null;
}

export default async function TableCalibrationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/table-calibration");

  const [{ data: isAdmin }, reviewer] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase
      .from("research_reviewers")
      .select("active")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  if (isAdmin !== true && reviewer.data?.active !== true) notFound();

  const { data, error } = await supabase
    .from("table_calibration_review")
    .select(
      "match_id,frame_key,frame_width,frame_height,source_width,source_height," +
        "duplicate_of,duplicate_reason,proposals,corrected_corners,verdict," +
        "notes,reviewed_at," +
        "matches!inner(opponent_name,venue,placement_status,original_name)",
    )
    .order("match_id", { ascending: true });

  if (error) {
    console.error("table calibration query failed", error);
    throw new Error("Could not load table calibration review.");
  }

  const rows: CalibrationRow[] = ((data ?? []) as unknown as RawRow[]).map(
    (row) => {
      const match = Array.isArray(row.matches) ? row.matches[0] : row.matches;
      return {
        matchId: row.match_id,
        frameKey: row.frame_key,
        frameWidth: row.frame_width,
        frameHeight: row.frame_height,
        sourceWidth: row.source_width,
        sourceHeight: row.source_height,
        duplicateOf: row.duplicate_of,
        duplicateReason: row.duplicate_reason,
        proposals: row.proposals ?? { luna: null, sol: null, production: null },
        correctedCorners: row.corrected_corners,
        verdict: row.verdict,
        notes: row.notes,
        reviewedAt: row.reviewed_at,
        opponent: match?.opponent_name ?? null,
        venue: match?.venue ?? null,
        placementStatus: match?.placement_status ?? null,
        originalName: match?.original_name ?? null,
      };
    },
  );

  return <TableCalibrationReview rows={rows} />;
}
