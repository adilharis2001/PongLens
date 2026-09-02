"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setWorkspace, useWorkspace } from "@/lib/workspace";
import type { Workspace } from "@/lib/workspaceModel";

/**
 * The Upwork move (156): one account, a playing side and a coaching side.
 * Anyone with coach data — students, an accepted link as a coach, a coach
 * page, or the coach flag — gets "Switch to coaching"; everyone else gets
 * "Set up coaching" (157), which marks the account and opens the
 * workspace, so a coach who signed up on the web is not stuck waiting for
 * an invite. Someone already standing in the coaching workspace always
 * gets the way back. Switching to coaching stamps the flag either way,
 * so a fresh device lands on the right side (158).
 *
 * Two dresses: the Account row, and a pill for the coaching page header.
 */
export function WorkspaceSwitch({
  remembered,
  variant = "row",
}: {
  remembered: Workspace;
  variant?: "row" | "pill";
}) {
  const router = useRouter();
  const workspace = useWorkspace(remembered);
  const [userId, setUserId] = useState<string | null>(null);
  const [eligible, setEligible] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !alive) return;
      setUserId(user.id);
      if (user.user_metadata?.is_coach === true) {
        setFlagged(true);
        setEligible(true);
        return;
      }
      const [profile, asCoach, roster] = await Promise.all([
        supabase
          .from("coach_profiles")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("coach_links")
          .select("id")
          .eq("coach_id", user.id)
          .eq("status", "accepted")
          .limit(1)
          .maybeSingle(),
        supabase
          .from("coach_students")
          .select("id")
          .eq("coach_id", user.id)
          .limit(1)
          .maybeSingle(),
      ]);
      if (alive) {
        setEligible(Boolean(profile.data || asCoach.data || roster.data));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!userId) return null;

  const coaching = workspace === "coach";
  const label = coaching
    ? "Switch to playing"
    : eligible
      ? "Switch to coaching"
      : "Set up coaching";

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

  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={() => void flip()}
        disabled={busy}
        className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-60"
      >
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void flip()}
      disabled={busy}
      className="flex w-full items-center justify-between px-4 py-3.5 text-left text-sm font-medium text-zinc-100 transition-colors hover:bg-surface-2 disabled:opacity-60"
    >
      {label}
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 text-zinc-600"
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
