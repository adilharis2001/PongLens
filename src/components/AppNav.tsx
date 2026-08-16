"use client";

import Link from "next/link";
import { confirmLeaveDuringUpload } from "@/lib/uploadGuard";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { NotificationBell } from "@/components/NotificationBell";
import { createClient } from "@/lib/supabase/client";

/**
 * Signed-in navigation shell.
 * Mobile: slim top bar (logo + bell + account avatar) + fixed bottom bar
 * with Home / Matches / Journal. Desktop: single top header with the same
 * three destinations, bell and avatar on the right.
 *
 * The bar holds DESTINATIONS only. Upload is a task, not a place you dwell
 * in — it floats as each tab's primary action instead (UploadFab on Home
 * and Matches, "New" on the Journal), so the spine stays three deep and
 * the create action sits on the content it acts on.
 *
 * The bell and avatar sit top-right on BOTH breakpoints: notifications and
 * account are peripheral checks.
 */

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={active ? 0 : 1.8}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9.5Z"
      />
    </svg>
  );
}

function MatchesIcon({ active }: { active: boolean }) {
  // Film frame with a play wedge — the match library.
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={active ? 0 : 1.8}
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      {active ? (
        <path d="m10.2 9.4 4.6 2.6-4.6 2.6Z" fill="#0a0a0a" />
      ) : (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m10.2 9.4 4.6 2.6-4.6 2.6Z"
        />
      )}
    </svg>
  );
}

function JournalIcon({ active }: { active: boolean }) {
  // A bound notebook — the journal. The binding line stays visible when
  // the filled active state would swallow it.
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={active ? 0 : 1.8}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.5 3.5h11A1.5 1.5 0 0 1 19 5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5Z"
      />
      <path
        d="M9 3.5v17"
        fill="none"
        stroke={active ? "#0a0a0a" : "currentColor"}
        strokeWidth={active ? 1.6 : 1.8}
        strokeLinecap="round"
      />
      {!active && (
        <path
          strokeLinecap="round"
          d="M12 8.5h4M12 12h4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
        />
      )}
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path
        strokeLinecap="round"
        d="M4.5 20c1.2-3.2 4.1-5 7.5-5s6.3 1.8 7.5 5"
      />
    </svg>
  );
}

function CoachIcon({ active }: { active: boolean }) {
  // A whistle: coaching's oldest tool.
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={active ? 0 : 1.8}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 8.5 20 6v4.5l-3.6 1.2a5.5 5.5 0 1 1-2.9-3.2Zm-3 7.7a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4Z"
      />
    </svg>
  );
}

const TABS = [
  { href: "/dashboard", label: "Home" },
  { href: "/matches", label: "Matches" },
  { href: "/journal", label: "Journal" },
] as const;

const COACHING_TAB = { href: "/coaching", label: "Coaching" } as const;

function tabIcon(label: string, active: boolean) {
  switch (label) {
    case "Home":
      return <HomeIcon active={active} />;
    case "Matches":
      return <MatchesIcon active={active} />;
    case "Coaching":
      return <CoachIcon active={active} />;
    default:
      return <JournalIcon active={active} />;
  }
}

/**
 * The Coaching tab shows for anyone with a coaching relationship, in any
 * direction: a coach profile, matches shared with you, coaches you've
 * invited, or reviews you've bought. Everyone else keeps three tabs and
 * finds coaching through the funnel. Cached in sessionStorage so the bar
 * doesn't pop in a tab after first paint; refreshed quietly each mount.
 */
function useIsCoach(): boolean {
  // Hydrates false (matching the server), then flips from the session
  // cache in the first effect — reading storage during render is a
  // hydration mismatch.
  const [isCoach, setIsCoach] = useState(false);
  useEffect(() => {
    let alive = true;
    if (sessionStorage.getItem("pl-coach-tab") === "1") setIsCoach(true);
    const check = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const [profile, asCoach, asPlayer, orders] = await Promise.all([
        supabase
          .from("coach_profiles")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("coach_links")
          .select("id")
          .eq("coach_id", user.id)
          .eq("status", "accepted")
          .limit(1)
          .maybeSingle(),
        supabase
          .from("coach_links")
          .select("id")
          .eq("player_id", user.id)
          .neq("status", "revoked")
          .limit(1)
          .maybeSingle(),
        supabase
          .from("review_orders")
          .select("id")
          .eq("student_id", user.id)
          .limit(1)
          .maybeSingle(),
      ]);
      const coach = Boolean(
        profile.data || asCoach.data || asPlayer.data || orders.data,
      );
      sessionStorage.setItem("pl-coach-tab", coach ? "1" : "0");
      if (alive) setIsCoach(coach);
    };
    void check();
    return () => {
      alive = false;
    };
  }, []);
  return isCoach;
}

