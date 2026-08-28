import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { listObjects, MEDIA_BUCKET, presignGetBatch } from "@/lib/r2";
import { scoreMatch, type MatchScoring } from "@/lib/research/scoreGaps";
import { fetchVisiblePoints } from "@/lib/research/scorePoints";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  FullMatch,
  type FullMatchLabel,
  type FullMatchNote,
  type FullMatchPanel,
} from "../fullmatch/FullMatch";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Crossing cards",
  robots: { index: false, follow: false, nocache: true },
};

const PREFIX = "research/crossings/";

/**
 * What each match's owner has scored, folded into games.
 *
 * A missing service key is not an error. Locally there is none, and a
 * research page that will not render at all is a worse failure than one
 * that renders without the scoring lane.
 */
async function scoringFor(
  ids: readonly string[],
): Promise<Map<string, MatchScoring>> {
  const out = new Map<string, MatchScoring>();
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return out;
  }
  const byMatch = new Map<string, Parameters<typeof scoreMatch>[0][number][]>();
  for (const row of await fetchVisiblePoints(admin, ids)) {
    const list = byMatch.get(row.match_id) ?? [];
    list.push(row);
    byMatch.set(row.match_id, list);
  }
  for (const [id, list] of byMatch) out.set(id, scoreMatch(list));
  return out;
}

/**
 * Serve-anchored matches, read for the cards the serve detector missed.
 *
 * Its own R2 prefix rather than a filter over /research/endon's, because
 * that page discovers its matches by listing the bucket: anything dropped
 * beside them joins it silently, and these are the opposite kind of match.
 *
 * Both halves come from R2 rather than public/, and that is not a size
 * decision. These are other people's matches, and the repo is public.
 */
export default async function CrossingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/crossings");

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  // Discovered rather than listed in code: the batch fills these in one at
  // a time, so a page that reads the bucket shows whatever is ready
  // instead of 404ing on the ones that are not.
  const objects = await listObjects(MEDIA_BUCKET, PREFIX);
  const ids = objects
    .map((o) => o.key)
    .filter((k) => k.endsWith(".page.json"))
    .map((k) => k.slice(PREFIX.length, -".page.json".length))
    .sort();

  if (ids.length === 0) {
    return (
      <main className="mx-auto max-w-5xl px-5 py-8">
        <h1 className="text-xl font-semibold text-zinc-100">Crossing cards</h1>
        <p className="mt-2 text-sm text-zinc-400">Nothing processed yet.</p>
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
  const scoring = await scoringFor(ids);

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
      dataUrl: `/api/research/crossings/${id}`,
      video: videoUrls[i],
      score: scoring.get(id) ?? null,
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
      crossingFocus
      heading="Crossing cards"
      intro={
        <div>
          <p className="mt-2 max-w-prose text-sm text-zinc-400">
            These matches all routed to the serve-anchored assembler, which
            builds one card per serve it can see. Where it sees no serve, a
            fallback sweeps up whatever ball activity is left over and calls
            that a card. Those are the cards on this page, marked in orange
            under the lane that drew them, and the{" "}
            <span className="text-[#ff9f1c]">Crossing cards only</span> mode
            plays nothing else.
          </p>
          <p className="mt-3 max-w-prose text-sm text-zinc-400">
            A serve is only recognised when the ball bounces twice, once on
            each half of the table, both landings on the playing surface.
            That is the whole test, and it is why a serve into the net or
            long off the end is never found: the second bounce is not where
            the rule requires it. So an orange card is not simply a miss. It
            is either junk with no rally in it, a point the serve itself
            decided, or several rallies the fallback could not tell apart.
            Which of the three it is, is the thing to read here.
          </p>
          <p className="mt-3 max-w-prose text-sm text-zinc-400">
            On the video: the pink outline is the table the run locked onto
            and the white dashed line is the net through the quad&apos;s true
            centre, so a table one bench over is visible immediately. The
            ball trail is yellow inside the play prism and grey once it
            leaves, which is the neighbouring table being ignored. Bounces
            are green on the table and red off it. Sound is on, and the
            bounce ticks are audible, which is often faster than watching.
          </p>
          <p className="mt-3 max-w-prose text-sm text-zinc-400">
            What would help most: for an orange card that holds a real
            rally, whether the serve is visible to you in the picture, and
            if so what the ball did that the two-bounce rule would have
            missed. Mark the boundaries as you go and they save. Nothing
            here was written back to anyone&apos;s account and no one was
            told this ran.
          </p>
        </div>
      }
      initialNotes={(notes ?? []) as FullMatchNote[]}
      initialLabels={(labels ?? []) as FullMatchLabel[]}
    />
  );
}
