import { NextResponse } from "next/server";

import { MEDIA_BUCKET, presignGet } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/review-media — short-lived URLs for paid-review artifacts.
 *
 * Shapes:
 *   { findingId, kind: "audio" | "image" }   a finding's voice or drawing
 *   { attachmentId }                          an attachment download
 *   { orderId, pointId }                      a finding-linked point clip,
 *                                             inline. This is how a coach
 *                                             replays cited points after the
 *                                             order completes: the points
 *                                             SELECT policy admits them via
 *                                             point_in_completed_review, no
 *                                             match access needed.
 *
 * Authorization is the row's own RLS: the coach sees their work any time,
 * the student from delivery on. On top of that, paths must sit under a
 * prefix the recording author could legitimately write —
 * review/<coach_id>/ for audio and attachments, sketch/<coach_id>/ for
 * drawings — so a hand-edited path can never sign someone else's object.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function keyIfAllowed(
  path: string | null,
  prefixes: string[],
): string | null {
  if (!path) return null;
  const marker = `r2://${MEDIA_BUCKET}/`;
  if (!path.startsWith(marker)) return null;
  const key = path.slice(marker.length);
  return prefixes.some((p) => key.startsWith(p)) ? key : null;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ code: "not_signed_in" }, { status: 401 });
  }

  let body: {
    findingId?: string;
    attachmentId?: string;
    kind?: string;
    orderId?: string;
    pointId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "invalid_json" }, { status: 400 });
  }

  try {
    if (body.attachmentId) {
      if (!UUID_RE.test(body.attachmentId)) {
        return NextResponse.json({ code: "invalid_id" }, { status: 400 });
      }
      const { data: att } = await supabase
        .from("review_attachments")
        .select("r2_key, filename, order_id")
        .eq("id", body.attachmentId)
        .maybeSingle();
      if (!att) {
        return NextResponse.json({ code: "not_found" }, { status: 404 });
      }
      const coachId = await orderCoachId(supabase, att.order_id);
      const key = keyIfAllowed(att.r2_key, [`review/${coachId}/`]);
      if (!key) {
        return NextResponse.json({ code: "not_found" }, { status: 404 });
      }
      const url = await presignGet(MEDIA_BUCKET, key, {
        expiresSeconds: 600,
        filename: att.filename,
      });
      return NextResponse.json({ url });
    }

    if (body.findingId) {
      if (!UUID_RE.test(body.findingId)) {
        return NextResponse.json({ code: "invalid_id" }, { status: 400 });
      }
      const kind = body.kind === "image" ? "image" : "audio";
      const { data: finding } = await supabase
        .from("review_findings")
        .select("audio_path, image_path, order_id")
        .eq("id", body.findingId)
        .maybeSingle();
      if (!finding) {
        return NextResponse.json({ code: "not_found" }, { status: 404 });
      }
      const coachId = await orderCoachId(supabase, finding.order_id);
      const key =
        kind === "audio"
          ? keyIfAllowed(finding.audio_path, [`review/${coachId}/`])
          : keyIfAllowed(finding.image_path, [`sketch/${coachId}/`]);
      if (!key) {
        return NextResponse.json({ code: "not_found" }, { status: 404 });
      }
      const url = await presignGet(MEDIA_BUCKET, key, {
        expiresSeconds: 600,
      });
      return NextResponse.json({ url });
    }

    if (body.orderId && body.pointId) {
      const pointId = body.pointId;
      if (!UUID_RE.test(body.orderId) || !UUID_RE.test(pointId)) {
        return NextResponse.json({ code: "invalid_id" }, { status: 400 });
      }
      // The point must be cited by a finding of this order (both reads are
      // RLS-scoped to the caller), and the clip path is worker-written.
      const { data: findings } = await supabase
        .from("review_findings")
        .select("id")
        .eq("order_id", body.orderId);
      const ids = (findings ?? []).map((f) => f.id);
      if (ids.length === 0) {
        return NextResponse.json({ code: "not_found" }, { status: 404 });
      }
      const { data: link } = await supabase
        .from("review_finding_points")
        .select("finding_id")
        .eq("point_id", pointId)
        .in("finding_id", ids)
        .limit(1)
        .maybeSingle();
      if (!link) {
        return NextResponse.json({ code: "not_found" }, { status: 404 });
      }
      const { data: point } = await supabase
        .from("points")
        .select("clip_path")
        .eq("id", pointId)
        .maybeSingle();
      const parsed = (point?.clip_path ?? "").match(
        new RegExp(`^r2://${MEDIA_BUCKET}/(.+)$`),
      );
      if (!parsed) {
        return NextResponse.json({ code: "not_found" }, { status: 404 });
      }
      const url = await presignGet(MEDIA_BUCKET, parsed[1], {
        expiresSeconds: 600,
        disposition: "inline",
      });
      return NextResponse.json({ url });
    }

    return NextResponse.json({ code: "invalid_request" }, { status: 400 });
  } catch (e) {
    console.error("review-media error:", e);
    return NextResponse.json({ code: "server_error" }, { status: 500 });
  }
}

async function orderCoachId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
): Promise<string> {
  const { data } = await supabase
    .from("review_orders")
    .select("coach_id")
    .eq("id", orderId)
    .maybeSingle();
  // RLS already admitted the caller to the child row; a missing parent
  // yields an impossible prefix and therefore a 404.
  return data?.coach_id ?? "nobody";
}
