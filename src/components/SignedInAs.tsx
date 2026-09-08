"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The line an invite page owes the person about to accept: which account
 * is doing it, and a way out if it is the wrong one.
 *
 * On 2026-09-07 a coach's invite was accepted by a throwaway account,
 * because the phone's browser was signed into it while the app on the
 * same phone was signed into the real one, and the page never said whose
 * account it had. Signing out here is this browser only, so the app and
 * every other device keep their sessions; the page then comes straight
 * back to this invite once the right account signs in.
 */
export function SignedInAs({ email, next }: { email: string; next: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const switchAccount = async () => {
    if (busy) return;
    setBusy(true);
    await createClient().auth.signOut({ scope: "local" });
    router.push(`/login?next=${encodeURIComponent(next)}`);
    router.refresh();
  };

  return (
    <p className="mt-4 text-sm text-zinc-400">
      Signed in as <span className="text-zinc-200">{email}</span>.{" "}
      <button
        type="button"
        onClick={() => void switchAccount()}
        disabled={busy}
        className="text-cyan-glow underline underline-offset-2 disabled:opacity-60"
      >
        Not you? Switch account
      </button>
    </p>
  );
}
