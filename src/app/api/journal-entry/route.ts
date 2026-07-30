import { NextResponse } from "next/server";
import { parseOwnedEntryImage } from "@/lib/journal/entryImage";
import { deleteObjects } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let entryId: string;
  try {
    entryId = String((await req.json()).entryId ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!entryId) {
    return NextResponse.json({ error: "Invalid entry" }, { status: 400 });
  }

  const { data: entry, error: readError } = await supabase
    .from("lessons")
    .select("id, image_path")
    .eq("id", entryId)
    .maybeSingle();
  if (readError) {
    console.error("journal-entry read failed:", readError);
    return NextResponse.json(
      { error: "Couldn't delete this entry. Try again." },
      { status: 500 },
    );
  }
  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const { error: deleteError } = await supabase
    .from("lessons")
    .delete()
    .eq("id", entry.id);
  if (deleteError) {
    console.error("journal-entry delete failed:", deleteError);
    return NextResponse.json(
      { error: "Couldn't delete this entry. Try again." },
      { status: 500 },
    );
  }

  const image = parseOwnedEntryImage(String(entry.image_path ?? ""), user.id);
  if (image) {
    try {
      await deleteObjects(image.bucket, [image.key]);
      const { error: ledgerError } = await supabase.rpc(
        "ledger_negate_entry_image",
        { p_key: entry.image_path },
      );
      if (ledgerError) {
        console.error("journal-entry ledger negate failed:", ledgerError);
      }
    } catch (error) {
      // The row is already gone. The worker's two-day orphan sweep is the
      // durable cleanup fallback, so deletion remains successful for users.
      console.error("journal-entry image cleanup failed:", error);
    }
  }

  return NextResponse.json({ ok: true });
}
