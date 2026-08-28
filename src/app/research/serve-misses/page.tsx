import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { listObjects, MEDIA_BUCKET, presignGetBatch } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import { ServeMisses, type MissMatch } from "./ServeMisses";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Serve misses",
  robots: { index: false, follow: false, nocache: true },
};

const PREFIX = "research/crossings/";
const SUFFIX = ".serves.json";

/**
 * Card-level view of the same matches /research/crossings shows whole.
 *
 * It reads `.serves.json`, which research_serve_misses.py writes beside
 * the bundle, and lists only the matches that have one: the diagnosis is
 * a separate pass over the same evidence, so a match can be on the
 * timeline page before it is on this one.
 */
export default async function ServeMissesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/serve-misses");

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  const objects = await listObjects(MEDIA_BUCKET, PREFIX);
  const ids = objects
    .map((o) => o.key)
    .filter((k) => k.endsWith(SUFFIX))
    .map((k) => k.slice(PREFIX.length, -SUFFIX.length))
    .sort();

  if (ids.length === 0) {
    return (
      <main className="mx-auto max-w-5xl px-5 py-8">
        <h1 className="text-xl font-semibold text-zinc-100">Serve misses</h1>
        <p className="mt-2 text-sm text-zinc-400">Nothing diagnosed yet.</p>
      </main>
    );
  }

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

  const matches: MissMatch[] = ids.map((id, i) => {
    const m = byId.get(id);
    const when = m?.created_at
      ? new Date(m.created_at).toISOString().slice(0, 10)
      : "";
    const who = m?.opponent_name ? `vs ${m.opponent_name}` : "no opponent set";
    const where = m?.venue ? ` · ${m.venue}` : "";
    return {
      key: id,
      title: `${who}${where} · ${when} · ${id.slice(0, 8)}`,
      video: videoUrls[i],
      dataUrl: `/api/research/serve-misses/${id}`,
    };
  });

  return <ServeMisses matches={matches} />;
}
