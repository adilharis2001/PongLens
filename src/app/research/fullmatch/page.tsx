import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { MEDIA_BUCKET, presignGet } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import {
  FullMatch,
  type FullMatchLabel,
  type FullMatchNote,
} from "./FullMatch";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Full-match signals",
  robots: { index: false, follow: false, nocache: true },
};

const KEYS = ["koko", "terry"] as const;

export default async function FullMatchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/fullmatch");

  // Admin only, like every research page.
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  // The continuous videos live in R2, not public/ — 65MB must not ride
  // every deploy. This page is already behind the admin gate, so a signed
  // URL minted here leaks nothing the viewer could not already open.
  const videos: Record<string, string> = {};
  for (const key of KEYS) {
    videos[key] = await presignGet(
      MEDIA_BUCKET,
      `research/fullmatch/${key}.mp4`,
      { expiresSeconds: 12 * 3600 },
    );
  }

  const { data: notes } = await supabase
    .from("sidecam_review_notes")
    .select("case_id,verdict,note")
    .in(
      "case_id",
      KEYS.map((k) => `${k}@full`),
    );

  const { data: labels } = await supabase
    .from("fullmatch_labels")
    .select("id,match_key,kind,t_s,winner,end_kind")
    .in("match_key", [...KEYS])
    .order("t_s");

  return (
    <FullMatch
      videos={videos}
      initialNotes={(notes ?? []) as FullMatchNote[]}
      initialLabels={(labels ?? []) as FullMatchLabel[]}
    />
  );
}
