"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Auto-accepts the invite the moment an authenticated coach lands here — the
 * click was pure friction (they already chose to open the link). On success
 * we drop them straight onto the shared match (or the dashboard for an
 * all-matches invite). The server callback handles the sign-in round trip;
 * this covers the already-signed-in visitor.
 */
export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void (async () => {
      const supabase = createClient();
      const { data: linkId, error: rpcError } = await supabase.rpc(
        "accept_coach_invite",
        { token }
      );
      if (rpcError) {
        setError(
          "Couldn't accept the invite. It may have been used or revoked."
        );
        return;
      }
      // Land on the match itself when the invite is scoped to one; the
      // all-matches scope has no single target, so go to the dashboard.
      let dest = "/dashboard";
      const { data: link } = await supabase
        .from("coach_links")
        .select("scope_match_id")
        .eq("id", linkId)
        .maybeSingle();
      if (link?.scope_match_id) dest = `/match/${link.scope_match_id}`;
      router.replace(dest);
      router.refresh();
    })();
  }, [token, router]);

  if (error) {
    return <p className="mt-4 text-sm text-red-400">{error}</p>;
  }

  return (
    <p className="mt-6 flex items-center justify-center gap-2 text-sm text-zinc-400">
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 animate-spin text-cyan-glow"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeOpacity="0.25"
        />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      Setting up your access…
    </p>
  );
}
