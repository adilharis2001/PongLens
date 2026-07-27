"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Lesson, Match, Note, NoteFeedRow } from "@/lib/types";
import { deriveMatchTitleParts, shortDate } from "@/lib/matchTitle";
import { NoteComposer } from "@/app/match/[id]/Notes";

/**
 * Compose from Improve: pick a match and write (or speak) a note — the
 * same match-level row the match page's "Overall notes" thread shows —
 * or pick "A lesson" and paste anything long: a coaching-session
 * transcript, a coach's voice-memo dump. Lessons get distilled into
 * grouped takeaways (/api/lesson) and keep their raw text attached.
 */
export function ComposeNote({
  open,
  onClose,
  userId,
  accountName,
  onAdded,
  onLessonAdded,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  /** Viewer's account first name — feeds neutral-match title detection. */
  accountName: string | null;
  /** The created note plus its match's title atoms, feed-row shaped. */
  onAdded: (row: NoteFeedRow) => void;
  onLessonAdded: (lesson: Lesson) => void;
}) {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [matchId, setMatchId] = useState<string>("");
  const [lessonText, setLessonText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMatchId("");
    setLessonText("");
    setSaving(false);
    setError(null);
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
        setMatchId(rows.length > 0 ? rows[0].id : "lesson");
      });
  }, [open]);

  const saveLesson = async () => {
    const transcript = lessonText.trim();
    if (!transcript || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.id) throw new Error("no id");
      onLessonAdded({
        id: data.id,
        user_id: userId,
        match_id: null,
        transcript,
        takeaways: data.takeaways ?? null,
        status: data.status === "ready" ? "ready" : "failed",
        created_at: new Date().toISOString(),
      });
      onClose();
    } catch {
      setError("Couldn't save it. Your text is still here — try again.");
    } finally {
      setSaving(false);
    }
  };

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
          {matchId === "lesson"
            ? "Paste a coaching transcript or write anything long. You get the takeaways; the full text stays."
            : "A match note, from here. It shows on the match page too."}
        </p>

        {matches === null ? (
          <div className="mt-4 h-24 animate-pulse rounded-xl border border-edge bg-surface-2/40" />
        ) : (
          <>
            <select
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              aria-label="What is this about?"
              className="mt-4 w-full rounded-xl border border-edge bg-surface-2/40 px-3.5 py-2.5 text-sm text-zinc-100 focus:border-cyan-glow/60 focus:outline-none"
            >
              {matches.map((m) => (
                <option key={m.id} value={m.id}>
                  {titleFor(m)} · {shortDate(m.played_at)}
                </option>
              ))}
              <option value="lesson">A lesson · not tied to a match</option>
            </select>
            {matchId === "lesson" ? (
              <div className="mt-3">
                <textarea
                  value={lessonText}
                  onChange={(e) => setLessonText(e.target.value)}
                  placeholder="Paste the transcript here"
                  aria-label="Lesson text"
                  className="min-h-44 w-full resize-y rounded-xl border border-edge bg-surface-2/40 px-3.5 py-2.5 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void saveLesson()}
                  disabled={saving || lessonText.trim() === ""}
                  className="glow-cta mt-3 block w-full rounded-full bg-cyan-glow px-5 py-3 text-center text-sm font-semibold text-ink disabled:opacity-60"
                >
                  {saving ? "Reading the session…" : "Save lesson"}
                </button>
                {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
              </div>
            ) : selected ? (
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
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
