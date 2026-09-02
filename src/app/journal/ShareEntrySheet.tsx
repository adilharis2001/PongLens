"use client";

import { useCallback, useEffect, useState } from "react";
import { ShareQR } from "@/components/ShareQR";

/**
 * The sheet behind a journal entry's Share button. Same dress as the
 * match Share sheet: dimmed backdrop, bottom sheet on phones, small
 * centred card on desktop.
 *
 * Opening it mints the link straight away — the Share tap on the card was
 * the decision, so there is nothing to ask first. POST /api/share is
 * idempotent, so reopening the sheet hands back the same URL rather than
 * minting a second one. "Turn off the link" revokes it on the spot; the
 * Account page lists it alongside every other public link either way.
 */
export function ShareEntrySheet({
  open,
  lessonId,
  title,
  onClose,
}: {
  open: boolean;
  lessonId: string;
  /** The entry's current headline, stored on the link so the Account
   *  list can tell shared entries apart. Re-sharing refreshes it. */
  title: string;
  onClose: () => void;
}) {
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const mint = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId, title }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.url || !data?.id) throw new Error("no url");
      setLink({ id: data.id, url: data.url });
    } catch {
      setError("Couldn't create the link. Try again.");
    }
  }, [lessonId, title]);

  useEffect(() => {
    if (!open) return;
    setLink(null);
    setError(null);
    setCopied(false);
    setRevoking(false);
    void mint();
  }, [open, mint]);

  const shareLink = useCallback(async () => {
    if (!link) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url: link.url });
        return;
      } catch {
        // user dismissed the OS sheet; the link stays visible below
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy failed. Select the link and copy it manually.");
    }
  }, [link]);

  const copyLink = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy failed. Select the link and copy it manually.");
    }
  }, [link]);

  const turnOff = useCallback(async () => {
    if (!link || revoking) return;
    setRevoking(true);
    setError(null);
    try {
      const res = await fetch("/api/share/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: link.id }),
      });
      if (!res.ok) throw new Error("revoke failed");
      onClose();
    } catch {
      setError("Couldn't revoke the link. Try again.");
    } finally {
      setRevoking(false);
    }
  }, [link, revoking, onClose]);

  if (!open) return null;

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
          <h2 className="text-base font-semibold">Share this entry</h2>
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
        {/* "Revoke" is the product's one word for killing a link — the
            Account list and the match sheet both use it, so this sheet
            does too rather than teaching a second name for the action. */}
        <p className="mt-1 text-sm text-zinc-400">
          Anyone with the link can read this entry, and it always shows the
          latest version. You can revoke it anytime.
        </p>

        {link ? (
          <div className="mt-4 space-y-3">
            <p className="break-all rounded-xl border border-edge bg-ink/40 px-4 py-3 font-mono text-xs text-zinc-400">
              {link.url}
            </p>
            <button
              type="button"
              onClick={() => void shareLink()}
              className="glow-cta block w-full rounded-full bg-cyan-glow px-5 py-3 text-center text-sm font-semibold text-ink"
            >
              {copied ? "Copied" : "Share the link"}
            </button>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => void copyLink()}
                className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              <button
                type="button"
                onClick={() => void turnOff()}
                disabled={revoking}
                className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-amber-400/60 hover:text-amber-300 disabled:opacity-60"
              >
                {revoking ? "Revoking…" : "Revoke the link"}
              </button>
            </div>
            <ShareQR url={link.url} />
          </div>
        ) : error ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-red-400">{error}</p>
            <button
              type="button"
              onClick={() => void mint()}
              className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
            >
              Try again
            </button>
          </div>
        ) : (
          <p className="mt-4 animate-pulse text-sm text-zinc-400">
            Creating the link…
          </p>
        )}

        {link && error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
