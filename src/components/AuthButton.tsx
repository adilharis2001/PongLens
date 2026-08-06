"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * The public header's account button. Public pages render statically, so
 * the server can't know who's looking; this starts as "Sign in" and the
 * browser swaps it once the local session proves otherwise (the same
 * hydrate-then-check pattern as useIsCoach).
 */
export function AuthButton() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    void createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) setSignedIn(true);
      });
  }, []);

  return (
    <Link
      href={signedIn ? "/dashboard" : "/login"}
      className="rounded-full border border-cyan-glow/40 px-4 py-1.5 text-sm font-medium text-cyan-glow transition-colors hover:border-cyan-glow hover:bg-cyan-glow/10"
    >
      {signedIn ? "Open PongLens" : "Sign in"}
    </Link>
  );
}
