"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Match, Note, Point } from "@/lib/types";
import { ShareWithCoach } from "@/components/ShareWithCoach";
import { NoteComposer, NoteItem } from "./Notes";
import { PointSheet } from "./PointSheet";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function MatchView({
  match,
  initialPoints,
  initialNotes,
  userId,
}: {
  match: Match;
  initialPoints: Point[];
  initialNotes: Note[];
  userId: string;
}) {
  const [points, setPoints] = useState<Point[]>(initialPoints);
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [opponentName, setOpponentName] = useState(match.opponent_name ?? "");
  const [openPointId, setOpenPointId] = useState<string | null>(null);

  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackBody, setFeedbackBody] = useState("");
  const [feedbackState, setFeedbackState] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");

  const isOwner = match.user_id === userId;

  // Opponent name: save on blur / Enter, only when it changed.
  const saveOpponentName = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (trimmed === (match.opponent_name ?? "").trim()) return;
      const supabase = createClient();
      await supabase
        .from("matches")
        .update({ opponent_name: trimmed || null })
        .eq("id", match.id);
      match.opponent_name = trimmed || null;
    },
    [match]
  );

  const download = useCallback(async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch("/api/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: match.id }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.url) throw new Error("no url");
      window.location.href = data.url;
    } catch {
      setDownloadError("Couldn't create a download link. Try again shortly.");
    } finally {
      setDownloading(false);
    }
  }, [match.id]);

  const toggleStar = useCallback(async (point: Point) => {
    const next = !point.starred;
    setPoints((ps) =>
      ps.map((p) => (p.id === point.id ? { ...p, starred: next } : p))
    );
    const supabase = createClient();
    const { error } = await supabase
      .from("points")
      .update({ starred: next })
      .eq("id", point.id);
    if (error) {
      setPoints((ps) =>
        ps.map((p) => (p.id === point.id ? { ...p, starred: !next } : p))
      );
    }
  }, []);

  const sendFeedback = useCallback(async () => {
    const body = feedbackBody.trim();
    if (!body) return;
    setFeedbackState("sending");
    const supabase = createClient();
    const { error } = await supabase.from("feedback").insert({
      user_id: userId,
      match_id: match.id,
      body,
    });
    if (error) {
      setFeedbackState("error");
      return;
    }
    setFeedbackBody("");
    setFeedbackState("sent");
  }, [feedbackBody, userId, match.id]);

  const noteCountByPoint = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) {
      if (n.point_id) map.set(n.point_id, (map.get(n.point_id) ?? 0) + 1);
    }
    return map;
  }, [notes]);

  const matchNotes = notes.filter((n) => n.point_id === null);

  const confirmed = points.filter((p) => p.confirmed_winner !== null);
  const youWon = confirmed.filter((p) => p.confirmed_winner === "user").length;
  const theyWon = confirmed.length - youWon;

  const openPoint = points.find((p) => p.id === openPointId) ?? null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-white"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
        </svg>
        Dashboard
      </Link>

      {/* header */}
      <div className="mt-4">
        {isOwner ? (
          <input
            value={opponentName}
            onChange={(e) => setOpponentName(e.target.value)}
            onBlur={(e) => void saveOpponentName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="vs. who?"
            aria-label="Opponent name"
            className="w-full border-b border-transparent bg-transparent text-2xl font-bold tracking-tight outline-none transition-colors placeholder:text-zinc-600 hover:border-edge focus:border-cyan-glow/60 sm:text-3xl"
          />
        ) : (
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {opponentName || "Match"}
          </h1>
        )}
        <p className="mt-1 text-sm text-zinc-400">
          {formatDate(match.played_at)}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void download()}
            disabled={downloading}
            className="glow-cta rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink disabled:opacity-60"
          >
            {downloading ? "Preparing…" : "Download full video"}
          </button>
          {isOwner && (
            <ShareWithCoach userId={userId} matchId={match.id} />
          )}
          {downloadError && (
            <p className="text-sm text-red-400">{downloadError}</p>
          )}
        </div>
      </div>

      {/* running score, from confirmed points only */}
      {confirmed.length > 0 && (
        <div className="mt-6 rounded-2xl border border-edge bg-surface p-4">
          <p className="text-2xl font-bold tabular-nums tracking-tight">
            {youWon} - {theyWon}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            from {confirmed.length} confirmed point
            {confirmed.length === 1 ? "" : "s"}
          </p>
        </div>
      )}

      {/* point timeline */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Points</h2>
        {points.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            No point breakdown for this match.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {points.map((point) => {
              const duration =
                point.t0 !== null && point.t1 !== null
                  ? Math.max(0, Number(point.t1) - Number(point.t0))
                  : null;
              const noteCount = noteCountByPoint.get(point.id) ?? 0;
              return (
                <li key={point.id}>
                  <div className="flex items-center gap-3 rounded-2xl border border-edge bg-surface p-4 transition-colors hover:border-cyan-glow/40">
                    <button
                      type="button"
                      onClick={() => setOpenPointId(point.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge bg-ink/60 text-sm font-bold text-zinc-300">
                        {point.idx}
                      </span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          {point.server && (
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                                point.server === "user"
                                  ? "border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow"
                                  : "border-magenta-glow/40 bg-magenta-glow/10 text-magenta-soft"
                              }`}
                            >
                              {point.server === "user"
                                ? isOwner
                                  ? "You served"
                                  : "Player served"
                                : isOwner
                                  ? "They served"
                                  : "Opponent served"}
                            </span>
                          )}
                          {point.confirmed_winner && (
                            <span
                              className={`text-[11px] font-medium ${
                                point.confirmed_winner === "user"
                                  ? "text-emerald-400"
                                  : "text-zinc-400"
                              }`}
                            >
                              {point.confirmed_winner === "user"
                                ? isOwner
                                  ? "You won"
                                  : "Player won"
                                : isOwner
                                  ? "They won"
                                  : "Opponent won"}
                            </span>
                          )}
                        </span>
                        <span className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                          {duration !== null && (
                            <span>{duration.toFixed(1)}s</span>
                          )}
                          {noteCount > 0 && (
                            <span>
                              {noteCount} note{noteCount === 1 ? "" : "s"}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                    {!isOwner && point.starred && (
                      <span className="shrink-0 p-2 text-amber-300">
                        <svg
                          viewBox="0 0 24 24"
                          className="h-5 w-5"
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
                    )}
                    {isOwner && (
                    <button
                      type="button"
                      onClick={() => void toggleStar(point)}
                      aria-pressed={point.starred}
                      aria-label={
                        point.starred ? "Remove star" : "Star this point"
                      }
                      className={`shrink-0 rounded-full p-2 transition-colors ${
                        point.starred
                          ? "text-amber-300"
                          : "text-zinc-600 hover:text-zinc-400"
                      }`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-5 w-5"
                        fill={point.starred ? "currentColor" : "none"}
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
                    </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* match-level notes (point_id null): overall takeaways + coach review */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Overall notes</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Notes about the whole match. Type or record a voice note.
        </p>
        {matchNotes.length > 0 && (
          <ul className="mt-4 space-y-3">
            {matchNotes.map((n) => (
              <NoteItem
                key={n.id}
                note={n}
                matchId={match.id}
                ownerId={match.user_id}
                viewerId={userId}
              />
            ))}
          </ul>
        )}
        <div className="mt-4">
          <NoteComposer
            matchId={match.id}
            pointId={null}
            userId={userId}
            placeholder="How did the match go?"
            onNoteAdded={(note) => setNotes((ns) => [...ns, note])}
          />
        </div>
      </section>

      {/* feedback */}
      <div className="mt-12 border-t border-edge/60 pt-6">
        {feedbackState === "sent" ? (
          <p className="text-sm text-emerald-400">
            Thanks. We read every report.
          </p>
        ) : feedbackOpen ? (
          <div>
            <p className="text-sm font-medium text-zinc-300">
              Something wrong with this match?
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Wrong server, missed points, bad cuts. Tell us and we fix the
              pipeline.
            </p>
            <textarea
              value={feedbackBody}
              onChange={(e) => setFeedbackBody(e.target.value)}
              rows={3}
              placeholder="What looks off?"
              className="mt-3 w-full resize-y rounded-lg border border-edge bg-ink/60 px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600"
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                disabled={
                  feedbackState === "sending" ||
                  feedbackBody.trim().length === 0
                }
                onClick={() => void sendFeedback()}
                className="rounded-full bg-cyan-glow px-4 py-1.5 text-sm font-semibold text-ink disabled:opacity-50"
              >
                {feedbackState === "sending" ? "Sending…" : "Send"}
              </button>
              <button
                type="button"
                onClick={() => setFeedbackOpen(false)}
                className="text-sm text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
              {feedbackState === "error" && (
                <p className="text-xs text-red-400">
                  Couldn&apos;t send. Try again.
                </p>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setFeedbackOpen(true)}
            className="text-sm text-zinc-500 underline underline-offset-2 transition-colors hover:text-zinc-300"
          >
            Something wrong with this match?
          </button>
        )}
      </div>

      {openPoint && (
        <PointSheet
          matchId={match.id}
          ownerId={match.user_id}
          point={openPoint}
          notes={notes.filter((n) => n.point_id === openPoint.id)}
          userId={userId}
          onClose={() => setOpenPointId(null)}
          onPointUpdate={(patch) =>
            setPoints((ps) =>
              ps.map((p) => (p.id === openPoint.id ? { ...p, ...patch } : p))
            )
          }
          onNoteAdded={(note) => setNotes((ns) => [...ns, note])}
        />
      )}
    </div>
  );
}
