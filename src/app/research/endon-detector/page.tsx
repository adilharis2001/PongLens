import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import {
  V3ServeDetector,
  type MatchMeta,
  type Verdict,
} from "../v3-serve-detector/V3ServeDetector";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "End-on detector",
  robots: { index: false, follow: false, nocache: true },
};

export default async function EndonDetectorPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/endon-detector");

  // Admin only, like the other research pages: every video here signs
  // through /api/admin/media-url, which is admin-gated itself.
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  // Matches that went to the end-on assembler on the old detection path,
  // reprocessed on the fixed one (the crop cut from the stored table). Each
  // row is the card the owner sees today; "mine" is the reprocessed card.
  // Nothing in the live match was touched to make these.
  let matches: MatchMeta[] = [];
  try {
    const raw = await readFile(
      path.join(process.cwd(), "public/research/endon-detector/index.json"),
      "utf8",
    );
    matches = JSON.parse(raw) as MatchMeta[];
  } catch {
    matches = [];
  }

  const { data: verdicts } = await supabase
    .from("v3_card_verdicts")
    .select("match_id,serve_s,verdict");

  return (
    <V3ServeDetector
      matches={matches}
      initialVerdicts={(verdicts ?? []) as Verdict[]}
      dataBase="/research/endon-detector"
      // These are NEW detections on a different crop, so the overlay and
      // the boxes belong to this page and not to the serve detector's.
      assetBase="/research/endon-detector"
      heading="Anton’s and Tim’s uploads, reprocessed on the fixed detector"
    />
  );
}
