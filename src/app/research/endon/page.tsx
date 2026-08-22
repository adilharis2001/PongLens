import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { listObjects, MEDIA_BUCKET, presignGetBatch } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import {
  FullMatch,
  type FullMatchLabel,
  type FullMatchNote,
  type FullMatchPanel,
} from "../fullmatch/FullMatch";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "End-on cards",
  robots: { index: false, follow: false, nocache: true },
};

const PREFIX = "research/endon/";

/**
 * Both halves of this page come from R2 rather than public/, and that is not
 * a size decision. These are other people's matches. The repo is public, so
 * a ball track from a stranger's league night cannot be committed to it,
 * which is what /research/fullmatch does with its own three.
 *
 * Which match exists is read from the bucket rather than listed here, so a
 * batch that is still running shows what it has finished so far.
 */
export default async function EndOnPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/endon");

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  // Discovered rather than listed in code: the batch fills these in one at a
  // time, and a page that reads the bucket shows whatever is ready instead
  // of 404ing on the ones that are not.
  const objects = await listObjects(MEDIA_BUCKET, PREFIX);
  const ids = objects
    .map((o) => o.key)
    .filter((k) => k.endsWith(".page.json"))
    .map((k) => k.slice(PREFIX.length, -".page.json".length))
    .sort();

  if (ids.length === 0) {
    return (
      <main className="mx-auto max-w-5xl px-5 py-8">
        <h1 className="text-xl font-semibold text-zinc-100">End-on cards</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Nothing processed yet.
        </p>
      </main>
    );
  }

  // Video only. The signal dump comes back through /api/research/endon/<id>
  // because R2 sends no CORS header and `fetch` cannot read a presigned URL;
  // a <video> can, so it keeps the direct link.
  const videoUrls = await presignGetBatch(
    ids.map((id) => ({
      bucket: MEDIA_BUCKET,
      key: `${PREFIX}${id}.mp4`,
      opts: { expiresSeconds: 12 * 3600 },
    })),
  );

  const { data: rows } = await supabase
    .from("matches")
    .select("id,opponent_name,venue,created_at")
    .in("id", ids);
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));

  const panels: FullMatchPanel[] = ids.map((id, i) => {
    const m = byId.get(id);
    const when = m?.created_at
      ? new Date(m.created_at).toISOString().slice(0, 10)
      : "";
    const who = m?.opponent_name ? `vs ${m.opponent_name}` : "no opponent set";
    const where = m?.venue ? ` · ${m.venue}` : "";
    return {
      key: id,
      title: `${who}${where} · ${when} · ${id.slice(0, 8)}`,
      dataUrl: `/api/research/endon/${id}`,
      video: videoUrls[i],
    };
  });

  const { data: notes } = await supabase
    .from("sidecam_review_notes")
    .select("case_id,verdict,note")
    .in(
      "case_id",
      ids.map((id) => `${id}@full`),
    );

  const { data: labels } = await supabase
    .from("fullmatch_labels")
    .select("id,match_key,kind,t_s,winner,end_kind")
    .in("match_key", ids)
    .order("t_s");

  return (
    <FullMatch
      videos={{}}
      panels={panels}
      heading="End-on cards"
      intro={
        <p className="mt-2 max-w-prose text-sm text-zinc-400">
          Every match Thanakorn and Guillaume have uploaded, plus the four of
          yours against Gui, re-run through the pipeline as it stands now with
          the end-on fallback switched on. Nothing here was written back to
          anyone&apos;s account, so the scoring and notes on these matches are
          untouched and no one was told this ran. The blue lane is the cards
          each match has today. The purple lane under it is what the pipeline
          would produce if it ran again. Your own marks run full height over
          both: serve cyan, end orange, let blue. Then serve calls, net
          crossings, bounces (green on the table, red off it), and
          rally-strength ball motion. Sound is on. Mark where the points
          really start and end, and the marks save as you go.
        </p>
      }
      initialNotes={(notes ?? []) as FullMatchNote[]}
      initialLabels={(labels ?? []) as FullMatchLabel[]}
    />
  );
}
