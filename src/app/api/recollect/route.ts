import { NextResponse } from "next/server";
import { parseRecollectAction } from "@/lib/recollect/actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadRecollectView } from "@/lib/recollect/view";

export const runtime = "nodejs";

async function signedInUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await signedInUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  try {
    return NextResponse.json(await loadRecollectView(user.id));
  } catch (error) {
    console.error("Couldn't load Recollect:", error);
    return NextResponse.json(
      { error: "Couldn't load Recollect" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const user = await signedInUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let action;
  try {
    action = parseRecollectAction(await req.json());
  } catch {
    action = null;
  }
  if (!action) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const admin = createAdminClient();
  try {
    if (action.action === "reveal") {
      const { data, error } = await admin.rpc("reveal_recollect_item", {
        p_owner_id: user.id,
        p_item_id: action.itemId,
        p_review_key: action.reviewKey,
        p_now: new Date().toISOString(),
      });
      if (error) throw error;
      return NextResponse.json(data);
    }

    if (action.action === "dismiss") {
      const { data, error } = await admin
        .from("recollect_items")
        .update({ state: "dismissed", updated_at: new Date().toISOString() })
        .eq("id", action.itemId)
        .eq("user_id", user.id)
        .eq("state", "active")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ dismissed: true });
    }

    if (action.action === "add_to_working_on") {
      const { data, error } = await admin.rpc(
        "add_recollect_to_working_on",
        {
          p_owner_id: user.id,
          p_item_id: action.itemId,
        },
      );
      if (error) throw error;
      return NextResponse.json(data);
    }

    const now = new Date().toISOString();
    const { data: current, error: readError } = await admin
      .from("recollect_preferences")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (readError) throw readError;
    const noticeResult = current
      ? await admin
          .from("recollect_preferences")
          .update({ notice_seen_at: now, updated_at: now })
          .eq("user_id", user.id)
      : await admin.from("recollect_preferences").insert({
          user_id: user.id,
          notice_seen_at: now,
        });
    if (noticeResult.error) throw noticeResult.error;
    return NextResponse.json({ noticeSeen: true });
  } catch (error) {
    console.error("Couldn't update Recollect:", error);
    return NextResponse.json(
      { error: "Couldn't update Recollect" },
      { status: 500 },
    );
  }
}
