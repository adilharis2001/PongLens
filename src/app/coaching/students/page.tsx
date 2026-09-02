import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { createClient } from "@/lib/supabase/server";
import { StudentsView } from "./StudentsView";

export const metadata: Metadata = {
  title: "Students",
  robots: { index: false, follow: false },
};

/**
 * The coaching roster (156): every student the coach works with, on
 * PongLens or not. Each row opens the student's page — journal, matches,
 * invite. The iOS Students tab is this screen's twin.
 */
export default async function StudentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/coaching/students");

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return (
    <AppShell avatarUrl={avatarUrl}>
      <StudentsView userId={user.id} />
    </AppShell>
  );
}
