import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("recollect_preferences")
    .select("enabled")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Couldn't load setting" }, { status: 500 });
  }
  return NextResponse.json({ enabled: data?.enabled !== false });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  let enabled: unknown;
  try {
    enabled = (await req.json()).enabled;
  } catch {
    enabled = null;
  }
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "Invalid setting" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("set_recollect_enabled", {
    p_owner_id: user.id,
    p_enabled: enabled,
  });
  if (error) {
    console.error("Couldn't update Recollect setting:", error);
    return NextResponse.json(
      { error: "Couldn't update setting" },
      { status: 500 },
    );
  }
  return NextResponse.json(data);
}
