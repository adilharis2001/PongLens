"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { deriveMatchTitleParts } from "@/lib/matchTitle";

/**
 * Share several matches with one coach at once.
 *
 * The match page's sheet (ShareWithCoach) answers "who should have THIS
 * match?", one coach at a time. Standing on a coach's page the question is
 * the other way round — "which of my matches should Jonathan have?" — and
 * the sheet answers that one match at a time, which means walking the
 * library and opening a sheet on every row.
 *
 * Nothing new is written. A connected coach gets the accepted,
 * match-scoped `coach_links` row the sheet writes; a coach who has not
 * accepted yet gets the `coach_invite_matches` row, which becomes access
 * only when they accept (166). Matches they already hold are left out of
 * the list rather than granted twice.
 */

interface MatchRow {
  id: string;
  opponent_name: string | null;
  venue: string | null;
  played_at: string;
}

/** How many rows before the list folds. Six fits a 393px phone under the
 *  list it sits below; the rest are one tap away. */
const PREVIEW = 6;

export function ShareMatches({
  userId,
  coachId,
  inviteId,
  onShared,
}: {
  userId: string;
  /** The coach's account, when they have accepted. */
  coachId: string | null;
  /** Their waiting invite, when they have not. */
  inviteId: string | null;
  onShared: () => void;
}) {
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [held, setHeld] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [matchRes, grantRes, inviteRes] = await Promise.all([
      supabase
        .from("matches")
        .select("id, opponent_name, venue, played_at")
        .eq("user_id", userId)
        // A match still being processed has nothing to watch yet, so
        // offering it would hand over an empty page.
        .eq("status", "ready")
        .order("played_at", { ascending: false })
        .limit(60),
      coachId
        ? supabase
            .from("coach_links")
            .select("scope_match_id")
            .eq("player_id", userId)
            .eq("coach_id", coachId)
            .eq("status", "accepted")
            .not("scope_match_id", "is", null)
        : inviteId
          ? supabase
              .from("coach_invite_matches")
              .select("match_id")
              .eq("invite_id", inviteId)
          : Promise.resolve({ data: [] }),
      // An invite written from a match page already carries that one match
      // in its own scope rather than in the queue, and the queue's primary
      // key is (invite, match) — so without this the one match they can
      // already see is the one offer that fails.
      inviteId
        ? supabase
            .from("coach_links")
            .select("scope_match_id")
            .eq("id", inviteId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setMatches((matchRes.data as MatchRow[]) ?? []);
    setHeld(
      new Set(
        [
          ...(((grantRes.data as
            | { scope_match_id?: string | null; match_id?: string }[]
            | null) ?? []).map((r) => r.scope_match_id ?? r.match_id)),
          (inviteRes.data as { scope_match_id: string | null } | null)
            ?.scope_match_id,
        ].filter((id): id is string => Boolean(id)),
      ),
    );
  }, [userId, coachId, inviteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const share = useCallback(async () => {
    const ids = [...picked];
    if (ids.length === 0 || (!coachId && !inviteId)) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: dbError } = coachId
      ? await supabase.from("coach_links").insert(
          ids.map((id) => ({
            player_id: userId,
            coach_id: coachId,
            scope_match_id: id,
            status: "accepted",
          })),
        )
      : await supabase
          .from("coach_invite_matches")
          .insert(ids.map((id) => ({ invite_id: inviteId, match_id: id })));
    setSaving(false);
    if (dbError) {
      setError(
        ids.length === 1
          ? "Couldn't share it. Try again."
          : "Couldn't share them. Try again.",
      );
      return;
    }
    setPicked(new Set());
    setOpen(false);
    await load();
    onShared();
  }, [picked, coachId, inviteId, userId, load, onShared]);

  // A coach the player only wrote down has neither an account to grant to
  // nor an invite to queue against, so there is nothing this control could
  // write. The caller keeps it off that page; this is the second lock.
  if (matches === null || (!coachId && !inviteId)) return null;

  const available = matches.filter((m) => !held.has(m.id));

  if (available.length === 0) {
    return (
      <p className="mt-3 text-sm text-zinc-500">
        {matches.length === 0
          ? "No matches to share yet."
          : "They have all your matches."}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 rounded-full border border-edge bg-surface-2 px-4 py-1.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white"
      >
        Share a match
      </button>
    );
  }

  const shown = showAll ? available : available.slice(0, PREVIEW);

  return (
    <div className="mt-3">
      {inviteId && (
        <p className="text-sm text-zinc-400">
          They get these the moment they accept your invite.
        </p>
      )}
      <div className="mt-2 divide-y divide-edge/60 overflow-hidden rounded-xl border border-edge bg-surface-2/40">
        {shown.map((m) => {
          const parts = deriveMatchTitleParts({
            opponentName: m.opponent_name,
            venue: m.venue,
            playedAt: m.played_at,
          });
          const on = picked.has(m.id);
          return (
            <button
              key={m.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={saving}
              onClick={() =>
                setPicked((prev) => {
                  const next = new Set(prev);
                  if (next.has(m.id)) next.delete(m.id);
                  else next.add(m.id);
                  return next;
                })
              }
              className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2 disabled:cursor-default"
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                  on
                    ? "border-cyan-glow bg-cyan-glow text-ink"
                    : "border-edge text-transparent"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m5 13 4 4 10-10"
                  />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-zinc-200">
                  {parts.primary}
                </span>
                <span className="block truncate text-xs text-zinc-500">
                  {parts.secondary}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {available.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-1.5 text-sm font-medium text-cyan-glow"
        >
          {showAll ? "Show fewer" : `Show all ${available.length} matches`}
        </button>
      )}

      <p className="mt-3 text-sm text-zinc-400">
        {picked.size === 0
          ? "Nothing selected."
          : `${picked.size} ${picked.size === 1 ? "match" : "matches"} selected.`}
      </p>

      {/* Full width and stacked on a phone, content width from sm up — the
          approved baseline for a form's actions. */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={() => void share()}
          disabled={saving || picked.size === 0}
          className="glow-cta flex min-h-11 w-full items-center justify-center rounded-full bg-cyan-glow px-5 text-sm font-semibold text-ink disabled:opacity-60 sm:min-h-0 sm:w-auto sm:py-2"
        >
          {saving ? "Sharing…" : "Share"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPicked(new Set());
            setError(null);
          }}
          disabled={saving}
          className="flex min-h-11 w-full items-center justify-center rounded-full border border-edge px-5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-60 sm:min-h-0 sm:w-auto sm:py-2"
        >
          Cancel
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
