"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ShareQR } from "@/components/ShareQR";

/**
 * Coach-invite sheet. Creates a pending coach_links row (scoped to one
 * match or all matches) and hands back an invite URL to copy or share.
 *
 * Two exports:
 *   ShareWithCoachSheet — the controlled sheet body. The ShareSheet's
 *     "With your coach" row opens this; the dashboard button does too.
 *   ShareWithCoach — legacy button + sheet wrapper (dashboard, where there
 *     is no match in context so scope is locked to "all").
 */

export function ShareWithCoachSheet({
  open,
  onClose,
  userId,
  matchId,
  onLinkCreated,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  matchId?: string;
  onLinkCreated?: () => void;
}) {
  const [scope, setScope] = useState<"match" | "all">(
    matchId ? "match" : "all"
  );
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setScope(matchId ? "match" : "all");
    setLink(null);
    setError(null);
    setCopied(false);
  }, [open, matchId]);

  const createLink = useCallback(async () => {
    setCreating(true);
    setError(null);
    const supabase = createClient();
    const { data, error: dbError } = await supabase
      .from("coach_links")
      .insert({
        player_id: userId,
        scope_match_id: scope === "match" && matchId ? matchId : null,
      })
      .select("invite_token")
      .single();
    setCreating(false);
    if (dbError || !data?.invite_token) {
      setError("Couldn't create the link. Try again.");
      return;
    }
    setLink(`${window.location.origin}/coach-invite/${data.invite_token}`);
    onLinkCreated?.();
  }, [userId, matchId, scope, onLinkCreated]);

  const copy = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy failed. Select the link and copy it manually.");
    }
  }, [link]);

  const nativeShare = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.share({
        title: "PongLens match invite",
        text: "Watch my table tennis matches on PongLens",
        url: link,
      });
    } catch {
      // user dismissed the share sheet; nothing to do
    }
  }, [link]);

  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

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
          <h2 className="text-base font-semibold">Share with coach</h2>
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

        {!link ? (
          <>
            <p className="mt-1 text-sm text-zinc-400">
              Your coach can watch, but not edit. They can add notes.
            </p>
            <div className="mt-4 space-y-2">
              {matchId && (
                <button
                  type="button"
                  aria-pressed={scope === "match"}
                  onClick={() => setScope("match")}
                  className={`w-full rounded-xl border p-3.5 text-left transition-colors ${
                    scope === "match"
                      ? "border-cyan-glow/60 bg-cyan-glow/10"
                      : "border-edge bg-ink/40 hover:border-cyan-glow/40"
                  }`}
                >
                  <p className="text-sm font-semibold text-zinc-100">
                    This match
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Your coach sees only this match.
                  </p>
                </button>
              )}
              <button
                type="button"
                aria-pressed={scope === "all"}
                onClick={() => setScope("all")}
                className={`w-full rounded-xl border p-3.5 text-left transition-colors ${
                  scope === "all"
                    ? "border-cyan-glow/60 bg-cyan-glow/10"
                    : "border-edge bg-ink/40 hover:border-cyan-glow/40"
                }`}
              >
                <p className="text-sm font-semibold text-zinc-100">
                  All my matches
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Every match, including future uploads.
                </p>
              </button>
            </div>
            <button
              type="button"
              disabled={creating}
              onClick={() => void createLink()}
              className="glow-cta mt-4 w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create invite link"}
            </button>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-zinc-400">
              Send this link to your coach. You can revoke it anytime from
              your dashboard.
            </p>
            <p className="mt-3 break-all rounded-lg border border-edge bg-ink/60 px-3 py-2.5 text-xs text-zinc-300">
              {link}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void copy()}
                className="flex-1 rounded-full bg-cyan-glow px-4 py-2.5 text-sm font-semibold text-ink"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              {canNativeShare && (
                <button
                  type="button"
                  onClick={() => void nativeShare()}
                  className="flex-1 rounded-full border border-edge bg-surface-2 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50"
                >
                  Share…
                </button>
              )}
            </div>
            <ShareQR url={link} />
          </>
        )}
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}

export function ShareWithCoach({
  userId,
  matchId,
  onLinkCreated,
  buttonClassName,
}: {
  userId: string;
  matchId?: string;
  onLinkCreated?: () => void;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          buttonClassName ??
          "rounded-full border border-edge bg-surface-2 px-5 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white"
        }
      >
        Share with coach
      </button>
      <ShareWithCoachSheet
        open={open}
        onClose={() => setOpen(false)}
        userId={userId}
        matchId={matchId}
        onLinkCreated={onLinkCreated}
      />
    </>
  );
}
