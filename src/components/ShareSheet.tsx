"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Share bottom sheet (public links, Share mode v1). Controlled: the match
 * header and point views own the trigger buttons and pass open/onClose.
 *
 * Rows:
 *   match context — "This match" (public link) + "Download video"
 *   point context — "This point" (public link)
 *
 * A link row creates (or reuses) the link via POST /api/share, then hands
 * it to navigator.share when available, else copies it with a "Copied"
 * flash — same pattern as ShareWithCoach. Minimal words throughout.
 */
export function ShareSheet({
  open,
  onClose,
  matchId,
  pointId,
}: {
  open: boolean;
  onClose: () => void;
  matchId: string;
  /** present = point context (single "This point" row) */
  pointId?: string;
}) {
  const [busy, setBusy] = useState<"link" | "download" | null>(null);
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBusy(null);
    setCopied(false);
    setLink(null);
    setError(null);
  }, [open]);

  const shareLink = useCallback(async () => {
    if (busy) return;
    setBusy("link");
    setError(null);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          pointId ? { matchId, pointId } : { matchId }
        ),
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
  }, [busy, matchId, pointId]);

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

  const rowClass =
    "flex w-full items-center gap-3 rounded-xl border border-edge bg-ink/40 p-3.5 text-left transition-colors hover:border-cyan-glow/40 disabled:opacity-60";

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
          <h2 className="text-base font-semibold">Share</h2>
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

        <div className="mt-4 space-y-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void shareLink()}
            className={rowClass}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow">
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
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-zinc-100">
                {pointId ? "This point" : "This match"}
              </span>
              <span className="mt-0.5 block text-xs text-zinc-500">
                {busy === "link"
                  ? "Creating link…"
                  : copied
                    ? "Copied"
                    : "Public link"}
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
        </div>

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
