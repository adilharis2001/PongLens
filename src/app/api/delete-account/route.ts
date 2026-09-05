import { NextResponse } from "next/server";

import { sendReviewEmail } from "@/lib/email/reviewEmails";
import {
  refundOrder,
  releasePayoutForOrder,
} from "@/lib/payments/orderMoney";
import { abortMultipartUpload, deleteObjects, listObjects, MEDIA_BUCKET, RAW_BUCKET } from "@/lib/r2";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/delete-account — close an account and remove what it stored.
 *
 * Actions:
 *   preview  -> { matches, entries, orders, blocked }   what would go
 *   delete   -> { ok }                                  it goes
 *
 * Apple requires this to exist inside the app (5.1.1(v)), but the reason to
 * get it right is that it is the one request you cannot apologise your way
 * out of afterwards.
 *
 * Order matters. R2 first, the auth user last: deleting the user cascades
 * every row that names it (the schema is thorough about this — matches,
 * notes, lessons, ledgers, coach profile, orders, the lot), and once those
 * rows are gone nothing remembers which objects belonged to them. A failure
 * halfway through R2 therefore leaves an account that still works and can
 * be deleted again, which is the safe direction to fail in.
 *
 * Everything the product writes is keyed by the owner's id under a fixed set
 * of prefixes, so the sweep is prefix-driven rather than a walk over rows.
 * The one exception is a rendered reel, which is keyed by match, so those
 * are collected per match id before the rows disappear.
 *
 * A very large library can outrun the 60s ceiling. That is survivable rather
 * than handled: every step is idempotent — a re-list returns only what is
 * still there, a DELETE on a missing key is fine — so a second attempt picks
 * up where the first stopped, and the account stays usable until the sweep
 * finishes and the auth user finally goes.
 */

/** Every media prefix the product writes under, each holding `<prefix>/<uid>/`. */
const USER_PREFIXES = [
  "avatar", // coach page photo
  "entry", // journal entry images
  "feedback", // feedback screenshots
  "lesson-video", // retained lesson originals and attempt-scoped recaps
  "offer", // offering images
  "points", // point clips, match.json, thumbs, calibration debug
  "qa", // QA attachments
  "results", // the cut video for every match
  "review", // coach review attachments
  "sketch", // annotator sketches
  "voice", // dictated notes
] as const;

/**
 * Orders where money has changed hands and the work is not finished. These
 * used to BLOCK deletion, telling the user to finish or cancel first — but
 * the iOS app has no paid-coaching surface to finish or cancel from, and
 * Apple requires in-app deletion to actually delete (5.1.1(v)). So the
 * route settles them itself instead, before anything is removed:
 *
 *   - a DELIVERED order the deleting user bought completes: the coach did
 *     the work and gets paid, exactly as the 7-day sweep would have done;
 *   - everything else cancels and refunds, whichever side is leaving. A
 *     coach's cancel-on-delivered mirrors coach_cancel_review_order, which
 *     already allows it.
 *
 * Money settles BEFORE the R2 sweep and the auth delete, and a failed
 * refund aborts the whole request: the coach_id cascade destroys order
 * rows, and a refund that has lost its payment refs can never be made
 * right afterwards. Failing with the account intact is the direction that
 * can be retried.
 */
const IN_FLIGHT = [
  "awaiting_submission",
  "submitted",
  "in_review",
  "clarification",
  "delivered",
];

