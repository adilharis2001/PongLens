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

/** Holdout frames and nothing else, so a tampered key cannot turn this into
 *  a reader for arbitrary media. */
function isHoldoutKey(key: unknown): key is string {
  return (
    typeof key === "string" &&
    /^research\/table-calibration\/v1\/holdout\/[0-9a-f-]{36}\.jpg$/i.test(key)
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

export async function GET(request: Request) {
  const supabase = await createClient();
  if (!(await allowed(supabase))) {
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }
  const key = new URL(request.url).searchParams.get("key");
  if (!isHoldoutKey(key)) {
    return NextResponse.json({ error: "Bad key" }, { status: 400 });
  }
  try {
    const url = await presignGet(MEDIA_BUCKET, key, {
      expiresSeconds: 3600,
      disposition: "inline",
    });
    return NextResponse.json({ url });
  } catch (error) {
    console.error("holdout frame signing failed", error);
    return NextResponse.json({ error: "Could not load frame" }, { status: 500 });
  }
}

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

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }
  const verdict = body.verdict === null ? null : String(body.verdict ?? "");
  if (verdict !== null && !VERDICTS.has(verdict)) {
    return NextResponse.json({ error: "Bad verdict" }, { status: 400 });
  }
  const notes =
    body.notes === null || body.notes === undefined
      ? null
      : String(body.notes).slice(0, 2000);

  // Ask for the row back. An update that matches nothing returns no error,
  // and answering ok to that is how a night of review disappears.
  const { data, error } = await supabase
    .from("table_calibration_holdout")
    .update({
      verdict,
      notes,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id,verdict,notes,reviewed_at");

  if (error) {
    console.error("holdout save failed", error);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Nothing was saved — the row was not writable" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, saved: data[0] });
}
