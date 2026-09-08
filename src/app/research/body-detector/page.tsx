import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import {
  V3ServeDetector,
  type MatchMeta,
  type RowVerdict,
  type Verdict,
} from "../v3-serve-detector/V3ServeDetector";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Body detector",
  robots: { index: false, follow: false, nocache: true },
};

export default async function BodyDetectorPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/body-detector");

  // Admin only, like the other research pages: every video here signs
  // through /api/admin/media-url, which is admin-gated itself, so a
  // reviewer who is not the owner would see a dead player and nothing else.
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  // The manifest is written by the lab's export alongside each match's
  // payload. Read from disk rather than fetched, so the page does not depend
  // on its own origin being reachable during render. An empty list is the
  // normal state before the first export, and the page says so.
  let matches: MatchMeta[] = [];
  try {
    const raw = await readFile(
      path.join(process.cwd(), "public/research/body-detector/index.json"),
      "utf8",
    );
    matches = JSON.parse(raw) as MatchMeta[];
  } catch {
    matches = [];
  }

  // The same verdicts table as the serve detector, on purpose: a call about
  // whether a moment is really a serve is a call about the footage, not
  // about which assembler drew the card over it.
  const { data: verdicts } = await supabase
    .from("v3_card_verdicts")
    .select("match_id,serve_s,verdict");

  // Adil's calls on this page's rows: which flags are the reference's
  // fault. Per page, because the body cards and the ball cards over the
  // same point are different cards.
  const { data: rowVerdicts } = await supabase
    .from("research_row_verdicts")
    .select("match_id,row_s,verdict,note")
    .eq("page", "body-detector");

  return (
    <V3ServeDetector
      matches={matches}
      initialVerdicts={(verdicts ?? []) as Verdict[]}
      initialRowVerdicts={(rowVerdicts ?? []) as RowVerdict[]}
      dataBase="/research/body-detector"
      // The overlay, the boxes and the keypoints describe the video, which
      // is the same video the serve detector reviews. Read them from there
      // rather than shipping a second copy.
      assetBase="/research/v3-serve-detector"
      heading="Cards from the players’ bodies, not the ball"
    />
  );
}
