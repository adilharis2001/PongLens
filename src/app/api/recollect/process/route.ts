import { NextResponse } from "next/server";
import { processNextRecollectJob } from "@/lib/recollect/processor";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    return NextResponse.json(await processNextRecollectJob(user.id));
  } catch (error) {
    console.error("Recollect processor unavailable:", error);
    return NextResponse.json(
      { error: "Recollect is temporarily unavailable" },
      { status: 503 },
    );
  }
}
