import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, deleteObjects, headObject, presignPut } from "@/lib/r2";

/**
 * POST /api/point-clip — a point's clip file cut on the phone (spec
 * 2026-09-06, step 5).
 *
 *   { action: "sign", matchId, pointId }
 *       -> { url, key }   a ten-minute presigned PUT for a fresh key under
 *                         points/<owner>/<match>/, the worker's own layout
 *   { action: "complete", matchId, pointId, key, t0, t1 }
 *       -> { applied }    the object is HEAD-checked for size, then
 *                         claim_point_clip makes it the point's clip in one
 *                         statement — only if the timing is unchanged and
 *                         the worker has not already landed its own re-cut.
 *                         A claim that does not apply deletes the upload;
 *                         one that does deletes the previous re-cut object
 *                         (the function has already netted its bytes out).
 *
 * The owner only: a coach can read points under RLS but never writes a
 * clip, so ownership is checked on the match row, not inferred from a
 * readable point.
 */
const MAX_CLIP_BYTES = 60 * 1024 * 1024;

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
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const matchId = String(body.matchId ?? "");
  const pointId = String(body.pointId ?? "");
  if (!matchId || !pointId) {
    return NextResponse.json({ error: "matchId and pointId are required" }, { status: 400 });
  }

  const { data: match } = await supabase
    .from("matches")
    .select("id, user_id")
    .eq("id", matchId)
    .single();
  if (!match || match.user_id !== user.id) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }
  const { data: point } = await supabase
    .from("points")
    .select("id, idx")
    .eq("id", pointId)
    .eq("match_id", matchId)
    .single();
  if (!point) {
    return NextResponse.json({ error: "Point not found" }, { status: 404 });
  }
  const prefix = `points/${user.id}/${matchId}/`;

  if (action === "sign") {
    const key = `${prefix}${String(point.idx).padStart(2, "0")}-${randomBytes(4).toString("hex")}.mp4`;
    const url = await presignPut(MEDIA_BUCKET, key, 600);
    return NextResponse.json({ url, key });
  }

  if (action === "complete") {
    const key = String(body.key ?? "");
    const t0 = Number(body.t0);
    const t1 = Number(body.t1);
    if (
      !key.startsWith(prefix) ||
      !/^[A-Za-z0-9/._-]+\.mp4$/.test(key) ||
      !Number.isFinite(t0) ||
      !Number.isFinite(t1)
    ) {
      return NextResponse.json({ error: "Invalid clip" }, { status: 400 });
    }
    const bytes = await headObject(MEDIA_BUCKET, key);
    if (bytes === null || bytes <= 0 || bytes > MAX_CLIP_BYTES) {
      if (bytes !== null) {
        await deleteObjects(MEDIA_BUCKET, [key]).catch(() => undefined);
      }
      return NextResponse.json({ error: "Clip not uploaded" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("claim_point_clip", {
      p_point_id: pointId,
      p_key: `r2://${MEDIA_BUCKET}/${key}`,
      p_bytes: bytes,
      p_t0: t0,
      p_t1: t1,
    });
    if (error) {
      await deleteObjects(MEDIA_BUCKET, [key]).catch(() => undefined);
      return NextResponse.json({ error: "Couldn't save the clip" }, { status: 500 });
    }
    const result = data as { applied?: boolean; previous?: string | null } | null;
    if (!result?.applied) {
      // The timing changed again, or the worker got there first: this
      // file is not the point's clip and must not linger in the bucket.
      await deleteObjects(MEDIA_BUCKET, [key]).catch(() => undefined);
      return NextResponse.json({ applied: false });
    }
    const previous = result.previous ?? "";
    const marker = `r2://${MEDIA_BUCKET}/`;
    if (previous.startsWith(marker + prefix)) {
      const prevKey = previous.slice(marker.length);
      // Only a re-cut object (NN-xxxxxxxx.mp4); an original NN.mp4 stays.
      if (/\/\d{2}-[0-9a-f]{8}\.mp4$/.test(prevKey)) {
        await deleteObjects(MEDIA_BUCKET, [prevKey]).catch(() => undefined);
      }
    }
    return NextResponse.json({ applied: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
