import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import {
  getTapEndPlayback,
  getUnscoredRallyEnd,
  getUnscoredRallyEndBufferS,
} from "@/lib/config";
import { MEDIA_BUCKET, getObject } from "@/lib/r2";
import { requireAdmin } from "../../requireAdmin";
import { UploadView } from "./UploadView";
import type { MatchJson, UploadDetail } from "../uploadView";
import type { ServeMissData } from "../serveMiss";

export const metadata: Metadata = {
  title: "Upload",
  robots: { index: false, follow: false },
};

// The payload is a live read of someone else's row and their R2 file.
// Nothing here may be cached between requests.
export const dynamic = "force-dynamic";

/**
 * match.json, read on the SERVER.
 *
 * It has to be here rather than in the browser: R2 sends no
 * Access-Control-Allow-Origin, so a presigned URL cannot be fetch()ed from
 * a page at all — the request dies in preflight. A server component reads
 * the bytes with the account key and hands over parsed values, which also
 * keeps the key where it belongs.
 *
 * Every failure degrades to null. A missing file is the normal state for
 * the seventeen matches that never finished processing, and an unreadable
 * one must cost the page its table drawing, not the whole page.
 */
async function readMatchJson(path: string | null): Promise<MatchJson | null> {
  if (!path) return null;
  const prefix = `r2://${MEDIA_BUCKET}/`;
  if (!path.startsWith(prefix)) return null;
  try {
    const object = await getObject(MEDIA_BUCKET, path.slice(prefix.length));
    if (!object) return null;
    return JSON.parse(new TextDecoder().decode(object.body)) as MatchJson;
  } catch {
    return null;
  }
}

/**
 * The per-card serve diagnosis, if one has been written for this match.
 *
 * Two places, in order. Production writes it beside match.json, so a match
 * processed since the worker learned to keeps its own copy. The research
 * prefix is where the earlier offline pass left eleven of them, and reading
 * it means those matches show the diagnosis today rather than after a
 * reprocess.
 *
 * Absent is the ordinary case, not an error: the page simply does not offer
 * the section.
 */
async function readServeMisses(
  matchJsonPath: string | null,
  matchId: string
): Promise<ServeMissData | null> {
  const prefix = `r2://${MEDIA_BUCKET}/`;
  const keys: string[] = [];
  if (matchJsonPath?.startsWith(prefix)) {
    keys.push(
      matchJsonPath.slice(prefix.length).replace(/match\.json$/, "serves.json")
    );
  }
  keys.push(`research/crossings/${matchId}.serves.json`);
  for (const key of keys) {
    try {
      const object = await getObject(MEDIA_BUCKET, key);
      if (!object) continue;
      return JSON.parse(
        new TextDecoder().decode(object.body)
      ) as ServeMissData;
    } catch {
      // A malformed or unreadable diagnosis costs the section, not the page.
    }
  }
  return null;
}

export default async function AdminUploadPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  const { supabase, avatarUrl } = await requireAdmin();

  const [{ data, error }, themesRes] = await Promise.all([
    supabase.rpc("admin_upload_detail", { p_match_id: matchId }),
    // The shared vocabulary, fetched once for the page rather than per
    // card — every card's picker offers the same list.
    supabase.rpc("admin_themes_list"),
  ]);
  if (error || !data) notFound();
  const detail = data as UploadDetail;
  const themes = (themesRes.data ?? []) as {
    id: string;
    label: string;
    points: number;
  }[];

  // The three playback flags come from app_config on the server, exactly as
  // the match page reads them. Hardcoding them would make the admin watch
  // different boundaries from the owner, which is the one thing this page
  // must not do.
  const [matchJson, serveMisses, tapEnd, rallyEndOn, rallyEndBufferS] =
    await Promise.all([
      readMatchJson(detail.match.match_json_path),
      readServeMisses(detail.match.match_json_path, matchId),
      getTapEndPlayback(),
      getUnscoredRallyEnd(),
      getUnscoredRallyEndBufferS(),
    ]);

  return (
    <>
      <AppNav avatarUrl={avatarUrl} />
      {/* AppNav directly, not AppShell: this page is media-first, and
          AppShell brings a max-width column, its own padding and the
          .page-enter transform — which a fixed-position takeover would
          then resolve against, giving a "full screen" the size of the
          column. Same reason src/app/match/[id]/page.tsx skips it. */}
      <main className="bg-arena flex-1 pb-28 md:pb-16">
        <UploadView
          detail={detail}
          matchJson={matchJson}
          serveMisses={serveMisses}
          themes={themes.map((t) => ({ id: t.id, label: t.label }))}
          ends={{
            tapEnd,
            rallyEnd: { on: rallyEndOn, bufferS: rallyEndBufferS },
          }}
        />
      </main>
    </>
  );
}
