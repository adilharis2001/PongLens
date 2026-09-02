import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import {
  displayNameFromMetadata,
  safePostOnboardingPath,
} from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";
import { OnboardingFlow } from "./OnboardingFlow";

export const metadata: Metadata = {
  title: "Welcome",
  robots: { index: false, follow: false },
};

/**
 * First-login setup. Players answer the name (when the account has
 * none), then handedness/grip, then gear and playing style — the
 * profile steps are always skippable. Coaches (anyone with a coach
 * link) answer only the name. Everything lands in player_profiles;
 * the row's presence is what ends the middleware's redirect here.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: requestedNext } = await searchParams;
  const next = safePostOnboardingPath(requestedNext);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent("/onboarding")}`);
  }

  const needsName = !displayNameFromMetadata(user.user_metadata);

  const [{ data: profile }, { data: coachLink }] = await Promise.all([
    supabase
      .from("player_profiles")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("coach_links")
      .select("id")
      .eq("coach_id", user.id)
      .limit(1)
      .maybeSingle(),
  ]);

  if (!needsName && profile) {
    redirect(next);
  }

  return (
    <main className="bg-arena flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-edge bg-surface p-8">
          <OnboardingFlow
            needsName={needsName}
            isCoach={!!coachLink}
            isNew={!profile}
            next={next}
          />
        </div>
      </div>
    </main>
  );
}
