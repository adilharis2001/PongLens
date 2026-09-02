"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setWorkspace, useWorkspace } from "@/lib/workspace";

/**
 * The Upwork move (156): one account, a playing side and a coaching side.
 * Offered to anyone with coach data — students of their own, an accepted
 * link as a coach, a coach page, or the onboarding answer in metadata —
 * and to anyone already standing in the coaching workspace, so the way
 * back never disappears.
 */
export function WorkspaceSwitch() {
  const router = useRouter();
  const workspace = useWorkspace();
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      if (user.user_metadata?.is_coach === true) {
        if (alive) setEligible(true);
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

  if (!eligible && workspace !== "coach") return null;

  const coaching = workspace === "coach";
  const flip = () => {
    setWorkspace(coaching ? "player" : "coach");
    router.push(coaching ? "/dashboard" : "/coaching");
  };

  return (
    <button
      type="button"
      onClick={flip}
      className="flex w-full items-center justify-between px-4 py-3.5 text-left text-sm font-medium text-zinc-100 transition-colors hover:bg-surface-2"
    >
      {coaching ? "Switch to playing" : "Switch to coaching"}
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
