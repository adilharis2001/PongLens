"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Match, Note, NoteFeedRow } from "@/lib/types";
import { deriveMatchTitleParts, shortDate } from "@/lib/matchTitle";
import { NoteComposer } from "@/app/match/[id]/Notes";

/**
 * Compose a note from Improve: pick a match, write (or speak) the note.
 * It lands as a MATCH-LEVEL note — the same row the match page's "Overall
 * notes" thread shows — so nothing new is invented, the note just gets a
 * second front door. Point-level notes keep living where the point is.
 */
export function ComposeNote({
  open,
  onClose,
  userId,
  accountName,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  /** Viewer's account first name — feeds neutral-match title detection. */
  accountName: string | null;
  /** The created note plus its match's title atoms, feed-row shaped. */
  onAdded: (row: NoteFeedRow) => void;
}) {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [matchId, setMatchId] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setMatchId("");
    const supabase = createClient();
    // RLS: own matches plus coach-shared ones — anywhere the viewer may
    // write notes.
    void supabase
      .from("matches")
      .select("*")
      .order("played_at", { ascending: false })
      .then(({ data }) => {
        const rows = (data ?? []) as Match[];
        setMatches(rows);
        if (rows.length > 0) setMatchId(rows[0].id);
      });
  }, [open]);

  const titleFor = useMemo(() => {
    return (m: Match) => {
      const own = m.user_id === userId;
      const ownSide = (
        (m.user_side === "far" ? m.player_far_name : m.player_near_name) ?? ""
      ).trim();
      const acct = (accountName ?? "").trim().toLowerCase();
      const neutral =
        own && ownSide !== "" && (acct === "" || ownSide.toLowerCase() !== acct);
      return deriveMatchTitleParts({
        opponentName: m.opponent_name,
        venue: m.venue,
        playedAt: m.played_at,
        neutral,
        nameA: ownSide,
        nameB: (m.opponent_name ?? "").trim(),
      }).primary;
    };
  }, [userId, accountName]);

  if (!open) return null;

  const selected = (matches ?? []).find((m) => m.id === matchId) ?? null;

  const noteAdded = (note: Note) => {
    if (!selected) return;
    onAdded({
      id: note.id,
      match_id: note.match_id,
      point_id: note.point_id,
      author_id: note.author_id,
      body: note.body,
      audio_path: note.audio_path,
      created_at: note.created_at,
      author_name: null, // the viewer's own notes render as "You"
      match_owner_id: selected.user_id,
      opponent_name: selected.opponent_name,
      venue: selected.venue,
      played_at: selected.played_at,
      user_side: selected.user_side,
      player_near_name: selected.player_near_name,
      player_far_name: selected.player_far_name,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
      />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-edge bg-surface p-5 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">New note</h2>
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
          A match note, from here. It shows on the match page too.
        </p>

        {matches === null ? (
          <div className="mt-4 h-24 animate-pulse rounded-xl border border-edge bg-surface-2/40" />
        ) : matches.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">
            Notes attach to a match. Upload one first.
          </p>
        ) : (
          <>
            <select
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              aria-label="Match"
              className="mt-4 w-full rounded-xl border border-edge bg-surface-2/40 px-3.5 py-2.5 text-sm text-zinc-100 focus:border-cyan-glow/60 focus:outline-none"
            >
              {matches.map((m) => (
                <option key={m.id} value={m.id}>
                  {titleFor(m)} · {shortDate(m.played_at)}
                </option>
              ))}
            </select>
            {selected && (
              <div className="mt-3">
                <NoteComposer
                  key={selected.id}
                  matchId={selected.id}
                  pointId={null}
                  userId={userId}
                  placeholder="What do you want to remember?"
                  onNoteAdded={noteAdded}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
