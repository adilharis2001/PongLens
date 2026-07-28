"use client";

import Link from "next/link";
import { confirmLeaveDuringUpload } from "@/lib/uploadGuard";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { NotificationBell } from "@/components/NotificationBell";

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

const TABS = [
  { href: "/dashboard", label: "Home" },
  { href: "/matches", label: "Matches" },
  { href: "/journal", label: "Journal" },
] as const;

function tabIcon(label: string, active: boolean) {
  switch (label) {
    case "Home":
      return <HomeIcon active={active} />;
    case "Matches":
      return <MatchesIcon active={active} />;
    default:
      return <JournalIcon active={active} />;
  }
}

export function AppNav({ avatarUrl }: { avatarUrl: string | null }) {
  const pathname = usePathname();
  const activeTab = (href: string) => {
    switch (href) {
      case "/dashboard":
        return pathname === "/dashboard";
      case "/matches":
        // The library owns match detail pages AND the upload task page —
        // uploading produces a match, so the library stays lit.
        return (
          pathname === "/matches" ||
          pathname.startsWith("/match/") ||
          pathname === "/upload"
        );
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
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <Logo href="/dashboard" />
          <nav className="flex items-center gap-2" aria-label="Main">
            {TABS.map((t) => {
              const active = activeTab(t.href);
              return (
                <Link
                  key={t.href}
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
          <Logo href="/dashboard" />
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
        <div className="grid h-16 grid-cols-3">
          {TABS.map((t) => {
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
