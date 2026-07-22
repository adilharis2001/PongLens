import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/share/revoke — turn a share link off. Owner only.
 *
 *   { id } -> { ok }
 *
 * Sets revoked_at; resolve_share_link() stops returning the token the
 * moment the timestamp lands, so already-shared URLs go dark immediately
 * (any presigned media URL already handed out expires within its short
 * TTL). RLS pins the update to the caller's own rows.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let id: string;
  try {
    const body = await req.json();
    id = String(body.id ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner", user.id)
    .is("revoked_at", null)
    .select("id");
  if (error) {
    console.error("share revoke error:", error);
    return NextResponse.json(
      { error: "Could not revoke the link. Try again." },
      { status: 500 }
    );
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
