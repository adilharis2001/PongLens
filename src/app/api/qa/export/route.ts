import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  KIND_LABEL,
  SEVERITY_LABEL,
  SEVERITY_RANK,
  STATUS_META,
  type Bug,
} from "@/lib/qa/bugs";
import {
  csvAttachment,
  csvDocument,
  csvList,
  csvNumberedList,
} from "@/lib/qa/csv";
import { AREA_TITLE, testCases } from "@/lib/qa/testLibrary";

export const runtime = "nodejs";

/**
 * GET /api/qa/export?what=library|bugs|template
 *
 * Three files, all CSV, because Sheets and Excel both open it and it costs
 * no dependency.
 *
 *  library  — the test cases. This is the one that matters day to day: run
 *             tracking lives in the tester's own sheet, and this is the
 *             file that sheet is built from. Two empty columns are left at
 *             the end for their result and notes.
 *  bugs     — everything currently in the queue, worst first.
 *  template — the shape a bug import expects, with worked examples. The
 *             import itself is not built yet, so this is here to settle the
 *             columns before anyone starts filling one in.
 */

function libraryCsv() {
  return csvDocument(
    [
      "case_id",
      "area",
      "depth",
      "title",
      "why",
      "needs",
      "steps",
      "expected",
      "devices",
      "blocked",
      // Left empty on purpose. This is where a run gets recorded, in the
      // tester's own copy, which is why the file exists at all.
      "result",
      "notes",
    ],
    testCases.map((c) => [
      c.id,
      AREA_TITLE[c.area],
      c.depth,
      c.title,
      c.why,
      csvList(c.needs),
      csvNumberedList(c.steps),
      csvList(c.expected),
      c.devices.join(", "),
      c.blocked ?? "",
      "",
      "",
    ]),
  );
}

function bugsCsv(bugs: Bug[]) {
  const sorted = [...bugs].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return b.created_at.localeCompare(a.created_at);
  });

  return csvDocument(
    [
      // id first so a future import can tell an edit from a new row.
      "id",
      "title",
      "status",
      "severity",
      "kind",
      "area",
      "steps",
      "expected",
      "actual",
      "case_id",
      "match_id",
      "video_seconds",
      "url",
      "device",
      "browser",
      "viewport",
      "build_sha",
      "resolution",
      "created_at",
      "updated_at",
    ],
    sorted.map((b) => [
      b.id,
      b.title,
      STATUS_META[b.status].label,
      SEVERITY_LABEL[b.severity],
      KIND_LABEL[b.kind],
      AREA_TITLE[b.area as never] ?? "Other",
      b.steps,
      b.expected,
      b.actual,
      b.case_id,
      b.match_id ?? "",
      b.video_seconds ?? "",
      b.url,
      b.device,
      b.browser,
      b.viewport,
      b.build_sha ?? "",
      b.resolution,
      b.created_at,
      b.updated_at,
    ]),
  );
}

function templateCsv() {
  return csvDocument(
    [
      "id",
      "title",
      "severity",
      "kind",
      "area",
      "steps",
      "expected",
      "actual",
      "case_id",
      "match_id",
      "video_seconds",
      "device",
      "url",
    ],
    [
      [
        "",
        "Clip player restarts when you drag the scrubber",
        "major",
        "functional",
        "match",
        "1. Open a processed match\n2. Tap point 4\n3. Drag the scrubber past halfway",
        "Playback continues from where you dropped it",
        "The clip jumps back to the start",
        "match-seek",
        "f070a568-8404-412e-8e38-2d14889feafe",
        "132",
        "iPhone 14, iOS 17.5",
        "/match/f070a568-8404-412e-8e38-2d14889feafe",
      ],
      [
        "",
        "Two rallies ended up in one clip",
        "major",
        "accuracy",
        "processing",
        "1. Open the match\n2. Play point 11",
        "One rally per clip",
        "Points 11 and 12 are both inside clip 11",
        "processing-point-boundaries",
        "https://www.ponglens.com/match/f070a568-8404-412e-8e38-2d14889feafe",
        "48",
        "Mac, Chrome",
        "/match/f070a568-8404-412e-8e38-2d14889feafe",
      ],
    ],
  );
}

export async function GET(req: Request) {
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

  const what = new URL(req.url).searchParams.get("what") ?? "library";

  let body: string;
  let name: string;
  if (what === "bugs") {
    // Read under RLS, so this can never export more than the caller could
    // already see in the table.
    const { data, error } = await supabase
      .from("qa_bugs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) {
      console.error("qa/export bugs failed:", error);
      return NextResponse.json({ error: "Unavailable" }, { status: 500 });
    }
    body = bugsCsv((data ?? []) as Bug[]);
    name = "ponglens-bugs.csv";
  } else if (what === "template") {
    body = templateCsv();
    name = "ponglens-bug-template.csv";
  } else {
    body = libraryCsv();
    name = "ponglens-test-library.csv";
  }

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": csvAttachment(name),
      "Cache-Control": "no-store",
    },
  });
}
