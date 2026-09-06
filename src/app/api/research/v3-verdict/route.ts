import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/research/v3-verdict — record a call on one V3 card.
 *
 *   { matchId, serveS, verdict }         genuine | false | unsure
 *   { matchId, serveS, verdict: null }   clears it
 *
 * Keyed by the serve's TIME, never by a card number: a rule that removes
 * one card renumbers every card after it, and a verdict file keyed by
 * index silently re-pointed ten calls at the wrong cards once already.
 *
 * The table is admin-only at the RLS level (172), so this route does not
 * repeat the check — a non-admin write fails in Postgres.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let matchId: string;
  let serveS: number;
  let verdict: string | null;
  try {
    const body = await req.json();
    matchId = String(body.matchId ?? "");
    serveS = Math.round(Number(body.serveS) * 10) / 10;
    verdict = body.verdict == null ? null : String(body.verdict);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!matchId || !Number.isFinite(serveS)) {
    return NextResponse.json({ error: "Missing matchId or serveS" }, { status: 400 });
  }
  if (verdict !== null && !["genuine", "false", "unsure"].includes(verdict)) {
    return NextResponse.json({ error: "Unknown verdict" }, { status: 400 });
  }

  const { error } =
    verdict === null
      ? await supabase
          .from("v3_card_verdicts")
          .delete()
          .eq("match_id", matchId)
          .eq("serve_s", serveS)
      : await supabase.from("v3_card_verdicts").upsert(
          {
            match_id: matchId,
            serve_s: serveS,
            verdict,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "match_id,serve_s" },
        );

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
