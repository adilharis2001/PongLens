import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import { V3ServeDetector, type MatchMeta, type Verdict } from "./V3ServeDetector";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "V3 serve detector",
  robots: { index: false, follow: false, nocache: true },
};

export default async function V3ServeDetectorPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/v3-serve-detector");

  // Admin only, like the other research pages: every video here signs
  // through /api/admin/media-url, which is admin-gated itself, so a
  // reviewer who is not the owner would see a dead player and nothing else.
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  // The manifest is written by the lab's export_prod.py alongside each
  // match's payload. Read from disk rather than fetched, so the page does
  // not depend on its own origin being reachable during render.
  let matches: MatchMeta[] = [];
  try {
    const raw = await readFile(
      path.join(process.cwd(), "public/research/v3-serve-detector/index.json"),
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
    />
  );
}
