import { NextResponse } from "next/server";
import { researchExportFilename } from "@/lib/research/export";
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

  let batchId = "";
  try {
    batchId = String((await request.json()).batchId ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!batchId) {
    return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("research_export_batch", {
    p_batch_id: batchId,
  });
  if (error || !data) {
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${researchExportFilename(data)}"`,
      "Cache-Control": "no-store",
    },
  });
}
