"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setWorkspace } from "@/lib/workspace";

/**
 * Auto-accepts the invite the moment an authenticated coach lands here — the
 * click was pure friction (they already chose to open the link). On success
 * we drop them straight onto the shared match, or onto the coaching home
 * when the invite covers more than one. The server callback handles the
 * sign-in round trip; this covers the already-signed-in visitor.
 *
 * The coaching side, never the player's Home. This used to send every
 * non-match invite to /dashboard, which is player territory, so the nav
 * remembered "player" and a coach who has no playing side of their own was
 * left standing in one (Adil, 2026-09-04). The workspace is stamped before
 * navigating for the same reason the server path stamps it: accept_coach_
 * invite sets is_coach on the account, but this session's token predates
 * that, so the flag alone would not carry the first paint — and /coaching
 * is shared ground that renders whichever side the workspace names.
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
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) setWorkspace(user.id, "coach");
      // Land on the match itself when the invite is scoped to one;
      // otherwise on the student, not the coaching home (Adil,
      // 2026-09-04). Their page already holds the matches, anything they
      // have shared from their journal, and room to write.
      let dest = "/coaching";
      const { data: link } = await supabase
        .from("coach_links")
        .select("scope_match_id, player_id")
        .eq("id", linkId)
        .maybeSingle();
      if (link?.scope_match_id) {
        dest = `/match/${link.scope_match_id}`;
      } else if (link?.player_id) {
        // Written by coach_links_roster_sync inside the accept, so it is
        // already there. A miss just leaves the coaching home.
        const { data: roster } = await supabase
          .from("coach_students")
          .select("id")
          .eq("player_id", link.player_id)
          .is("archived_at", null)
          .maybeSingle();
        const rosterId = (roster as { id: string } | null)?.id;
        if (rosterId) dest = `/coaching/students/${rosterId}`;
      }
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
