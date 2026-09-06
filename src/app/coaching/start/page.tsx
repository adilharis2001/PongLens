import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { createClient } from "@/lib/supabase/server";
import { CoachModeStart } from "./CoachModeStart";

export const metadata: Metadata = {
  title: "Set up coach mode",
  robots: { index: false, follow: false },
};

/**
 * Where "Set up coach mode" on /coaches lands. Public site chrome on
 * purpose — the visitor may not be in the app yet.
 */
export default async function CoachStartPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/coaching/start");

  return (
    <div className="flex min-h-dvh flex-col bg-arena">
      <SiteHeader />
      <main className="mx-auto w-full max-w-lg flex-1 px-5 pb-24 pt-10 sm:px-6 md:pt-16">
        <CoachModeStart userId={user.id} />
      </main>
      <SiteFooter />
    </div>
  );
}
