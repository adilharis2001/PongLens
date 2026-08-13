import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasMarketingAccess } from "./marketingDashboardModel";

/**
 * Every marketing page runs this first. The middleware has already required
 * a session; this decides whether the visitor may see the space at all.
 *
 * Denial is `notFound()` rather than a redirect, so the page never confirms
 * it exists to someone who cannot open it. A failed RPC returns null data,
 * which reads as false, so the gate fails closed. The RPCs behind every
 * table these pages touch re-check the same two roles, which is where the
 * real boundary lives.
 */
export async function requireMarketing(next: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);

  const [adminResult, marketingResult] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase.rpc("is_marketing"),
  ]);

  const isAdmin = adminResult.data === true;
  if (!hasMarketingAccess(isAdmin, marketingResult.data === true)) {
    notFound();
  }

  return { supabase, user, isAdmin };
}
