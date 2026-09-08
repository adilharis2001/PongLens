import "server-only";

import type { AuthUser as User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { dualRoleEligible } from "@/lib/dualRoleEligibility";
import { createClient } from "@/lib/supabase/server";
import { rememberedWorkspace } from "@/lib/workspaceServer";
import { resolveLearnAudience } from "./audience";
import type { LearnAudience } from "./catalogTypes";

export interface LearnServerContext {
  user: User;
  avatarUrl: string | null;
  activeWorkspace: LearnAudience;
  audience: LearnAudience;
  canSwitch: boolean;
}

export async function loadLearnServerContext(
  requested: string | undefined,
): Promise<LearnServerContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const flagged = user.user_metadata?.is_coach === true;
  const [remembered, profile, asCoach, roster, player] = await Promise.all([
    rememberedWorkspace(),
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
      : supabase
          .from("coach_students")
          .select("id")
          .eq("coach_id", user.id)
          .limit(1)
          .maybeSingle(),
    supabase
      .from("player_profiles")
      .select("setup_done_at")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  const activeWorkspace = remembered.workspace;
  const canSwitch = dualRoleEligible({
    coachFlag: flagged,
    coachProfile: Boolean(profile.data),
    acceptedCoachLink: Boolean(asCoach.data),
    coachRoster: Boolean(roster.data),
    playerSetupDoneAt: player.data?.setup_done_at,
  });
  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return {
    user,
    avatarUrl,
    activeWorkspace,
    audience: resolveLearnAudience({ active: activeWorkspace, requested, canSwitch }),
    canSwitch,
  };
}
