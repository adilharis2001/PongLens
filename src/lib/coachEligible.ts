"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Does this account have a coaching side (158)? True for the coach flag,
 * a marketplace page, an accepted link as a coach, or a roster. Drives
 * the top-bar switch, which only dual accounts see. Cached per session so
 * the bar does not pop the pill in after first paint.
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
      const cached = sessionStorage.getItem(`pl-coach-eligible:${user.id}`);
      if (cached === "1") setState({ eligible: true, userId: user.id });
      else setState({ eligible: false, userId: user.id });
      if (user.user_metadata?.is_coach === true) {
        sessionStorage.setItem(`pl-coach-eligible:${user.id}`, "1");
        if (alive) setState({ eligible: true, userId: user.id });
        return;
      }
      const [profile, asCoach, roster] = await Promise.all([
        supabase.from("coach_profiles").select("user_id").eq("user_id", user.id).maybeSingle(),
        supabase
          .from("coach_links")
          .select("id")
          .eq("coach_id", user.id)
          .eq("status", "accepted")
          .limit(1)
          .maybeSingle(),
        supabase.from("coach_students").select("id").eq("coach_id", user.id).limit(1).maybeSingle(),
      ]);
      const eligible = Boolean(profile.data || asCoach.data || roster.data);
      sessionStorage.setItem(`pl-coach-eligible:${user.id}`, eligible ? "1" : "0");
      if (alive) setState({ eligible, userId: user.id });
    })();
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
