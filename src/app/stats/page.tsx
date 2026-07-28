import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { StatsView } from "./StatsView";

export const metadata: Metadata = {
  title: "My game",
  robots: { index: false, follow: false },
};

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { view } = await searchParams;
  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;
  const accountName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null;

  return (
    <AppShell avatarUrl={avatarUrl}>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        My game
      </h1>
      <StatsView
        userId={user.id}
        accountName={accountName}
        initialView={view === "tactics" ? "tactics" : "stats"}
      />
    </AppShell>
  );
}
