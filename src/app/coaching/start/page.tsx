import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { createClient } from "@/lib/supabase/server";
import { CoachStart } from "../CoachStart";

export const metadata: Metadata = {
  title: "Set up your coach page",
  robots: { index: false, follow: false },
};

/**
 * Where "Set up your page" on /coaches lands. Exempt from the
 * early-access gate (see middleware): for a coach arriving cold, creating
 * the page IS the way in, the same way accepting a player's invite is.
 * Public site chrome on purpose — the visitor may not be in the app yet.
 */
export default async function CoachStartPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/coaching/start");

  const { data: profile } = await supabase
    .from("coach_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profile) redirect("/coaching");

  const defaultName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    "";

  return (
    <div className="flex min-h-dvh flex-col bg-arena">
      <SiteHeader />
      <main className="mx-auto w-full max-w-lg flex-1 px-5 pb-24 pt-10 sm:px-6 md:pt-16">
        <CoachStart defaultName={defaultName} />
      </main>
      <SiteFooter />
    </div>
  );
}
