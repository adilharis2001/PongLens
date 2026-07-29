import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { SharingSection } from "@/components/SharingSection";
import { StorageSection } from "./StorageSection";
import { ShareLinksSection } from "./ShareLinksSection";
import { DisplayNameEditor } from "./DisplayNameEditor";
import {
  PlayerProfileSection,
  type PlayerProfile,
} from "./PlayerProfileSection";
import { SignOutRow } from "./SignOutRow";
import { getSupportEmail } from "@/lib/config";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

/**
 * Section order follows the settings-screen conventions the big consumer
 * apps share (Strava, Spotify, Instagram): identity first, then the
 * highest-frequency content links, people/sharing controls before
 * data/resource items, support above legal, and the destructive exit as
 * the very last row on the page.
 */

function RowLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between px-5 py-4 text-sm font-medium text-zinc-200 transition-colors hover:bg-surface-2"
    >
      {label}
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 text-zinc-500"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
      </svg>
    </Link>
  );
}

/** Small uppercase label over a card group. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </h2>
  );
}

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const adminEmail = await getSupportEmail();
  const isAdmin = user.email === adminEmail;
  const { data: playerProfile } = await supabase
    .from("player_profiles")
    .select(
      "handedness, grip, fh_rubber, bh_rubber, fh_rubber_name, bh_rubber_name, style"
    )
    .eq("user_id", user.id)
    .maybeSingle();
  const name =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email ??
    "Player";
  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return (
    <AppShell avatarUrl={avatarUrl}>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Account</h1>

      {/* 1 — identity anchors the top */}
      <div className="mt-8 flex items-center gap-4 rounded-2xl border border-edge bg-surface p-5">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt=""
            width={48}
            height={48}
            unoptimized
            className="rounded-full border border-edge"
          />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-edge bg-surface-2 text-lg font-semibold text-zinc-300">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <DisplayNameEditor initialName={name} />
          <p className="truncate text-sm text-zinc-500">{user.email}</p>
        </div>
      </div>

      {/* 2 — owner-only: one quiet row, no group of its own */}
      {isAdmin && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-cyan-glow/25 bg-surface">
          <RowLink href="/admin" label="Admin" />
        </div>
      )}

      {/* 3 — highest-frequency destinations on this tab */}
      <div className="mt-8">
        <SectionLabel>Your game</SectionLabel>
        <div className="divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
          <RowLink href="/stats" label="My stats" />
          <RowLink href="/stats?view=tactics" label="Tactics" />
        </div>
      </div>

      {/* 3b — who you are at the table; same fields onboarding collects */}
      <div className="mt-8">
        <SectionLabel>Player profile</SectionLabel>
        <PlayerProfileSection
          userId={user.id}
          initial={(playerProfile as PlayerProfile | null) ?? null}
        />
      </div>

      {/* 4 — people controls before data items */}
      <div className="mt-8">
        <SectionLabel>Sharing</SectionLabel>
        <div className="space-y-6">
          <SharingSection userId={user.id} />
          <ShareLinksSection />
        </div>
      </div>

      {/* 5 — resource management sits mid-low */}
      <div className="mt-8">
        <SectionLabel>Storage</SectionLabel>
        <StorageSection userId={user.id} />
      </div>

      {/* 6 — support block, just above legal */}
      <div className="mt-8">
        <SectionLabel>Support</SectionLabel>
        <div className="divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
          <RowLink href="/learn" label="How-to guides" />
          <RowLink href="/feedback" label="Send feedback" />
          <a
            href={`mailto:${adminEmail}`}
            className="flex items-center justify-between px-5 py-4 text-sm font-medium text-zinc-200 transition-colors hover:bg-surface-2"
          >
            Contact support
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 text-zinc-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m9 6 6 6-6 6"
              />
            </svg>
          </a>
        </div>
      </div>

      {/* 7 — legal, last among the links */}
      <div className="mt-8">
        <SectionLabel>Legal</SectionLabel>
        <div className="divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
          <RowLink href="/terms" label="Terms of Service" />
          <RowLink href="/privacy" label="Privacy Policy" />
        </div>
      </div>

      {/* 8 — the exit, alone at the very bottom */}
      <div className="mt-10">
        <SignOutRow />
      </div>
    </AppShell>
  );
}
