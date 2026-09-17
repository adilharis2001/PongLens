"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * The public header's account button. Public pages render statically, so
 * the server can't know who's looking; this starts as "Sign in" and the
 * browser swaps it once a local session proves otherwise.
 *
 * The proof is the presence of the Supabase auth cookie, read straight off
 * document.cookie. It used to ask the Supabase client for the session,
 * which meant every visitor to the landing page downloaded the whole auth
 * library to relabel one link. The cookie is set by the same library on
 * sign-in and cleared on sign-out, so its presence is the same answer at a
 * fraction of the cost. If it ever misreads, the only consequence is the
 * label: /login sends a signed-in person on to the app anyway.
 */
function hasSessionCookie(): boolean {
  try {
    return /(?:^|;\s*)sb-[a-z0-9]+-auth-token(?:\.\d+)?=/.test(document.cookie);
  } catch {
    return false;
  }
}

export function AuthButton() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (hasSessionCookie()) setSignedIn(true);
  }, []);

  return (
    <Link
      href={signedIn ? "/dashboard" : "/login"}
      className="whitespace-nowrap rounded-full border border-cyan-glow/40 px-3 py-1.5 text-sm font-medium text-cyan-glow transition-colors hover:border-cyan-glow hover:bg-cyan-glow/10 sm:px-4"
    >
      {signedIn ? (
        // The full name won't share a phone-width row with the logo and the
        // audience link without crowding all three, so below sm it yields.
        <>
          <span className="sm:hidden">Open app</span>
          <span className="hidden sm:inline">Open PongLens</span>
        </>
      ) : (
        "Sign in"
      )}
    </Link>
  );
}
