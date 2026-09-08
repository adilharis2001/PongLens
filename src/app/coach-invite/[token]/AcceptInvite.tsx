"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setWorkspace } from "@/lib/workspace";

/**
 * The button that accepts a coach invite. It used to run on arrival, on
 * the reasoning that opening the link was the choice; on 2026-09-07 that
 * accepted an invite into whichever account the phone's browser happened
 * to hold, before the visitor could have read whose account it was. The
 * page now names the account above this button (SignedInAs), and the
 * accept waits for the tap, the same shape as the student's join page.
 *
 * On success we drop them straight onto the shared match, or onto the
 * student's page when the invite covers more than one.
 *
 * The coaching side, never the player's Home. This used to send every
 * non-match invite to /dashboard, which is player territory, so the nav
 * remembered "player" and a coach who has no playing side of their own was
 * left standing in one (Adil, 2026-09-04). The workspace is stamped before
 * navigating: accept_coach_invite sets is_coach on the account, but this
 * session's token predates that, so the flag alone would not carry the
 * first paint, and /coaching is shared ground that renders whichever side
 * the workspace names.
 */
export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: linkId, error: rpcError } = await supabase.rpc(
      "accept_coach_invite",
      { token }
    );
    if (rpcError) {
      setBusy(false);
      setError("Couldn't accept the invite. It may have been used or revoked.");
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
  };

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => void accept()}
        disabled={busy}
        className="glow-cta w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
      >
        {busy ? "Setting up your access…" : "Accept"}
      </button>
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </div>
  );
}
