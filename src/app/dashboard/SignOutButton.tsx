"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
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
      className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
    >
      Sign out
    </button>
  );
}
