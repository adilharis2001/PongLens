import { NextResponse } from "next/server";
import { MEDIA_BUCKET, presignGet } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VERDICTS = new Set([
  "correct",
  "loose",
  "wrong_table",
  "no_table",
  "unusable",
]);

/** The frame this page renders, and nothing else. A key that does not match
 *  cannot be signed, so a tampered request cannot turn this route into a
 *  reader for arbitrary media. */
function isFrameKey(key: unknown): key is string {
  return (
    typeof key === "string" &&
    /^research\/table-calibration\/v1\/frames\/[0-9a-f-]{36}\.jpg$/i.test(key)
  );
}

function isQuad(value: unknown): value is [number, number][] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every((n) => typeof n === "number" && Number.isFinite(n)),
    )
  );
}

async function allowed(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const [{ data: isAdmin }, reviewer] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase
      .from("research_reviewers")
      .select("active")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  if (isAdmin !== true && reviewer.data?.active !== true) return null;
  return user;
}

/** Signs the background frame for one match. */
export async function GET(request: Request) {
  const supabase = await createClient();
  if (!(await allowed(supabase))) {
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }
  const key = new URL(request.url).searchParams.get("key");
  if (!isFrameKey(key)) {
    return NextResponse.json({ error: "Bad key" }, { status: 400 });
  }
  try {
    const url = await presignGet(MEDIA_BUCKET, key, {
      expiresSeconds: 3600,
      disposition: "inline",
    });
    return NextResponse.json({ url });
  } catch (error) {
    console.error("table calibration frame signing failed", error);
    return NextResponse.json({ error: "Could not load frame" }, { status: 500 });
  }
}

/** Saves the owner's corrected corners for one match. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await allowed(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const matchId = String(body.matchId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(matchId)) {
    return NextResponse.json({ error: "Bad matchId" }, { status: 400 });
  }

  const verdict = body.verdict === null ? null : String(body.verdict ?? "");
  if (verdict !== null && !VERDICTS.has(verdict)) {
    return NextResponse.json({ error: "Bad verdict" }, { status: 400 });
  }

  // Corners are optional: "wrong_table" with no corrected quad is a complete,
  // useful answer, and forcing four points would put invented numbers in the
  // one column that is supposed to be trustworthy.
  const corners = body.correctedCorners;
  if (corners !== null && corners !== undefined && !isQuad(corners)) {
    return NextResponse.json({ error: "Bad corners" }, { status: 400 });
  }

  const notes =
    body.notes === null || body.notes === undefined
      ? null
      : String(body.notes).slice(0, 2000);

  // .select() matters here. An update that matches no row -- because RLS
  // hid it, or the session expired, or the id is wrong -- returns no error,
  // and answering {ok:true} to that is how a reviewer loses an afternoon of
  // work without ever seeing a failure. Ask for the row back and insist on
  // getting it.
  const { data, error } = await supabase
    .from("table_calibration_review")
    .update({
      corrected_corners: corners ?? null,
      verdict,
      notes,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("match_id", matchId)
    .select("match_id,corrected_corners,verdict,notes,reviewed_at");

  if (error) {
    console.error("table calibration save failed", error);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
  if (!data || data.length === 0) {
    console.error("table calibration save changed no row", { matchId });
    return NextResponse.json(
      { error: "Nothing was saved — the row was not writable" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, saved: data[0] });
}
