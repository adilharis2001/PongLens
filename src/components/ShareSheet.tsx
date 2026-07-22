"use client";

import { useCallback, useEffect, useState } from "react";
import { ShareWithCoachSheet } from "@/components/ShareWithCoach";

/**
 * Share bottom sheet (public links, Share mode). Controlled: the match
 * header and point views own the trigger buttons and pass open/onClose.
 *
 * Rows:
 *   match context — "Starred points (N)" (hidden when none starred),
 *                   "This match", "Download video", "With your coach"
 *   point context — "This point" (public link)
 *
 * A link row swaps the sheet to a one-field title step: an input prefilled
 * with a smart default ("Adil vs Marco", "Point 14 · Adil vs Marco") and a
 * single Share button. Share creates (or reuses) the link via POST
 * /api/share — the title rides along, so re-sharing renames an existing
 * link — then hands it to navigator.share when available, else copies it
 * with a "Copied" flash. "With your coach" swaps to the existing
 * ShareWithCoachSheet — same invite flow as everywhere else. Minimal words
 * throughout.
 */
export function ShareSheet({
  open,
  onClose,
  matchId,
  pointId,
  pointNumber,
  starredCount,
  userId,
  names,
}: {
  open: boolean;
  onClose: () => void;
  matchId: string;
  /** present = point context (single "This point" row) */
  pointId?: string;
  /** display number of that point (title prefill: "Point N · …") */
  pointNumber?: number;
  /** currently starred visible points; row hidden when 0 or absent */
  starredCount?: number;
  /** owner's id; enables the "With your coach" row when present */
  userId?: string;
  /** "Adil vs Marco" | "vs Marco" | null — for the default title */
  names?: string | null;
}) {
  const [busy, setBusy] = useState<"link" | "starred" | "download" | null>(
    null
  );
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coachOpen, setCoachOpen] = useState(false);
  // Which link kind the title step is naming; null = the row list.
  const [naming, setNaming] = useState<"link" | "starred" | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (!open) return;
    setBusy(null);
    setCopied(false);
    setLink(null);
    setError(null);
    setCoachOpen(false);
    setNaming(null);
    setTitle("");
  }, [open]);

  const defaultTitle = useCallback(
    (which: "link" | "starred") => {
      const pair = (names ?? "").trim();
      if (which === "link" && pointId) {
        const base = pointNumber && pointNumber > 0 ? `Point ${pointNumber}` : "Point";
        return pair ? `${base} · ${pair}` : base;
      }
      return pair || "My match";
    },
    [names, pointId, pointNumber]
  );

  const openNaming = useCallback(
    (which: "link" | "starred") => {
      setError(null);
      setLink(null);
      setCopied(false);
      setTitle(defaultTitle(which));
      setNaming(which);
    },
    [defaultTitle]
  );

  const shareLink = useCallback(
    async (which: "link" | "starred") => {
      if (busy) return;
      setBusy(which);
      setError(null);
      try {
        const target =
          which === "starred"
            ? { matchId, kind: "starred" }
            : pointId
              ? { matchId, pointId }
              : { matchId };
        const res = await fetch("/api/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...target, title: title.trim().slice(0, 80) }),
        });
        const data = res.ok ? await res.json() : null;
        if (!data?.url) throw new Error("no url");
        setLink(data.url);
        if (typeof navigator.share === "function") {
          try {
            await navigator.share({ url: data.url });
          } catch {
            // user dismissed the OS sheet; the link stays visible below
          }
        } else {
          await navigator.clipboard.writeText(data.url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      } catch {
        setError("Couldn't create the link. Try again.");
      } finally {
        setBusy(null);
      }
    },
    [busy, matchId, pointId, title]
  );

  const copyLink = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy failed. Select the link and copy it manually.");
    }
  }, [link]);

  const download = useCallback(async () => {
    if (busy) return;
    setBusy("download");
    setError(null);
    try {
      const res = await fetch("/api/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.url) throw new Error("no url");
      window.location.href = data.url;
    } catch {
      setError("Couldn't create a download link. Try again shortly.");
    } finally {
      setBusy(null);
    }
  }, [busy, matchId]);

  if (!open) return null;

  // Coach flow: the existing invite sheet, unchanged, in place of this one.
  if (coachOpen && userId) {
    return (
      <ShareWithCoachSheet
        open
        onClose={onClose}
        userId={userId}
        matchId={matchId}
      />
    );
  }

  const rowClass =
    "flex w-full items-center gap-3 rounded-xl border border-edge bg-ink/40 p-3.5 text-left transition-colors hover:border-cyan-glow/40 disabled:opacity-60";

  const linkIcon = (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 15V4m0 0L8 8m4-4 4 4M6 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"
      />
    </svg>
  );

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close share sheet"
        onClick={onClose}
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
      />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-edge bg-surface p-5 pb-8 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {naming && (
              <button
                type="button"
                onClick={() => setNaming(null)}
                aria-label="Back"
                className="-ml-1 rounded-full p-1 text-zinc-400 transition-colors hover:text-white"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 5l-7 7 7 7"
                  />
                </svg>
              </button>
            )}
            <h2 className="text-base font-semibold">Share</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          Anyone with the link can watch. Revoke it anytime from your
          account.
        </p>

        {naming && (
          <div className="mt-4 space-y-3">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void shareLink(naming);
              }}
              maxLength={80}
              autoComplete="off"
              enterKeyHint="go"
              aria-label="Link title"
              placeholder={defaultTitle(naming)}
              className="w-full rounded-xl border border-edge bg-surface-2/40 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
            />
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void shareLink(naming)}
              className="glow-cta block w-full rounded-full bg-cyan-glow px-5 py-3 text-center text-sm font-semibold text-ink disabled:opacity-60"
            >
              {busy !== null ? "Creating link…" : copied ? "Copied" : "Share"}
            </button>
          </div>
        )}

        {!naming && (
        <div className="mt-4 space-y-2">
          {/* starred points — match context only, only when any exist */}
          {!pointId && (starredCount ?? 0) > 0 && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => openNaming("starred")}
              className={rowClass}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-300/40 bg-amber-300/10 text-amber-300">
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="currentColor"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"
                  />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-zinc-100">
                  Starred points ({starredCount})
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  Public link · updates as you star
                </span>
              </span>
            </button>
          )}

          <button
            type="button"
            disabled={busy !== null}
            onClick={() => openNaming("link")}
            className={rowClass}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow">
              {linkIcon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-zinc-100">
                {pointId ? "This point" : "This match"}
              </span>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Public link
              </span>
            </span>
          </button>

          {!pointId && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void download()}
              className={rowClass}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge bg-ink/60 text-zinc-300">
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 19h14"
                  />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-zinc-100">
                  Download video
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  {busy === "download" ? "Preparing…" : "Dead time removed"}
                </span>
              </span>
            </button>
          )}

          {/* coach invite — the existing flow, one tap away */}
          {!pointId && userId && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setCoachOpen(true)}
              className={rowClass}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge bg-ink/60 text-zinc-300">
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19m16 0v-1.5a3.5 3.5 0 0 0-2.5-3.35M14.5 4.15a3.5 3.5 0 0 1 0 6.7M13.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
                  />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-zinc-100">
                  With your coach
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  Private invite · they can add notes
                </span>
              </span>
            </button>
          )}
        </div>
        )}

        {link && (
          <div className="mt-3 flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate rounded-lg border border-edge bg-ink/60 px-3 py-2 text-xs text-zinc-300">
              {link}
            </p>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="shrink-0 rounded-full border border-edge bg-surface-2 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
