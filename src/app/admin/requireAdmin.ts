import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupportEmail } from "@/lib/config";

/**
 * Every admin page runs this first. The email check matches is_admin()
 * server-side: each RPC these pages call re-checks it, so the redirect is
 * UX, not the security boundary.
 */
export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const adminEmail = await getSupportEmail();
  if (user.email !== adminEmail) redirect("/dashboard");

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;
  return { supabase, user, avatarUrl };
}
