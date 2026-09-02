"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setWorkspace, useWorkspace } from "@/lib/workspace";
import type { Workspace } from "@/lib/workspaceModel";

/**
 * The Upwork move (156): one account, a playing side and a coaching side.
 * Anyone with coach data — students, an accepted link as a coach, a coach
 * page, or the coach flag — gets "Switch to coach mode"; everyone else
 * gets "Set up coach mode" (157), which marks the account and opens the
 * workspace, so a coach who signed up on the web is not stuck waiting for
 * an invite. Someone already standing in the coaching workspace always
 * gets the way back. Switching to coaching stamps the flag either way,
 * so a fresh device lands on the right side (158).
 *
 * One row, under "Profile type" on the Account page, on both sides. The
 * top-bar pill in AppNav is the other door, for accounts with both sides
 * set up. The page decides the label server-side and passes it in, so the
 * row draws with the page: a card that fills in a beat later read as a
 * glitch once the row had a card of its own.
 */
export function WorkspaceSwitch({
  remembered,
  userId,
  flagged: initialFlagged,
  eligible: initialEligible,
}: {
  remembered: Workspace;
  userId: string;
  /** user_metadata.is_coach, read server-side. */
  flagged: boolean;
  /** The flag, or any coach data: a page, an accepted link, a roster. */
  eligible: boolean;
}) {
  const router = useRouter();
  const workspace = useWorkspace(remembered);
  const [eligible, setEligible] = useState(initialEligible);
  const [flagged, setFlagged] = useState(initialFlagged);
  const [busy, setBusy] = useState(false);

  const coaching = workspace === "coach";
  const label = coaching
    ? "Switch to player mode"
    : eligible
      ? "Switch to coach mode"
      : "Set up coach mode";

  const flip = async () => {
    setBusy(true);
    if (!coaching && !flagged) {
      const supabase = createClient();
      await supabase.auth.updateUser({ data: { is_coach: true } });
      setFlagged(true);
      setEligible(true);
    }
    setWorkspace(userId, coaching ? "player" : "coach");
    router.push(coaching ? "/dashboard" : "/coaching");
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={() => void flip()}
      disabled={busy}
      className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium text-zinc-200 transition-colors hover:bg-surface-2 disabled:opacity-60"
    >
      {label}
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 text-zinc-500"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7 8h10m0 0-3-3m3 3-3 3M17 16H7m0 0 3-3m-3 3 3 3"
        />
      </svg>
    </button>
  );
}