async function deletePrefix(bucket: string, prefix: string): Promise<number> {
  const objects = await listObjects(bucket, prefix);
  if (objects.length === 0) return 0;
  // Individual DELETEs, eight at a time, and a missing key is not an error —
  // which is what makes a second run after a timeout harmless.
  await deleteObjects(
    bucket,
    objects.map((o) => o.key)
  );
  return objects.length;
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

  const uid = user.id;

  // What is in flight, read as the caller so RLS still applies. Both sides:
  // a coach leaving with work owed settles those orders too.
  const { data: liveOrders } = await supabase
    .from("review_orders")
    .select("id, status, coach_id, student_id, funding")
    .or(`student_id.eq.${uid},coach_id.eq.${uid}`)
    .in("status", IN_FLIGHT);

  const orders = liveOrders ?? [];
  const completions = orders.filter(
    (o) => o.student_id === uid && o.status === "delivered",
  );
  const refunds = orders.filter((o) => !completions.includes(o));

  const { data: matchRows } = await supabase
    .from("matches")
    .select("id")
    .eq("user_id", uid);
  const matchIds = (matchRows ?? []).map((m) => m.id as string);

  if (action === "preview") {
    const { count: entryCount } = await supabase
      .from("lessons")
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid);
    return NextResponse.json({
      matches: matchIds.length,
      entries: entryCount ?? 0,
      // Nothing blocks any more; the fields stay so an older client that
      // still reads them sees an account it is allowed to delete.
      blocked: false,
      blockedOrders: 0,
      // What settling will do, so the dialog can say it in numbers.
      completions: completions.length,
      refunds: refunds.length,
    });
  }

  // The word is typed into the field, not a checkbox: this is the last point
  // at which a misdirected tap can be caught.
  if (String(body.confirm ?? "") !== "DELETE") {
    return NextResponse.json(
      { code: "confirm_required", error: "Type DELETE to confirm." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Settle every in-flight order before touching anything else. Any refund
  // that does not land aborts the request with the account fully intact.
  for (const order of completions) {
    // The student is leaving with a delivered review: complete it, which
    // pays the coach — the same ending the 7-day sweep gives a quiet
    // order. The RPC runs as the caller and only accepts 'delivered'.
    const { error: completeError } = await supabase.rpc(
      "complete_review_order",
      { p_order_id: order.id }
    );
    if (completeError) {
      // Re-read: a race may have already moved it somewhere terminal,
      // which is fine. Anything still in flight means settling failed.
      const { data: now } = await admin
        .from("review_orders")
        .select("status")
        .eq("id", order.id)
        .maybeSingle();
      if (!now || IN_FLIGHT.includes(now.status)) {
        console.error("delete-account: complete failed:", completeError);
        return NextResponse.json(
          { error: "Could not settle a review order. Try again." },
          { status: 500 }
        );
      }
    }
    // Best-effort: the daily reviews-sweep retries any completed order
    // still missing its payout, and the order row survives this user's
    // deletion (student_id is ON DELETE SET NULL).
    await releasePayoutForOrder(order.id).catch((e) =>
      console.error("delete-account payout:", e)
    );
  }

  for (const order of refunds) {
    const side = order.coach_id === uid ? "coach" : "student";
    // The same write the cancel RPCs make, status-guarded so a racing
    // transition wins cleanly. Admin because the student RPC refuses
    // mid-review cancels — a protection that stops mattering when the
    // student is deleting the account the review would come back to.
    await admin
      .from("review_orders")
      .update({
        status: "cancelled",
        cancel_reason: `${side}: account deleted`,
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .in("status", IN_FLIGHT);

    // Idempotent, and a no-op for sponsored or never-charged orders. This
    // is the step that must not be outlived by the account: a coach's
    // deletion cascades their order rows, and with them the payment refs.
    const refunded = await refundOrder(order.id);
    if (!refunded) {
      console.error(`delete-account: refund failed for order ${order.id}`);
      return NextResponse.json(
        {
          error:
            "Could not refund a review order, so nothing was deleted. Try again, or contact support@ponglens.com.",
        },
        { status: 500 }
      );
    }
    if (order.funding !== "sponsored") {
      await sendReviewEmail("order_refunded", order.id).catch(() => {});
    }
  }

  try {
    // Fence lesson work before storage deletion. The marker survives auth's
    // cascade so an upload already in flight is swept again after it finishes.
    const { data: lessonUploads, error: lessonFenceError } = await admin.rpc(
      "begin_lesson_video_account_deletion", { p_owner: uid },
    );
    if (lessonFenceError) throw lessonFenceError;
    for (const upload of lessonUploads ?? []) {
      await abortMultipartUpload(MEDIA_BUCKET, upload.source_key, upload.upload_id);
    }
    for (const prefix of USER_PREFIXES) {
      await deletePrefix(MEDIA_BUCKET, `${prefix}/${uid}/`);
    }
    // Original uploads live at the bucket root under the owner's id. The raw
    // bucket expires them on a lifecycle rule anyway; a deletion request is
    // not the place to wait for that.
    await deletePrefix(RAW_BUCKET, `${uid}/`);

    // Rendered reels are keyed by match, not by owner. Listing by match id
    // catches every variant — starred, full, and the per-tag scopes.
    for (const matchId of matchIds) {
      await deletePrefix(MEDIA_BUCKET, `reels/${matchId}`);
    }

    // One reference to auth.users is ON DELETE NO ACTION rather than CASCADE:
    // the admin who decided a quota request. It only ever points at an admin,
    // but if it points at this one the delete would fail on a foreign key
    // instead of doing the job.
    await admin
      .from("quota_requests")
      .update({ decided_by: null })
      .eq("decided_by", uid);

    // The cascade does the rest of the database.
    const { error: deleteError } = await admin.auth.admin.deleteUser(uid);
    if (deleteError) {
      console.error("delete-account: auth delete failed:", deleteError);
      return NextResponse.json(
        { error: "Could not delete the account. Try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("delete-account error:", e);
    return NextResponse.json(
      { error: "Could not delete the account. Try again." },
      { status: 500 }
    );
  }
}
