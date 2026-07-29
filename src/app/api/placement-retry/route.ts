import { NextResponse } from "next/server";
import { placementRetryError } from "@/lib/placement/placementRetry";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ code: "not_authenticated" }, { status: 401 });
  }

  let matchId: string;
  try {
    const body = await req.json();
    matchId = String(body.matchId ?? "");
  } catch {
    return NextResponse.json({ code: "invalid_json" }, { status: 400 });
  }
  if (!UUID_RE.test(matchId)) {
    return NextResponse.json({ code: "invalid_match_id" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("request_placement_retry", {
    p_match_id: matchId,
  });
  if (error) {
    const stable = placementRetryError(error);
    return NextResponse.json({ code: stable.code }, { status: stable.status });
  }
  if (data === null) {
    return NextResponse.json({ code: "source_expired" }, { status: 410 });
  }

  return NextResponse.json(
    { status: "queued", jobId: data as string },
    { status: 202 },
  );
}
