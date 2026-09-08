"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    // This browser only. The library default is "global", which also
    // revokes the account's session on every other device — and a phone
    // whose session dies under it keeps reading the database on its
    // still-valid token for up to an hour while every video, poster and
    // link comes back "not signed in" (a coach's phone, 2026-09-07).
    // Signing out of a laptop must never do that to a phone.
    await supabase.auth.signOut({ scope: "local" });
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
