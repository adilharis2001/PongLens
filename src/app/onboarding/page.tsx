import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import {
  displayNameFromMetadata,
  safePostOnboardingPath,
} from "@/lib/auth/profile";
import { getTermsVersion } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { OnboardingFlow } from "./OnboardingFlow";

export const metadata: Metadata = {
  title: "Welcome",
  robots: { index: false, follow: false },
};

/**
 * First-login setup. Every new account starts on the birth month and
 * year screen, which is also where the terms are accepted (the
 * "Agree and continue" tap stamps terms_accepted_at). Then players
 * answer the name (when the account has none), then handedness/grip,
 * then gear and playing style — the profile steps are always skippable.
 * Coaches (anyone with a coach link) answer only the name. Everything
 * lands in player_profiles; the row's presence plus a terms stamp is
 * what ends the middleware's redirect here. Existing rows were
 * backfilled as accepted, so only new accounts see the first screen.
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

  const [{ data: profile }, { data: coachLink }, termsVersion, headerList] =
    await Promise.all([
      supabase
        .from("player_profiles")
        .select("user_id, terms_accepted_at")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("coach_links")
        .select("id")
        .eq("coach_id", user.id)
        .limit(1)
        .maybeSingle(),
      getTermsVersion(),
      headers(),
    ]);

  const needsTerms = !profile?.terms_accepted_at;
  // Vercel stamps the visitor's country on every request; the age
  // threshold is 16 in the EEA and 13 elsewhere (src/lib/consent.ts).
  // Absent (local dev, or a proxy that strips it) means the lower one.
  const country = headerList.get("x-vercel-ip-country") ?? null;

  if (!needsName && profile && !needsTerms) {
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
            needsTerms={needsTerms}
            country={country}
            termsVersion={termsVersion}
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