export function AppNav({
  avatarUrl,
  wide,
}: {
  avatarUrl: string | null;
  wide?: boolean;
}) {
  const pathname = usePathname();
  const isCoach = useIsCoach();
  const tabs = isCoach ? [...TABS, COACHING_TAB] : [...TABS];
  const activeTab = (href: string) => {
    switch (href) {
      case "/dashboard":
        return pathname === "/dashboard";
      case "/matches":
        // The library owns match detail pages. NOT the upload page: on a
        // phone that lit "Matches" while you stood on /upload, so the bar
        // told you that you were somewhere you were not. Nothing lights
        // there now — uploading is a task, not a destination, which is the
        // whole reason it has no tab of its own.
        return pathname === "/matches" || pathname.startsWith("/match/");
      case "/coaching":
        return pathname.startsWith("/coaching");
      default:
        return pathname.startsWith("/journal") || pathname.startsWith("/improve");
    }
  };
  const isAccount = pathname === "/account";

  const guard = (e: React.MouseEvent) => {
    if (!confirmLeaveDuringUpload()) e.preventDefault();
  };

  const avatarLink = (
    <Link
      onClick={guard}
      href="/account"
      aria-label="Account"
      aria-current={isAccount ? "page" : undefined}
      className="flex items-center"
    >
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt=""
          width={28}
          height={28}
          unoptimized
          className={`rounded-full border ${
            isAccount ? "border-cyan-glow" : "border-edge"
          }`}
        />
      ) : (
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full border bg-surface-2 ${
            isAccount
              ? "border-cyan-glow text-cyan-glow"
              : "border-edge text-zinc-400"
          }`}
        >
          <PersonIcon />
        </span>
      )}
    </Link>
  );

  return (
    <>
      {/* Desktop header */}
      <header className="sticky top-0 z-50 hidden border-b border-edge/70 bg-ink/80 backdrop-blur-md md:block">
        <div
          className={`mx-auto flex h-16 items-center justify-between px-6 ${
            wide ? "max-w-6xl" : "max-w-4xl"
          }`}
        >
          {/* The logo goes to the public site, the way a logo does
              everywhere else on the web. Home is the Home tab; pointing the
              brand at /dashboard made it a no-op on the page most people
              click it from. Guarded like every other link in this bar. */}
          <Logo href="/" onClick={guard} />
          <nav className="flex items-center gap-2" aria-label="Main">
            {tabs.map((t, i) => {
              // Desktop has its own Upload item; activeTab no longer
              // claims /upload for Matches, so this is just activeTab.
              const active = activeTab(t.href);
              return (
                <Fragment key={t.href}>
                <Link
                  onClick={guard}
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-surface-2 text-white"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {t.label}
                </Link>
                {/* Upload in the header, desktop only (this header is
                    hidden below md): on a wide monitor the corner FAB sits
                    far outside the content column and gets missed. Looks
                    exactly like its neighbours — the destination is the
                    difference, not the styling. */}
                {i === 0 && (
                  <Link
                    onClick={guard}
                    href="/upload"
                    aria-current={pathname === "/upload" ? "page" : undefined}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                      pathname === "/upload"
                        ? "bg-surface-2 text-white"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    Upload
                  </Link>
                )}
                </Fragment>
              );
            })}
            {/* peripheral cluster: a hairline and some air keep the bell
                and avatar from crowding the destination pills */}
            <span className="ml-3 flex items-center gap-2.5 border-l border-edge/60 pl-4">
              <NotificationBell />
              {avatarLink}
            </span>
          </nav>
        </div>
      </header>

      {/* Mobile top bar: brand + peripheral checks */}
      <header className="sticky top-0 z-50 border-b border-edge/70 bg-ink/80 backdrop-blur-md md:hidden">
        <div className="flex h-14 items-center justify-between px-5">
          <Logo href="/" onClick={guard} />
          <div className="flex items-center gap-3">
            <NotificationBell />
            {avatarLink}
          </div>
        </div>
      </header>

      {/* Mobile bottom bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-edge/70 bg-ink/90 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className={`grid h-16 ${isCoach ? "grid-cols-4" : "grid-cols-3"}`}>
          {tabs.map((t) => {
            const active = activeTab(t.href);
            return (
              <Link
                key={t.href}
                onClick={guard}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 ${
                  active ? "text-cyan-glow" : "text-zinc-500"
                }`}
              >
                {tabIcon(t.label, active)}
                <span className="text-[10px] font-medium">{t.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
