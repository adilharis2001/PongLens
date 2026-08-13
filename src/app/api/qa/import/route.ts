import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { planImport } from "@/lib/qa/import";

export const runtime = "nodejs";

/**
 * POST /api/qa/import — a filled-in spreadsheet becomes bug rows.
 *
 * Two calls by design. The first returns a plan and writes nothing; the
 * second, with commit=1, applies it. A bad import is much more annoying
 * to undo than to preview, and the preview is the only place a person
 * finds out that row 7 says severity "catastrophic".
 *
 * Writes go through the caller's own session, so RLS decides what may be
 * created or edited. The route never uses the service role: an importer
 * that could write more than its user is a way around the table's rules.
 */

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const [{ data: isAdmin }, { data: isQa }] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase.rpc("is_qa"),
  ]);
  if (isAdmin !== true && isQa !== true) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Keep the file under 5 MB." },
      { status: 400 },
    );
  }

  const text = await file.text();

  // Which ids this caller may edit. Read under RLS, so an id belonging to
  // a row they cannot see reads as unknown rather than as permission to
  // write it.
  const { data: existing, error: readError } = await supabase
    .from("qa_bugs")
    .select("id")
    .limit(5000);
  if (readError) {
    console.error("qa/import read failed:", readError);
    return NextResponse.json({ error: "Unavailable" }, { status: 500 });
  }
  const knownIds = new Set((existing ?? []).map((r) => r.id as string));

  let plan;
  try {
    plan = planImport(text, knownIds);
  } catch (e) {
    console.error("qa/import parse failed:", e);
    return NextResponse.json(
      { error: "That file could not be read as a spreadsheet." },
      { status: 400 },
    );
  }

  const commit = new URL(req.url).searchParams.get("commit") === "1";
  if (!commit) {
    return NextResponse.json({ plan, committed: false });
  }

  // Nothing is written while any row is wrong. Half an import is the
  // worst outcome: the person cannot tell what landed without checking
  // every row by hand.
  if (plan.errors > 0) {
    return NextResponse.json(
      { plan, committed: false, error: "Fix the rows with errors first." },
      { status: 400 },
    );
  }

  const creates = plan.rows
    .filter((r) => r.action === "create")
    .map((r) => ({
      ...r.values,
      reporter_id: user.id,
      source: "csv" as const,
    }));

  let created = 0;
  if (creates.length) {
    const { error, count } = await supabase
      .from("qa_bugs")
      .insert(creates, { count: "exact" });
    if (error) {
      console.error("qa/import insert failed:", error);
      return NextResponse.json(
        { plan, committed: false, error: "Could not save the new rows." },
        { status: 500 },
      );
    }
    created = count ?? creates.length;
  }

  // Updates one at a time: a failure on one row should not roll back the
  // others, and the count of what actually landed is what gets reported.
  let updated = 0;
  const failed: number[] = [];
  for (const row of plan.rows.filter((r) => r.action === "update")) {
    const { error } = await supabase
      .from("qa_bugs")
      .update(row.values)
      .eq("id", row.id as string);
    if (error) failed.push(row.line);
    else updated += 1;
  }

  return NextResponse.json({
    plan,
    committed: true,
    created,
    updated,
    // Lines RLS refused, e.g. a bug already closed, which the tester may
    // no longer edit. Named rather than folded into a total.
    refused: failed,
  });
}
