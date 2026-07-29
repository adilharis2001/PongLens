"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * The page-bottom sign out: a full-width destructive row, where every
 * settings screen puts its exit (and where a future "Delete account"
 * would sit beside it).
 */
export function SignOutRow() {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      className="w-full rounded-2xl border border-edge bg-surface px-5 py-4 text-center text-sm font-medium text-red-400 transition-colors hover:border-red-500/40 hover:bg-red-500/10"
    >
      Sign out
    </button>
  );
}
