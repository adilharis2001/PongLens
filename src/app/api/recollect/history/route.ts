import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  RECOLLECT_HISTORY_PAGE,
  loadRecollectHistory,
} from "@/lib/recollect/view";

export const runtime = "nodejs";

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  try {
    return NextResponse.json(
      await loadRecollectHistory(user.id, {
        limit: RECOLLECT_HISTORY_PAGE,
        offset: positiveInt(params.get("offset"), 0),
      }),
    );
  } catch (error) {
    console.error("Couldn't load Recollect history:", error);
    return NextResponse.json(
      { error: "Couldn't load Recollect history" },
      { status: 500 },
    );
  }
}
