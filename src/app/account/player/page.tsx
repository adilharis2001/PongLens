import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import {
  PlayerProfileSection,
  type PlayerProfile,
} from "../PlayerProfileSection";

export const metadata: Metadata = {
  title: "Player profile",
  robots: { index: false, follow: false },
};

/**
 * Account -> Your game -> Player profile. Set-once facts (handedness,
 * grip, rubbers, style) live on their own page instead of stretching the
 * account screen — they change when equipment changes, not weekly.
 */
export default async function PlayerProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: playerProfile } = await supabase
    .from("player_profiles")
    .select(
      "handedness, grip, level, fh_rubber, bh_rubber, fh_rubber_name, bh_rubber_name, style"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return (
    <AppShell avatarUrl={avatarUrl}>
      <Link
        href="/account"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-cyan-glow"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
        </svg>
        Account
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
        Player profile
      </h1>

      <div className="mt-6">
        <PlayerProfileSection
          userId={user.id}
          initial={(playerProfile as PlayerProfile | null) ?? null}
        />
      </div>
    </AppShell>
  );
}
