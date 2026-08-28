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

export default async function AdminUploadPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  const { supabase, avatarUrl } = await requireAdmin();

  const { data, error } = await supabase.rpc("admin_upload_detail", {
    p_match_id: matchId,
  });
  if (error || !data) notFound();
  const detail = data as UploadDetail;

  // The three playback flags come from app_config on the server, exactly as
  // the match page reads them. Hardcoding them would make the admin watch
  // different boundaries from the owner, which is the one thing this page
  // must not do.
  const [matchJson, tapEnd, rallyEndOn, rallyEndBufferS] = await Promise.all([
    readMatchJson(detail.match.match_json_path),
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
          ends={{
            tapEnd,
            rallyEnd: { on: rallyEndOn, bufferS: rallyEndBufferS },
          }}
        />
      </main>
    </>
  );
}
