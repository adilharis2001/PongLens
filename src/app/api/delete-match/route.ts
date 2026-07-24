import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  MEDIA_BUCKET,
  deleteObjects,
  headObject,
  listObjects,
} from "@/lib/r2";

export const runtime = "nodejs";

/**
 * POST /api/delete-match — size and delete a match's stored media.
 *
 * Actions:
 *   preview { matchId }  -> { bytes }   what deleting would free
 *   delete  { matchId }  -> { ok }      remove R2 objects + the match row
 *
 * Owner only. Deleting removes, in order:
 *   1. everything under ponglens-media/points/<uid>/<matchId>/ (clips,
 *      match.json, calib debug, reclip outputs)
 *   2. the cut video (matches.cut_path)
 *   3. voice audio for the match's notes (any author)
 *   4. the matches row — cascades points + notes; a DB trigger appends the
 *      negative storage_ledger rows (migration 010)
 */

type R2Ref = { bucket: string; key: string };

function parseR2(path: string | null | undefined): R2Ref | null {
  if (!path || !path.startsWith("r2://")) return null;
  const rest = path.slice("r2://".length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = body.action === "delete" ? "delete" : "preview";
  const matchId = String(body.matchId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(matchId)) {
    return NextResponse.json({ error: "Invalid match" }, { status: 400 });
  }

  // Ownership check under RLS; user_id must be the caller's (a coach can
  // see shared matches but must never delete them).
  const { data: match, error: matchError } = await supabase
    .from("matches")
    .select("id, user_id, cut_path")
    .eq("id", matchId)
    .maybeSingle();
  if (matchError || !match || match.user_id !== user.id) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  const { data: notes } = await supabase
    .from("notes")
    .select("audio_path")
    .eq("match_id", matchId)
    .not("audio_path", "is", null);

  const prefix = `points/${user.id}/${matchId}/`;
  const cut = parseR2(match.cut_path);
  const voiceRefs = (notes ?? [])
    .map((n) => parseR2(n.audio_path))
    .filter((r): r is R2Ref => r !== null && r.bucket === MEDIA_BUCKET);

  try {
    const pointObjects = await listObjects(MEDIA_BUCKET, prefix);

    if (action === "preview") {
      let bytes = pointObjects.reduce((sum, o) => sum + o.size, 0);
      if (cut && cut.bucket === MEDIA_BUCKET) {
        bytes += (await headObject(MEDIA_BUCKET, cut.key)) ?? 0;
      }
      for (const ref of voiceRefs) {
        bytes += (await headObject(MEDIA_BUCKET, ref.key)) ?? 0;
      }
      return NextResponse.json({ bytes });
    }

    // delete: R2 objects first, then the row (the ledger trigger reads the
    // notes rows, so the row deletion must come last).
    const keys = pointObjects.map((o) => o.key);
    if (cut && cut.bucket === MEDIA_BUCKET) keys.push(cut.key);
    for (const ref of voiceRefs) keys.push(ref.key);
    // rendered exports (017 starred, 028 full); deleteObjects treats a 404
    // as fine, and their ledger rows carry match_id so the delete trigger
    // frees them
    keys.push(`reels/${matchId}.mp4`, `reels/${matchId}-full.mp4`);
    if (keys.length > 0) await deleteObjects(MEDIA_BUCKET, keys);

    const { data: deleted, error: deleteError } = await supabase
      .from("matches")
      .delete()
      .eq("id", matchId)
      .eq("user_id", user.id)
      .select("id");
    if (deleteError || !deleted || deleted.length === 0) {
      console.error("delete-match: row delete failed:", deleteError);
      return NextResponse.json(
        { error: "Could not delete the match. Try again." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("delete-match error:", e);
    return NextResponse.json(
      { error: "Could not delete the match. Try again." },
      { status: 500 }
    );
  }
}
