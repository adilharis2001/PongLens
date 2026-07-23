"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Point } from "@/lib/types";

/**
 * The starred-reel affordance on the match page (owner + cut_t0 matches
 * only, rendered when >= 1 visible point is starred).
 *
 * A "Reel" row in the Tools card whose live status follows the reel
 * state — "⭐ N starred · Make a reel", "Rendering…", or "Ready · 0:48"
 * when a rendered reel matches the current stars. Tapping the row opens
 * a minimal bottom sheet: a "Show score" toggle row (only when the match
 * has confirmed winners) and ONE primary button whose label follows the
 * reel state:
 *
 *   "Make reel"         no reel yet, or the stars / score toggle changed
 *   "Rendering…"        queued/rendering (disabled; polls match_reels ~5s
 *                       while the sheet is open)
 *   "Save video · 0:48" ready + fresh — hands the file to the OS share
 *                       sheet where canShare({files}) passes, else
 *                       downloads via the presigned GET
 *
 * All rendering goes through the existing POST /api/reel (manifest + score
 * truth live there); this component only reads match_reels via the
 * owner-scoped RLS select and calls the same endpoints the old share-sheet
 * "Save video" flow used.
 */

interface ReelRow {
  status: string;
  duration_s: number | null;
  show_score: boolean;
  /** starred point ids in timeline order, from the stored manifest */
  pointIds: string[];
}

