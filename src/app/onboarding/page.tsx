import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import {
  displayNameFromMetadata,
  safePostOnboardingPath,
} from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";
import { NameOnboardingForm } from "./NameOnboardingForm";

export const metadata: Metadata = {
  title: "Welcome",
  robots: { index: false, follow: false },
};

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
  if (displayNameFromMetadata(user.user_metadata)) {
    redirect(next);
  }

  return (
    <main className="bg-arena flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-edge bg-surface p-8">
          <h1 className="text-center text-xl font-semibold">
            What should we call you?
          </h1>
          <p className="mt-2 text-center text-sm text-zinc-400">
            We’ll use this across PongLens.
          </p>
          <NameOnboardingForm next={next} />
        </div>
      </div>
    </main>
  );
}
