import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import type { CoachProfileRow } from "@/lib/reviews/types";
import { createClient } from "@/lib/supabase/server";
import { ProfileEditor } from "./ProfileEditor";

export const metadata: Metadata = {
  title: "Your coach page",
  robots: { index: false, follow: false },
};

export default async function CoachProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/coaching/profile");

  const { data: profile } = await supabase
    .from("coach_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/coaching");

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return (
    <AppShell avatarUrl={avatarUrl}>
      <ProfileEditor profile={profile as CoachProfileRow} />
    </AppShell>
  );
}
