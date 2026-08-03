"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { downloadReel } from "@/lib/download";
import { createClient } from "@/lib/supabase/client";
import type { AppNotification, NotificationKind } from "@/lib/types";

/**
 * A finished export, read off the notification's href (`?export=<scope>`,
 * migration 065). Present means the notification can hand over the file
 * itself instead of pointing at the page it lives on.
 */
function exportTarget(n: AppNotification): { matchId: string; scope: string } | null {
  if (n.kind !== "reel_ready" || !n.match_id) return null;
  const scope = n.href.split("?export=")[1];
  return scope === "full" || scope === "starred"
    ? { matchId: n.match_id, scope }
    : null;
}

/**
 * The bell. Notifications are written server-side by triggers (migration
 * 031) whenever a coach leaves a note, a match finishes processing, or a
 * reel finishes rendering, so this component only ever reads.
 *
 * No realtime subscription: the events it reports are minutes-scale (a
 * render, a coach's review), so a 60s poll plus a refetch whenever the tab
 * regains focus lands the news well inside the time anyone would notice,
 * without holding a socket open on every signed-in page.
 *
 * Read state is EXPLICIT — opening the panel does not silently clear the
 * badge. Tapping an item marks that one read; "Mark all read" clears the
 * rest. The count always means "things you haven't opened".
 */

const POLL_MS = 60_000;
const PAGE_SIZE = 20;

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function KindIcon({ kind }: { kind: NotificationKind }) {
  const common = {
    viewBox: "0 0 24 24",
    className: "h-4 w-4",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    "aria-hidden": true,
  } as const;

  if (kind === "note") {
    return (
      <svg {...common}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M20 12a7 7 0 0 1-7 7H9l-4 3v-4.6A7 7 0 0 1 4 12a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7Z"
        />
      </svg>
    );
  }
  if (kind === "coach_joined") {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3.5" />
        <path strokeLinecap="round" d="M5 20c1-3 3.7-4.5 7-4.5s6 1.5 7 4.5" />
      </svg>
    );
  }
  if (kind === "reel_ready" || kind === "reel_failed") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m10 9.5 5 2.5-5 2.5v-5Z" />
      </svg>
    );
  }
  if (kind === "match_failed" || kind === "upload_failed") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8.5" />
        <path strokeLinecap="round" d="M12 8v5m0 3h.01" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  );
}

// Soft-shouldered outline bell (the filled trapezoid read as dated); the
// unread signal lives entirely in the badge.
function BellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[1.3rem] w-[1.3rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
      />
    </svg>
  );
}

export function NotificationBell() {
  const pathname = usePathname();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const unread = (items ?? []).filter((n) => !n.read_at).length;

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    // RLS already scopes this to the viewer; a signed-out visitor just
    // gets nothing back and the bell stays empty.
    if (data) setItems(data as AppNotification[]);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const onFocus = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // A navigation means the panel's job is done.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, load]);

  // Optimistic: the badge should drop the moment you tap, and a failed
  // write just reappears on the next poll.
  const markRead = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const stamp = new Date().toISOString();
    setItems((prev) =>
      (prev ?? []).map((n) =>
        ids.includes(n.id) && !n.read_at ? { ...n, read_at: stamp } : n
      )
    );
    const supabase = createClient();
    // read_at is the only column `authenticated` may UPDATE here.
    await supabase
      .from("notifications")
      .update({ read_at: stamp })
      .in("id", ids)
      .is("read_at", null);
  }, []);

  const markAllRead = useCallback(() => {
    const ids = (items ?? []).filter((n) => !n.read_at).map((n) => n.id);
    void markRead(ids);
  }, [items, markRead]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
        }
        className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
          open
            ? "bg-surface-2 text-white"
            : "text-zinc-400 hover:text-white"
        }`}
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-magenta-glow px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-ink">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="fixed right-3 top-[3.75rem] z-[60] w-[min(23rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-edge bg-surface shadow-2xl md:absolute md:right-0 md:top-full md:mt-2 md:w-96"
        >
          <div className="flex items-center justify-between border-b border-edge px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-100">
              Notifications
            </h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs font-semibold text-cyan-glow transition-colors hover:text-white"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[min(28rem,70vh)] overflow-y-auto overscroll-contain">
            {items === null ? (
              <p className="px-4 py-8 text-center text-sm text-zinc-500">
                Loading…
              </p>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-zinc-400">You&apos;re all caught up</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Coach notes and finished matches land here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-edge/60">
                {items.map((n) => {
                  // A ready export downloads on tap instead of navigating.
                  // The old row linked to the match page — usually the page
                  // you were already on, so the notification appeared to do
                  // nothing, and the file it announced was still three taps
                  // away in the Export sheet.
                  const target = exportTarget(n);
                  const rowClass = `flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 ${
                    n.read_at ? "" : "bg-cyan-glow/[0.06]"
                  }`;
                  const Row = target
                    ? ({ children }: { children: React.ReactNode }) => (
                        <button
                          type="button"
                          onClick={() => {
                            void markRead([n.id]);
                            // A refused link (expired render, revoked
                            // access) falls back to the match page, which
                            // is where the Export sheet can explain
                            // itself — better than a tap that does nothing.
                            void downloadReel(
                              target.matchId,
                              target.scope
                            ).catch(() => {
                              window.location.href = n.href;
                            });
                          }}
                          className={rowClass}
                        >
                          {children}
                        </button>
                      )
                    : ({ children }: { children: React.ReactNode }) => (
                        <Link
                          href={n.href}
                          onClick={() => void markRead([n.id])}
                          className={rowClass}
                        >
                          {children}
                        </Link>
                      );
                  return (
                  <li key={n.id}>
                    <Row>
                      <span
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                          n.kind === "match_failed" ||
                          n.kind === "reel_failed" ||
                          n.kind === "upload_failed"
                            ? "border-red-500/40 text-red-400"
                            : n.kind === "note" || n.kind === "coach_joined"
                              ? "border-amber-400/40 text-amber-300"
                              : "border-cyan-glow/40 text-cyan-glow"
                        }`}
                      >
                        <KindIcon kind={n.kind} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate text-sm font-semibold text-zinc-100">
                            {n.title}
                          </span>
                          {!n.read_at && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-glow" />
                          )}
                        </span>
                        {n.body && (
                          <span className="mt-0.5 line-clamp-2 block text-xs text-zinc-400">
                            {n.body}
                          </span>
                        )}
                        <span className="mt-1 block text-[11px] text-zinc-600">
                          {timeAgo(n.created_at)}
                        </span>
                      </span>
                      {target && (
                        <span
                          aria-hidden="true"
                          className="mt-0.5 shrink-0 self-center text-cyan-glow"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"
                            />
                          </svg>
                        </span>
                      )}
                    </Row>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
