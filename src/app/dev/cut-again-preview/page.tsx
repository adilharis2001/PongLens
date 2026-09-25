import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RAW_BUCKET, presignGet } from "@/lib/r2";
import { CutAgainPreview } from "./CutAgainPreview";

export const dynamic = "force-dynamic";

/**
 * Dev-only rendering of Cut again's marker on the ORIGINAL of one of the
 * signed-in owner's own matches, prefilled from its current points as
 * start_recut would prefill it. It
 * exists so every state can be looked at and screenshotted before the
 * database calls are live, and without anything being written: the
 * marker's draft saves and its submit are fakes here. Never served in
 * production.
 *
 *   ?match=<id>   one of your own processed matches (required)
 *   &marks=all|none|first=<n>  &mode=cut|score
 *   &recut=0      the unprocessed page's marker: no Start again, no choice
 *   &choice=replace  &coach=1  &notes=1   the review sheet's choice
 *
 * The More options sheet itself is checked on the real match page, with
 * its four database calls answered by the browser harness.
 */
export default async function CutAgainPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!params.match) notFound();

  const { data: match } = await supabase
    .from("matches")
    .select("*")
    .eq("id", params.match)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!match) notFound();

  const pointQuery = supabase
    .from("points")
    .select("id, t0, t1, confirmed_winner, is_let, starred, deleted")
    .eq("match_id", match.id);
  const { data: points } = await (match.active_processing_version_id
    ? pointQuery.eq("processing_version_id", match.active_processing_version_id)
    : pointQuery
  ).order("idx", { ascending: true });

  let rawUrl: string | null = null;
  if (typeof match.raw_path === "string" && match.raw_path.startsWith(`r2://${RAW_BUCKET}/`)) {
    rawUrl = await presignGet(
      RAW_BUCKET,
      match.raw_path.slice(`r2://${RAW_BUCKET}/`.length),
      { expiresSeconds: 6 * 3600, disposition: "inline" },
    );
  }

  return (
    <main className="bg-arena min-h-dvh">
      <CutAgainPreview
        params={params}
        match={match}
        rawUrl={rawUrl}
        points={(points ?? []) as PreviewPoint[]}
        userId={user.id}
      />
    </main>
  );
}

export interface PreviewPoint {
  id: string;
  t0: number | null;
  t1: number | null;
  confirmed_winner: "user" | "opponent" | null;
  is_let: boolean;
  starred: boolean;
  deleted: boolean;
}