function fmtDuration(d: number) {
  const s = Math.max(0, Math.round(d));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** One Tools-card row: whole-row tap target, label left, live status right. */
export const TOOL_ROW_CLASS =
  "flex min-h-[3.25rem] w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-ink/30";

export function ReelRow({
  matchId,
  visiblePoints,
  canScore,
}: {
  matchId: string;
  /** timeline-ordered, non-deleted points (the reel is built from these) */
  visiblePoints: Point[];
  /** any confirmed winners? shows the Score toggle when true */
  canScore: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reel, setReel] = useState<ReelRow | null>(null);
  const [showScore, setShowScore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Adopt the stored toggle once, when the row first loads.
  const adoptedShowScore = useRef(false);

  const starred = visiblePoints.filter((p) => p.starred);
  // What /api/reel would put in the manifest right now.
  const starredClipIds = starred
    .filter((p) => p.clip_path)
    .map((p) => p.id);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("match_reels")
      .select("status, duration_s, show_score, manifest")
      .eq("match_id", matchId)
      .maybeSingle();
    if (!data) {
      setReel(null);
      return;
    }
    const manifest = data.manifest as {
      points?: { point_id?: string }[];
    } | null;
    const row: ReelRow = {
      status: String(data.status),
      duration_s: data.duration_s !== null ? Number(data.duration_s) : null,
      show_score: Boolean(data.show_score),
      pointIds: (manifest?.points ?? [])
        .map((p) => String(p.point_id ?? ""))
        .filter(Boolean),
    };
    setReel(row);
    if (!adoptedShowScore.current) {
      adoptedShowScore.current = true;
      setShowScore(row.show_score);
    }
  }, [matchId]);

  // Initial status read: the line can say "Reel ready" without opening
  // the sheet.
  useEffect(() => {
    void load();
  }, [load]);

  // Poll while the sheet is open and a render is in flight.
  const rendering = reel?.status === "queued" || reel?.status === "rendering";
  useEffect(() => {
    if (!open || !rendering) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [open, rendering, load]);

  // Fresh = the stored manifest covers exactly today's starred clips.
  const idsFresh =
    reel !== null &&
    reel.pointIds.length === starredClipIds.length &&
    reel.pointIds.every((id, i) => id === starredClipIds[i]);
  const lineReady = reel?.status === "ready" && idsFresh;
  const effectiveShow = canScore && showScore;
  const saveReady =
    reel?.status === "ready" && idsFresh && reel.show_score === effectiveShow;

  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, showScore: effectiveShow }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.status) throw new Error("no status");

      if (data.status !== "ready") {
        // queued or rendering: the button swaps to "Rendering…" and the
        // poller flips it back when the worker finishes.
        setReel({
          status: String(data.status),
          duration_s: null,
          show_score: effectiveShow,
          pointIds: starredClipIds,
        });
        return;
      }
      setReel({
        status: "ready",
        duration_s:
          data.durationS !== undefined && data.durationS !== null
            ? Number(data.durationS)
            : null,
        show_score: effectiveShow,
        pointIds: starredClipIds,
      });
      const mu = await fetch("/api/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, reel: true }),
      });
      const md = mu.ok ? await mu.json() : null;
      if (!md?.url) throw new Error("no url");
      // Prefer the OS share sheet with the actual file; fall back to a
      // plain download via the presigned GET.
      if (
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function"
      ) {
        try {
          const blob = await (await fetch(md.url)).blob();
          const file = new File([blob], "ponglens-reel.mp4", {
            type: "video/mp4",
          });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file] });
            return;
          }
        } catch (e) {
          // user dismissed the OS sheet: done, don't force a download
          if (e instanceof DOMException && e.name === "AbortError") return;
        }
      }
      window.location.href = md.url;
    } catch {
      setError("Couldn't prepare the video. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, matchId, effectiveShow, starredClipIds]);

  if (starred.length === 0) return null;

  const buttonLabel = busy
    ? "Preparing…"
    : rendering
      ? "Rendering…"
      : saveReady
        ? `Save video${
            reel?.duration_s !== null && reel?.duration_s !== undefined
              ? ` · ${fmtDuration(reel.duration_s)}`
              : ""
          }`
        : "Make reel";

  return (
    // The wrapper div keeps the Tools card's divide-y off the fixed sheet
    // overlay (both would otherwise be direct children of the divide list).
    <div>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
          void load();
        }}
        className={TOOL_ROW_CLASS}
      >
        <span className="text-sm font-semibold">Reel</span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
          {rendering ? (
            <span className="animate-pulse text-cyan-glow/80">Rendering…</span>
          ) : lineReady ? (
            <span className="font-semibold text-emerald-400/90">
              Ready
              {reel?.duration_s !== null && reel?.duration_s !== undefined
                ? ` · ${fmtDuration(reel.duration_s)}`
                : ""}
            </span>
          ) : (
            <>
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5 text-amber-300"
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
              <span className="text-zinc-500">{starred.length} starred</span>
              <span className="text-zinc-600" aria-hidden="true">
                ·
              </span>
              <span className="font-semibold text-cyan-glow">Make a reel</span>
            </>
          )}
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close reel sheet"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-edge bg-surface p-5 pb-8 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                Reel · {starred.length} starred point
                {starred.length === 1 ? "" : "s"}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
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

            <div className="mt-4 space-y-3">
              {canScore && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-ink/40 px-3.5 py-2.5">
                  <span className="text-sm font-semibold text-zinc-200">
                    Show score
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showScore}
                    aria-label="Show score"
                    onClick={() => setShowScore((v) => !v)}
                    className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
                      showScore
                        ? "border-cyan-glow/60 bg-cyan-glow/30"
                        : "border-edge bg-surface-2"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
                        showScore
                          ? "left-6 bg-cyan-glow"
                          : "left-0.5 bg-zinc-500"
                      }`}
                    />
                  </button>
                </div>
              )}
              <button
                type="button"
                disabled={busy || rendering}
                onClick={() => void run()}
                className="glow-cta block w-full rounded-full bg-cyan-glow px-5 py-3 text-center text-sm font-semibold text-ink disabled:opacity-60"
              >
                {buttonLabel}
              </button>
              {rendering && (
                <p className="text-center text-xs text-zinc-500">
                  Rendering — we&apos;ll email you when it&apos;s done.
                </p>
              )}
              {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
