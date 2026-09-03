"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ShareQR } from "@/components/ShareQR";

interface ConnectedCoach {
  id: string;
  name: string;
  allMatches: boolean;
  matchLinkId: string | null;
  otherMatches: number;
}

/**
 * Share with coach. Your connected coaches come first, by name, with what
 * they can see and a one-tap share for this match (160) — the invite link
 * below is only for a coach you have not connected yet. A player-written,
 * match-scoped accepted link is the direct grant; the coach hears about it
 * the same way they hear about a student's match turning ready.
 *
 * The invite half creates a pending coach_links row (scoped to one match
 * or all matches) and hands back an invite URL to copy or share.
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
  // "selected" is the Coaching-tab case (161): connect the coach now,
  // share matches one at a time from their pages.
  const [scope, setScope] = useState<"match" | "all" | "selected">(
    matchId ? "match" : "all"
  );
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [coaches, setCoaches] = useState<ConnectedCoach[] | null>(null);
  const [busyCoach, setBusyCoach] = useState<string | null>(null);

  const loadCoaches = useCallback(async () => {
    if (!matchId) {
      setCoaches([]);
      return;
    }
    const supabase = createClient();
    const [linksRes, namesRes] = await Promise.all([
      supabase
        .from("coach_links")
        .select("id, coach_id, scope_match_id, all_matches, status")
        .eq("player_id", userId)
        .eq("status", "accepted"),
      supabase.rpc("player_coach_links"),
    ]);
    const names = new Map<string, string>();
    for (const n of (namesRes.data as {
      id: string;
      coach_name: string | null;
      coach_email: string | null;
    }[]) ?? []) {
      names.set(n.id, n.coach_name ?? n.coach_email ?? "Coach");
    }
    const byCoach = new Map<
      string,
      { id: string; scope_match_id: string | null; all_matches: boolean }[]
    >();
    for (const l of (linksRes.data as {
      id: string;
      coach_id: string | null;
      scope_match_id: string | null;
      all_matches: boolean;
    }[]) ?? []) {
      if (!l.coach_id) continue;
      byCoach.set(l.coach_id, [...(byCoach.get(l.coach_id) ?? []), l]);
    }
    const rows: ConnectedCoach[] = [...byCoach.entries()].map(([coachId, links]) => ({
      id: coachId,
      name: links.map((l) => names.get(l.id)).find(Boolean) ?? "Coach",
      allMatches: links.some((l) => l.scope_match_id === null && l.all_matches),
      matchLinkId: links.find((l) => l.scope_match_id === matchId)?.id ?? null,
      otherMatches: links.filter(
        (l) => l.scope_match_id !== null && l.scope_match_id !== matchId,
      ).length,
    }));
    rows.sort((a, b) => a.name.localeCompare(b.name));
    setCoaches(rows);
  }, [userId, matchId]);

  useEffect(() => {
    if (!open) return;
    setScope(matchId ? "match" : "all");
    setLink(null);
    setError(null);
    setCopied(false);
    void loadCoaches();
  }, [open, matchId, loadCoaches]);

  const shareWith = async (coach: ConnectedCoach) => {
    if (!matchId) return;
    setBusyCoach(coach.id);
    const supabase = createClient();
    const { error: dbError } = await supabase.from("coach_links").insert({
      player_id: userId,
      coach_id: coach.id,
      scope_match_id: matchId,
      status: "accepted",
    });
    if (dbError) setError("Couldn't share it. Try again.");
    await loadCoaches();
    setBusyCoach(null);
    onLinkCreated?.();
  };

  const unshareWith = async (coach: ConnectedCoach) => {
    if (!coach.matchLinkId) return;
    setBusyCoach(coach.id);
    const supabase = createClient();
    await supabase.from("coach_links").delete().eq("id", coach.matchLinkId);
    await loadCoaches();
    setBusyCoach(null);
    onLinkCreated?.();
  };

  const coachState = (c: ConnectedCoach) =>
    c.allMatches
      ? "Sees all your matches"
      : c.matchLinkId
        ? "Has this match"
        : c.otherMatches > 0
          ? `Has ${c.otherMatches} other match${c.otherMatches === 1 ? "" : "es"}`
          : "Doesn't have this match";

  const createLink = useCallback(async () => {
    setCreating(true);
    setError(null);
    const supabase = createClient();
    const { data, error: dbError } = await supabase
      .from("coach_links")
      .insert({
        player_id: userId,
        scope_match_id: scope === "match" && matchId ? matchId : null,
        all_matches: scope === "all",
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
        {matchId && coaches && coaches.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Your coaches
            </p>
            <div className="mt-2 divide-y divide-edge/60 overflow-hidden rounded-xl border border-edge bg-surface-2/60">
              {coaches.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-zinc-100">{c.name}</span>
                    <span className="block text-xs text-zinc-500">{coachState(c)}</span>
                  </span>
                  {c.allMatches ? (
                    <span className="text-sm font-medium text-cyan-glow">All matches</span>
                  ) : busyCoach === c.id ? (
                    <span className="text-sm text-zinc-500">…</span>
                  ) : c.matchLinkId ? (
                    <button
                      type="button"
                      onClick={() => void unshareWith(c)}
                      className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void shareWith(c)}
                      className="glow-cta rounded-full bg-cyan-glow px-4 py-1.5 text-sm font-semibold text-ink"
                    >
                      Share
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Sharing hands them this match. Take it back any time from Coaching.
            </p>
            <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Invite another coach
            </p>
          </div>
        )}

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
              {!matchId && (
                <button
                  type="button"
                  aria-pressed={scope === "selected"}
                  onClick={() => setScope("selected")}
                  className={`w-full rounded-xl border p-3.5 text-left transition-colors ${
                    scope === "selected"
                      ? "border-cyan-glow/60 bg-cyan-glow/10"
                      : "border-edge bg-ink/40 hover:border-cyan-glow/40"
                  }`}
                >
                  <p className="text-sm font-semibold text-zinc-100">
                    Only matches I share
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    You share each match from its page. Change this any time.
                  </p>
                </button>
              )}
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
  label = "Share with coach",
}: {
  userId: string;
  matchId?: string;
  onLinkCreated?: () => void;
  buttonClassName?: string;
  label?: string;
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
        {label}
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
