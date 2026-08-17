import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HoldoutReview } from "./HoldoutReview";
import type { HoldoutRow } from "./types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Table calibration holdout",
  robots: { index: false, follow: false, nocache: true },
};

export default async function HoldoutPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/table-calibration/holdout");

  const [{ data: isAdmin }, reviewer] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase
      .from("research_reviewers")
      .select("active")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  if (isAdmin !== true && reviewer.data?.active !== true) notFound();

  // Labels are stored on the row rather than embedded from matches: there are
  // two foreign keys to matches on the sibling table and matches grants
  // select only to the owner and their coaches, so an embed would be
  // ambiguous and would silently drop other users' uploads.
  const { data, error } = await supabase
    .from("table_calibration_holdout")
    .select(
      "id,match_id,frame_index,frame_time_s,frame_key,frame_width,frame_height," +
        "source_width,source_height,venue,opponent_name,quad,detail,verdict," +
        "notes,reviewed_at",
    )
    .order("match_id", { ascending: true })
    .order("frame_index", { ascending: true });

  if (error) {
    console.error("holdout query failed", error);
    throw new Error("Could not load the holdout set.");
  }

  const rows = (data ?? []) as unknown as HoldoutRow[];
  return <HoldoutReview rows={rows} />;
}
