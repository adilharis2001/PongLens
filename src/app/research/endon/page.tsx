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
  title: "End-on cards",
  robots: { index: false, follow: false, nocache: true },
};

const PREFIX = "research/endon/";

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
  const scoring = await scoringFor(ids);
  const scoredCount = [...scoring.values()].filter((v) => v.scored > 0).length;

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
      heading="End-on cards"
      intro={
        <div>
        <p className="mt-2 max-w-prose text-sm text-zinc-400">
          Every match Thanakorn, Guillaume and Anton have uploaded, plus the
          four of yours against Gui, re-run through the pipeline as it stands now with
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
        <p className="mt-3 max-w-prose text-sm text-zinc-400">
          Each panel says which rung of the table ladder answered for that
          run, because a quad that is one table over changes every number
          under it. Where you have scored a match, your own winner calls sit
          on the purple lane as small triangles, blue for you and amber for
          your opponent, placed from the playhead at the moment you tapped.
          A proposed card with no call anywhere inside it is outlined in
          red. That is the one test on this page that owes nothing to a
          detector, so it is worth more than the card count: a tap is you
          saying a rally finished. Read it coarsely. The tap can land ten
          seconds either side of where the rally really ended, so it says
          which rally, not where it stopped.
        </p>
        <p className="mt-3 max-w-prose text-sm text-zinc-400">
          Where you have scored a match, the blue lane now carries the
          scoring: each card is tinted by who won that point, blue for the
          uploader and amber for the opponent, with the running score
          written on it and a pink line where a game ends. Above the video
          is every game with its final score. A game ends at 11, or past
          10-all at the first two-point lead, so any other score means the
          scoring ran out of footage before the game ran out of points, and
          rallies that were played are missing from the cut. Those games are
          red, and the red chips beside them are gaps far longer than that
          game&apos;s own rhythm, which is the closest thing to a pointer at
          the rally that went missing. The last game of a match is excused:
          it is short because the recording stopped.{" "}
          {scoredCount === 0
            ? "None of these matches is scored yet."
            : `${scoredCount} of ${ids.length} of these matches is scored.`}{" "}
          <a
            className="text-cyan-400 underline underline-offset-2"
            href="/research/scores"
          >
            Every scored match is on the score page.
          </a>
        </p>
        </div>
      }
      initialNotes={(notes ?? []) as FullMatchNote[]}
      initialLabels={(labels ?? []) as FullMatchLabel[]}
    />
  );
}
