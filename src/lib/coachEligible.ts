"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dualRoleEligible } from "@/lib/dualRoleEligibility";

/**
 * Is this account on BOTH sides of the table (158, tightened 2026-09-02)?
 * A coaching side — the coach flag, a marketplace page, an accepted link
 * as a coach, or a roster — AND a playing side that was set up, which is
 * player_profiles.setup_done_at (159). "Both" at onboarding produces this
 * directly; a coach who only switched to playing still has the questions
 * pending, and a plain player has no coaching side, so neither gets the
 * top-bar pill — their door stays in Account. Cached per session so the
 * bar does not pop the pill in after first paint.
 */
export function useCoachEligible(): { eligible: boolean; userId: string | null } {
  const [state, setState] = useState<{ eligible: boolean; userId: string | null }>({
    eligible: false,
    userId: null,
  });
  useEffect(() => {
    let alive = true;
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !alive) return;
      const cached = sessionStorage.getItem(`pl-both-sides:${user.id}`);
      if (cached === "1") setState({ eligible: true, userId: user.id });
      else setState({ eligible: false, userId: user.id });
      const flagged = user.user_metadata?.is_coach === true;
      const [profile, asCoach, roster, player] = await Promise.all([
        flagged
          ? Promise.resolve({ data: null })
          : supabase.from("coach_profiles").select("user_id").eq("user_id", user.id).maybeSingle(),
        flagged
          ? Promise.resolve({ data: null })
          : supabase
              .from("coach_links")
              .select("id")
              .eq("coach_id", user.id)
              .eq("status", "accepted")
              .limit(1)
              .maybeSingle(),
        flagged
          ? Promise.resolve({ data: null })
          : supabase.from("coach_students").select("id").eq("coach_id", user.id).limit(1).maybeSingle(),
        supabase
          .from("player_profiles")
          .select("setup_done_at")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      const eligible = dualRoleEligible({
        coachFlag: flagged,
        coachProfile: Boolean(profile.data),
        acceptedCoachLink: Boolean(asCoach.data),
        coachRoster: Boolean(roster.data),
        playerSetupDoneAt: player.data?.setup_done_at,
      });
      sessionStorage.setItem(`pl-both-sides:${user.id}`, eligible ? "1" : "0");
      if (alive) setState({ eligible, userId: user.id });
    })();
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
