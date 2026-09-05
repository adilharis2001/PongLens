import { NextResponse } from "next/server";
import { allowanceInput } from "@/lib/commerce/allowances";
import { sendPendingAllowanceEmails } from "@/lib/email/allowanceEmails";
import { createClient } from "@/lib/supabase/server";
import { mapRpcError } from "@/lib/reviews/rpcError";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "not_signed_in" }, { status: 401 });
  const input = allowanceInput(await req.json().catch(() => null));
  if (!input) return NextResponse.json({ code: "invalid_input" }, { status: 400 });
  const { data: id, error } = await supabase.rpc("request_allowance", {
    p_resource: input.resource, p_message: input.message,
  });
  if (error) {
    const { code, status } = mapRpcError(error);
    return NextResponse.json({ code }, { status });
  }
  try { await sendPendingAllowanceEmails(id); }
  catch (error) { console.error("Allowance email queued for retry:", error); }
  return NextResponse.json({ id });
}
