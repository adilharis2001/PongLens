import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const PAGES = ["body-detector", "v3-serve-detector", "endon-detector"];
const CALLS = ["fine", "wrong", "unsure"];

/**
 * POST /api/research/row-verdict — Adil's call on one ROW of a research
 * card page: is the flag on this row my mistake or the reference's?
 *
 *   { page, matchId, rowS, verdict, note? }     fine | wrong | unsure
 *   { page, matchId, rowS, verdict: null }      clears it
 *
 * Keyed by the row's reference time (production's card start, or my card's
 * start where production has none), never by a card number, for the reason
 * given on v3_card_verdicts: a rule that removes one card renumbers every
 * card after it.
 *
 * The table is admin-only at the RLS level, so this route does not repeat
 * the check — a non-admin write fails in Postgres.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let page: string;
  let matchId: string;
  let rowS: number;
  let verdict: string | null;
  let note: string | null;
  try {
    const body = await req.json();
    page = String(body.page ?? "");
    matchId = String(body.matchId ?? "");
    rowS = Math.round(Number(body.rowS) * 10) / 10;
    verdict = body.verdict == null ? null : String(body.verdict);
    note = body.note == null ? null : String(body.note).slice(0, 2000);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!PAGES.includes(page)) return NextResponse.json({ error: "Unknown page" }, { status: 400 });
  if (!matchId || !Number.isFinite(rowS)) {
    return NextResponse.json({ error: "Missing matchId or rowS" }, { status: 400 });
  }
  if (verdict !== null && !CALLS.includes(verdict)) {
    return NextResponse.json({ error: "Unknown verdict" }, { status: 400 });
  }

  const { error } =
    verdict === null
      ? await supabase
          .from("research_row_verdicts")
          .delete()
          .eq("page", page)
          .eq("match_id", matchId)
          .eq("row_s", rowS)
      : await supabase.from("research_row_verdicts").upsert(
          {
            page,
            match_id: matchId,
            row_s: rowS,
            verdict,
            note: note && note.trim() ? note.trim() : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "page,match_id,row_s" },
        );

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
