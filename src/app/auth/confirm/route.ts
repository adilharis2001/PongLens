import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { completeSignIn } from "@/lib/auth/completeSignIn";
import { safeNextPath } from "@/lib/auth/paths";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash && type === "email") {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return completeSignIn(request, next, supabase);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=email-link`);
}
