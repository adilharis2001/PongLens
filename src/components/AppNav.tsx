"use client";

import Link from "next/link";
import { confirmLeaveDuringUpload } from "@/lib/uploadGuard";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";

/**
 * Signed-in navigation shell.
 * Mobile: slim top bar (logo) + fixed bottom bar with Home / Upload / Account.
 * Desktop: single top header with the same three destinations.
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

function PersonIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={active ? 0 : 1.8}
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path
        strokeLinecap="round"
        d="M4.5 20c1.2-3.2 4.1-5 7.5-5s6.3 1.8 7.5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
      />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      {/* tray with an arrow rising out of it — the standard upload glyph */}
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 15.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15V4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m7.5 8.5 4.5-4.5 4.5 4.5" />
    </svg>
  );
}

export function AppNav({ avatarUrl }: { avatarUrl: string | null }) {
  const pathname = usePathname();
  const isHome = pathname === "/dashboard" || pathname.startsWith("/match");
  const isUpload = pathname === "/upload";
  const isAccount = pathname === "/account";

  const desktopLink = (href: string, label: string, active: boolean) => (
    <Link
      onClick={(e) => {
        if (!confirmLeaveDuringUpload()) e.preventDefault();
      }}
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-surface-2 text-white"
          : "text-zinc-400 hover:text-white"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <>
      {/* Desktop header */}
      <header className="sticky top-0 z-50 hidden border-b border-edge/70 bg-ink/80 backdrop-blur-md md:block">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <Logo href="/dashboard" />
          <nav className="flex items-center gap-2" aria-label="Main">
            {desktopLink("/dashboard", "Home", isHome)}
            {desktopLink("/upload", "Upload", isUpload)}
            <Link
              onClick={(e) => {
                if (!confirmLeaveDuringUpload()) e.preventDefault();
              }}
              href="/account"
              aria-current={isAccount ? "page" : undefined}
              className={`ml-1 flex items-center gap-2 rounded-full py-1 pl-1 pr-4 text-sm font-medium transition-colors ${
                isAccount
                  ? "bg-surface-2 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt=""
                  width={28}
                  height={28}
                  unoptimized
                  className={`rounded-full border ${
                    isAccount ? "border-cyan-glow/60" : "border-edge"
                  }`}
                />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-edge bg-surface-2 text-zinc-400">
                  <PersonIcon active={false} />
                </span>
              )}
              Account
            </Link>
          </nav>
        </div>
      </header>

      {/* Mobile top bar: brand only */}
      <header className="sticky top-0 z-50 border-b border-edge/70 bg-ink/80 backdrop-blur-md md:hidden">
        <div className="flex h-14 items-center px-5">
          <Logo href="/dashboard" />
        </div>
      </header>

      {/* Mobile bottom bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-edge/70 bg-ink/90 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid h-16 grid-cols-3">
          <Link
            onClick={(e) => {
              if (!confirmLeaveDuringUpload()) e.preventDefault();
            }}
            href="/dashboard"
            aria-current={isHome ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 ${
              isHome ? "text-cyan-glow" : "text-zinc-500"
            }`}
          >
            <HomeIcon active={isHome} />
            <span className="text-[10px] font-medium">Home</span>
          </Link>

          <Link
            onClick={(e) => {
              if (!confirmLeaveDuringUpload()) e.preventDefault();
            }}
            href="/upload"
            aria-current={isUpload ? "page" : undefined}
            aria-label="Upload a match"
            className="flex items-start justify-center"
          >
            <span
              className={`glow-cta -mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-cyan-glow text-ink ${
                isUpload ? "ring-2 ring-white/70" : ""
              }`}
            >
              <UploadIcon />
            </span>
          </Link>

          <Link
            onClick={(e) => {
              if (!confirmLeaveDuringUpload()) e.preventDefault();
            }}
            href="/account"
            aria-current={isAccount ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 ${
              isAccount ? "text-cyan-glow" : "text-zinc-500"
            }`}
          >
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt=""
                width={24}
                height={24}
                unoptimized
                className={`rounded-full border ${
                  isAccount ? "border-cyan-glow" : "border-edge"
                }`}
              />
            ) : (
              <PersonIcon active={isAccount} />
            )}
            <span className="text-[10px] font-medium">Account</span>
          </Link>
        </div>
      </nav>
    </>
  );
}
