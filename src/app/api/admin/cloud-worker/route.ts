import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/admin/cloud-worker — { mode: "disabled" | "automatic" | "manual" }.
 *
 * The switch on /admin/processing. set_cloud_worker_mode re-checks
 * is_admin() itself and returns the dispatcher's fresh decision, so the
 * page can say in words what the new setting means right now.
 */

const MODES = new Set(["disabled", "automatic", "manual"]);

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ code: "not_signed_in" }, { status: 401 });
  }

  let body: { mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "invalid_json" }, { status: 400 });
  }
  const mode = typeof body.mode === "string" ? body.mode : "";
  if (!MODES.has(mode)) {
    return NextResponse.json({ code: "invalid_mode" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("set_cloud_worker_mode", {
    p_mode: mode,
  });
  if (error) {
    return NextResponse.json(
      { code: error.message || "cloud_mode_rejected" },
      { status: error.code === "42501" ? 403 : 409 },
    );
  }
  return NextResponse.json({ ok: true, decision: data });
}
