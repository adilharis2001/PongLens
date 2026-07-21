"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Match, Note, Point } from "@/lib/types";
import { ShareWithCoach } from "@/components/ShareWithCoach";
import { NoteComposer, NoteItem } from "./Notes";
import { PointDetail } from "./PointDetail";
import { PointSheet } from "./PointSheet";
import { PlayerTagging } from "./PlayerTagging";
import { CHIP_TONE, serverChip, type Side } from "./sides";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** lg breakpoint: the split view replaces the sheet from here up. */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

/** Download card: inline preview of the cut plus the download button. */
function DownloadCard({ matchId }: { matchId: string }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/media-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId, preview: true }),
        });
        const data = res.ok ? await res.json() : null;
        if (data?.url && !cancelled) setPreviewUrl(data.url);
      } catch {
        // Preview is optional; the download button still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  const download = useCallback(async () => {
    setDownloading(true);
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
      setDownloading(false);
    }
  }, [matchId]);

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-edge bg-surface sm:max-w-sm">
      {previewUrl ? (
        <video
          src={previewUrl}
          controls
          playsInline
          preload="metadata"
          className="aspect-video w-full bg-black"
        />
      ) : (
        <div className="flex aspect-video items-center justify-center bg-ink">
          <p className="text-xs text-zinc-600">Loading preview…</p>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Full video</p>
          <p className="text-xs text-zinc-500">Dead time removed</p>
        </div>
        <button
          type="button"
          onClick={() => void download()}
          disabled={downloading}
          className="glow-cta shrink-0 rounded-full bg-cyan-glow px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {downloading ? "Preparing…" : "Download"}
        </button>
      </div>
      {error && <p className="px-4 pb-3 text-sm text-red-400">{error}</p>}
    </div>
  );
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
  const [userSide, setUserSide] = useState<Side | null>(match.user_side);
  const [nearName, setNearName] = useState(match.player_near_name ?? "");
  const [farName, setFarName] = useState(match.player_far_name ?? "");
  const [activePointId, setActivePointId] = useState<string | null>(null);

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackBody, setFeedbackBody] = useState("");
  const [feedbackState, setFeedbackState] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");

  const isOwner = match.user_id === userId;
  const isDesktop = useIsDesktop();

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

  // Desktop always shows a point in the pane (default: the first).
  // Mobile opens the sheet only after a tap.
  const selectedPoint = points.find((p) => p.id === activePointId) ?? null;
  const panePoint = selectedPoint ?? points[0] ?? null;
  const paneIndex = panePoint
    ? points.findIndex((p) => p.id === panePoint.id)
    : -1;

  const goToIndex = useCallback(
    (i: number) => {
      if (i < 0 || i >= points.length) return;
      const id = points[i].id;
      setActivePointId(id);
      document
        .getElementById(`point-card-${id}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    [points]
  );

  // Desktop arrow-key navigation between points.
  useEffect(() => {
    if (!isDesktop || points.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const next = e.key === "ArrowDown" || e.key === "ArrowRight";
      const prev = e.key === "ArrowUp" || e.key === "ArrowLeft";
      if (!next && !prev) return;
      const t = e.target as HTMLElement | null;
      if (
        t?.closest(
          'input, textarea, select, video, audio, [contenteditable="true"]'
        )
      )
        return;
      e.preventDefault();
      goToIndex(paneIndex + (next ? 1 : -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDesktop, points.length, paneIndex, goToIndex]);

  const updatePoint = useCallback((pointId: string, patch: Partial<Point>) => {
    setPoints((ps) =>
      ps.map((p) => (p.id === pointId ? { ...p, ...patch } : p))
    );
  }, []);

  const onTaggingChange = useCallback(
    (patch: {
      userSide?: Side;
      nearName?: string;
      farName?: string;
      opponentName?: string;
    }) => {
      if (patch.userSide !== undefined) setUserSide(patch.userSide);
      if (patch.nearName !== undefined) setNearName(patch.nearName);
      if (patch.farName !== undefined) setFarName(patch.farName);
      if (patch.opponentName !== undefined) {
        setOpponentName(patch.opponentName);
        match.opponent_name = patch.opponentName;
      }
    },
    [match]
  );

  const winnerText = (p: Point) =>
    p.confirmed_winner === "user"
      ? isOwner
        ? "You won"
        : "Player won"
      : isOwner
        ? "They won"
        : "Opponent won";

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12 lg:max-w-6xl">
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

        <div className="mt-4 flex flex-wrap items-start gap-3">
          <DownloadCard matchId={match.id} />
          {isOwner && <ShareWithCoach userId={userId} matchId={match.id} />}
        </div>
      </div>

      {/* player tagging: who is who? */}
      {isOwner && points.length > 0 && (
        <PlayerTagging
          matchId={match.id}
          firstPointId={points[0]?.id ?? null}
          userSide={userSide}
          nearName={nearName}
          farName={farName}
          onChange={onTaggingChange}
        />
      )}

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

      {/* split view on lg+: point list left, sticky detail pane right */}
      <div className="lg:grid lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:items-start lg:gap-8">
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
                const chip = point.server
                  ? serverChip(point.server, userSide, isOwner)
                  : null;
                const isActive = isDesktop && panePoint?.id === point.id;
                return (
                  <li key={point.id} id={`point-card-${point.id}`}>
                    <div
                      className={`flex items-center gap-3 rounded-2xl border bg-surface p-4 transition-colors ${
                        isActive
                          ? "border-cyan-glow/60"
                          : "border-edge hover:border-cyan-glow/40"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActivePointId(point.id)}
                        aria-current={isActive || undefined}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge bg-ink/60 text-sm font-bold text-zinc-300">
                          {point.idx}
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            {chip && (
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${CHIP_TONE[chip.tone]}`}
                              >
                                {chip.label}
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
                                {winnerText(point)}
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

        {/* desktop detail pane */}
        {isDesktop && panePoint && (
          <aside className="sticky top-20 mt-8 hidden max-h-[calc(100vh-6rem)] overflow-y-auto rounded-2xl border border-edge bg-surface p-5 lg:block">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold">
                Point {panePoint.idx}
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  {paneIndex + 1} of {points.length}
                </span>
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => goToIndex(paneIndex - 1)}
                  disabled={paneIndex <= 0}
                  aria-label="Previous point"
                  title="Previous point (arrow keys work too)"
                  className="rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-40"
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
                      d="m15 6-6 6 6 6"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => goToIndex(paneIndex + 1)}
                  disabled={paneIndex >= points.length - 1}
                  aria-label="Next point"
                  title="Next point (arrow keys work too)"
                  className="rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-40"
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
                      d="m9 6 6 6-6 6"
                    />
                  </svg>
                </button>
              </div>
            </div>
            <PointDetail
              key={panePoint.id}
              matchId={match.id}
              ownerId={match.user_id}
              point={panePoint}
              notes={notes.filter((n) => n.point_id === panePoint.id)}
              userId={userId}
              userSide={userSide}
              onPointUpdate={(patch) => updatePoint(panePoint.id, patch)}
              onNoteAdded={(note) => setNotes((ns) => [...ns, note])}
            />
          </aside>
        )}
      </div>

      {/* match-level notes (point_id null): overall takeaways + coach review */}
      <section className="mt-10 lg:max-w-2xl">
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

      {/* feedback: owner only (coaches report through their own matches) */}
      {isOwner && (
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
      )}

      {/* mobile point sheet */}
      {!isDesktop && selectedPoint && (
        <PointSheet
          matchId={match.id}
          ownerId={match.user_id}
          point={selectedPoint}
          notes={notes.filter((n) => n.point_id === selectedPoint.id)}
          userId={userId}
          userSide={userSide}
          index={points.findIndex((p) => p.id === selectedPoint.id)}
          total={points.length}
          onClose={() => setActivePointId(null)}
          onPrev={() =>
            goToIndex(points.findIndex((p) => p.id === selectedPoint.id) - 1)
          }
          onNext={() =>
            goToIndex(points.findIndex((p) => p.id === selectedPoint.id) + 1)
          }
          onPointUpdate={(patch) => updatePoint(selectedPoint.id, patch)}
          onNoteAdded={(note) => setNotes((ns) => [...ns, note])}
        />
      )}
    </div>
  );
}
