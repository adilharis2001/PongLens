import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Every /testing page runs this first. Same shape as requireMarketing():
 * the middleware has already required a session, and this decides whether
 * the visitor may see the space at all.
 *
 * Denial is notFound() rather than a redirect, so the page never confirms
 * it exists to someone who cannot open it. A failed RPC returns null,
 * which reads as false, so the gate fails closed. The RLS on qa_bugs
 * re-checks the same two roles, which is where the real boundary lives.
 *
 * isAdmin comes back because the two audiences do different jobs here:
 * the tester files and verifies, the owner triages and closes.
 */
export async function requireTesting(next: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);

  const [adminResult, qaResult] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase.rpc("is_qa"),
  ]);

  const isAdmin = adminResult.data === true;
  const isQa = qaResult.data === true;
  if (!isAdmin && !isQa) notFound();

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return { supabase, user, isAdmin, isQa, avatarUrl };
}
