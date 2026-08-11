import { NextResponse } from "next/server";

import { mapRpcError } from "@/lib/reviews/rpcError";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/process — spend minutes to process an uploaded video (096).
 *
 * Body: { matchId, trimStartS?, trimEndS?, points?, placement?,
 *         strictness?, orderId? }
 *
 * Everything that matters happens inside claim_processing: ownership,
 * state, the trim window, the whole-minute charge, funding (personal
 * balance or an active review order), and the job insert — one atomic
 * claim, so two taps cannot double-spend. This route is a thin door.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ code: "not_signed_in" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "invalid_input" }, { status: 400 });
  }
  const matchId = typeof body.matchId === "string" ? body.matchId : "";
  if (!matchId) {
    return NextResponse.json({ code: "invalid_input" }, { status: 400 });
  }
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const { data, error } = await supabase.rpc("claim_processing", {
    p_match_id: matchId,
    p_trim_start_s: num(body.trimStartS),
    p_trim_end_s: num(body.trimEndS),
    p_points: body.points !== false,
    p_placement: body.placement === true,
    p_strictness:
      body.strictness === "tight" || body.strictness === "loose"
        ? body.strictness
        : "normal",
    p_order_id: typeof body.orderId === "string" ? body.orderId : null,
  });
  if (error) {
    const { code, status } = mapRpcError(error);
    return NextResponse.json({ code }, { status });
  }
  return NextResponse.json(data);
}
