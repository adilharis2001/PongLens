import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Aggregate worker/queue health only; the RPC never returns lesson content. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "not_signed_in" }, { status: 401 });
  const { data, error } = await supabase.rpc("admin_lesson_video_health");
  if (error) return NextResponse.json({ code: "not_allowed" }, { status: 403 });
  return NextResponse.json(data?.[0] ?? null);
}
