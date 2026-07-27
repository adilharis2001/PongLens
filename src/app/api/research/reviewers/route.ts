import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  let email = "";
  let batchId = "";
  try {
    const body = await request.json();
    email = String(body.email ?? "").trim();
    batchId = String(body.batchId ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!email || !email.includes("@") || !batchId) {
    return NextResponse.json(
      { error: "Enter a reviewer email and batch." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("research_assign_batch", {
    p_email: email,
    p_batch_id: batchId,
  });
  if (error) {
    return NextResponse.json(
      { error: error.message || "Could not assign reviewer" },
      { status: 400 },
    );
  }
  return NextResponse.json({ assigned: Number(data ?? 0) });
}
