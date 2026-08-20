import { NextResponse } from "next/server";

import { deleteObjects, listObjects, MEDIA_BUCKET, RAW_BUCKET } from "@/lib/r2";
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
  "offer", // offering images
  "points", // point clips, match.json, thumbs, calibration debug
  "qa", // QA attachments
  "results", // the cut video for every match
  "review", // coach review attachments
  "sketch", // annotator sketches
  "voice", // dictated notes
] as const;

/**
 * Orders where money has changed hands and the work is not finished. Deleting
 * an account mid-order would stand a real person up — the student who paid or
 * the coach owed the fee — so it is refused with something the UI can explain
 * rather than silently swallowed.
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
  // a coach with work owed cannot vanish either.
  const { data: liveOrders } = await supabase
    .from("review_orders")
    .select("id, status, coach_id, student_id")
    .or(`student_id.eq.${uid},coach_id.eq.${uid}`)
    .in("status", IN_FLIGHT);

  const blocked = (liveOrders ?? []).length > 0;

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
      blocked,
      blockedOrders: (liveOrders ?? []).length,
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

  if (blocked) {
    return NextResponse.json(
      {
        code: "orders_in_flight",
        error:
          "You have a review still in progress. Finish or cancel it, then delete your account.",
        blockedOrders: (liveOrders ?? []).length,
      },
      { status: 409 }
    );
  }

  const admin = createAdminClient();

  try {
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
