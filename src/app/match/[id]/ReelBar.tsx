"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Point } from "@/lib/types";

/**
 * The Export affordance on the match page (owner + cut_t0 matches only).
 * An "Export" row in the Tools card opens ONE consolidated sheet listing
 * every downloadable artifact:
 *
 *   Full match   the playtime (cut) video. "Show score" OFF is a plain cut
 *                download (the same /api/media-url link the video card's ↓
 *                shortcut uses); ON renders the full match with the running
 *                scorebug (POST /api/reel scope='full').
 *   Starred      the starred-points export (POST /api/reel scope='starred').
 *                A muted teaching row at zero stars, like before.
 *   Raw match    the original upload — ONLY while the 7-day raw retention
 *                still holds it (probed via /api/media-url { raw }); the row
 *                hides itself entirely when the upload is gone.
 *
 * Rendered artifacts (full-with-score, starred) go through the existing
 * render pipeline: the manifest + score truth live in /api/reel, the Mac
 * worker renders and emails the owner when it's done, and this component
 * polls match_reels (owner-scoped RLS select) while a render is in flight.
 * Ready artifacts hand the file to the OS share sheet where canShare({files})
 * passes, else download via the presigned GET. Plain passthrough downloads
 * (cut-no-score, raw) redirect to the attachment link, matching the video
 * card's ↓ shortcut. The file names for the internal DB table (match_reels),
 * the /api/reel route and the ReelRow/ReelBar identifiers stay "reel" — only
 * the user-facing copy says "Export".
 */

const REEL_POLL_MS = 5000;

/** One export's render state, from the stored match_reels row for its scope. */
interface ReelState {
  status: string;
  duration_s: number | null;
  show_score: boolean;
  /** point ids in timeline order, from the stored manifest */
  pointIds: string[];
}

function fmtDuration(d: number) {
  const s = Math.max(0, Math.round(d));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** One Tools-card row: whole-row tap target, label left, live status right. */
export const TOOL_ROW_CLASS =
  "flex min-h-[3.25rem] w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-ink/30";

/** Muted trailing chevron: every Tools row ends with one, so the rows
 *  read as tappable (status text alone didn't). */
export function ToolRowChevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0 text-zinc-600"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
    </svg>
  );
}

/** Native file-share of a rendered export: fetch the presigned URL, hand the
 *  blob to the OS share sheet where canShare({files}) passes, else download.
 *  Shared by the Full-match-with-score and Starred rows. */
async function shareOrDownloadReel(matchId: string, scope: "starred" | "full") {
  const mu = await fetch("/api/media-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId, reel: true, scope }),
  });
  const md = mu.ok ? await mu.json() : null;
  if (!md?.url) throw new Error("no url");
  if (
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function"
  ) {
    try {
      const blob = await (await fetch(md.url)).blob();
      const file = new File([blob], "ponglens-export.mp4", {
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
}

/** Compact "Show score" switch, matching the app's cyan toggle. */
function ScoreToggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-edge/70 bg-ink/30 px-3 py-2">
      <span className="text-xs font-medium text-zinc-300">Show score</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Show score"
        onClick={onToggle}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
          on ? "border-cyan-glow/60 bg-cyan-glow/30" : "border-edge bg-surface-2"
        }`}
      >
        <span
          className={`absolute top-0.5 h-[1.125rem] w-[1.125rem] rounded-full transition-all ${
            on ? "left-5 bg-cyan-glow" : "left-0.5 bg-zinc-500"
          }`}
        />
      </button>
    </div>
  );
}

/** One artifact row in the Export sheet. */
function ExportRow({
  title,
  subtitle,
  accent,
  children,
}: {
  title: string;
  subtitle: React.ReactNode;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-3.5 ${
        accent ? "border-cyan-glow/30 bg-cyan-glow/5" : "border-edge bg-ink/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-100">{title}</p>
          <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
        </div>
      </div>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

const primaryBtn =
  "glow-cta block w-full rounded-full bg-cyan-glow px-5 py-2.5 text-center text-sm font-semibold text-ink disabled:opacity-60";
const quietBtn =
  "block w-full rounded-full border border-edge bg-surface-2 px-5 py-2.5 text-center text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50 disabled:opacity-60";

export function ReelRow({
  matchId,
  visiblePoints,
  canScore,
}: {
  matchId: string;
  /** timeline-ordered, non-deleted points (exports are built from these) */
  visiblePoints: Point[];
  /** any confirmed winners? shows the Score toggles when true */
  canScore: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Render state per scope, keyed off the stored match_reels rows.
  const [starredReel, setStarredReel] = useState<ReelState | null>(null);
  const [fullReel, setFullReel] = useState<ReelState | null>(null);
  const [showScoreStarred, setShowScoreStarred] = useState(true);
  const [showScoreFull, setShowScoreFull] = useState(true);
  const adopted = useRef(false);
  // Which artifact is mid-request (button-local busy). null = idle.
  const [busy, setBusy] = useState<"starred" | "full" | "cut" | "raw" | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  // Raw availability: null = probing, false = gone (hide row), true = present.
  const [rawAvailable, setRawAvailable] = useState<boolean | null>(null);

  const starred = visiblePoints.filter((p) => p.starred);
  // What /api/reel would put in each manifest right now.
  const starredIds = starred.filter((p) => p.clip_path).map((p) => p.id);
  const fullIds = visiblePoints.filter((p) => p.clip_path).map((p) => p.id);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("match_reels")
      .select("scope, status, duration_s, show_score, manifest")
      .eq("match_id", matchId);
    const byScope = new Map<string, ReelState>();
    for (const d of data ?? []) {
      const manifest = d.manifest as { points?: { point_id?: string }[] } | null;
      byScope.set(String(d.scope), {
        status: String(d.status),
        duration_s: d.duration_s !== null ? Number(d.duration_s) : null,
        show_score: Boolean(d.show_score),
        pointIds: (manifest?.points ?? [])
          .map((p) => String(p.point_id ?? ""))
          .filter(Boolean),
      });
    }
    const s = byScope.get("starred") ?? null;
    const f = byScope.get("full") ?? null;
    setStarredReel(s);
    setFullReel(f);
    // Adopt the stored toggles once, when the rows first load.
    if (!adopted.current && (s || f)) {
      adopted.current = true;
      if (s) setShowScoreStarred(s.show_score);
      if (f) setShowScoreFull(f.show_score);
    }
  }, [matchId]);

  // Initial status read: the collapsed row can say "Rendering…" / "Ready"
  // without opening the sheet.
  useEffect(() => {
    void load();
  }, [load]);

  const starredRendering =
    starredReel?.status === "queued" || starredReel?.status === "rendering";
  const fullRendering =
    fullReel?.status === "queued" || fullReel?.status === "rendering";
  const anyRendering = starredRendering || fullRendering;

  // Poll while the sheet is open and a render is in flight (either scope).
  useEffect(() => {
    if (!open || !anyRendering) return;
    const timer = window.setInterval(() => void load(), REEL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, anyRendering, load]);

  // Probe raw availability when the sheet opens (the object may have aged
  // out of the 7-day retention).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setRawAvailable(null);
    (async () => {
      try {
        const res = await fetch("/api/media-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId, raw: true }),
        });
        const data = res.ok ? await res.json() : null;
        if (alive) setRawAvailable(Boolean(data?.available));
      } catch {
        if (alive) setRawAvailable(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, matchId]);

  // Freshness per scope: the stored manifest covers exactly today's ids.
  const idsFresh = (reel: ReelState | null, ids: string[]) =>
    reel !== null &&
    reel.pointIds.length === ids.length &&
    reel.pointIds.every((id, i) => id === ids[i]);
  const starredFresh = idsFresh(starredReel, starredIds);
  const fullFresh = idsFresh(fullReel, fullIds);

  const effShowStarred = canScore && showScoreStarred;
  const effShowFull = canScore && showScoreFull;
  const starredSaveReady =
    starredReel?.status === "ready" &&
    starredFresh &&
    starredReel.show_score === effShowStarred;
  const fullSaveReady =
    fullReel?.status === "ready" &&
    fullFresh &&
    fullReel.show_score === effShowFull;

  // Render (or re-render) an export, then hand it off. Shared by the
  // starred row and the full-with-score row.
  const runRender = useCallback(
    async (scope: "starred" | "full", showScore: boolean) => {
      if (busy) return;
      setBusy(scope);
      setError(null);
      try {
        const res = await fetch("/api/reel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId, scope, showScore }),
        });
        const data = res.ok ? await res.json() : null;
        if (!data?.status) throw new Error("no status");
        const ids = scope === "full" ? fullIds : starredIds;
        if (data.status !== "ready") {
          const next: ReelState = {
            status: String(data.status),
            duration_s: null,
            show_score: showScore,
            pointIds: ids,
          };
          if (scope === "full") setFullReel(next);
          else setStarredReel(next);
          return;
        }
        const next: ReelState = {
          status: "ready",
          duration_s:
            data.durationS !== undefined && data.durationS !== null
              ? Number(data.durationS)
              : null,
          show_score: showScore,
          pointIds: ids,
        };
        if (scope === "full") setFullReel(next);
        else setStarredReel(next);
        await shareOrDownloadReel(matchId, scope);
      } catch {
        setError("Couldn't prepare the video. Try again.");
      } finally {
        setBusy(null);
      }
    },
    [busy, matchId, fullIds, starredIds]
  );

  // Plain passthrough download (cut-no-score / raw): redirect to the
  // attachment link, matching the video card's ↓ shortcut.
  const runDownload = useCallback(
    async (kind: "cut" | "raw") => {
      if (busy) return;
      setBusy(kind);
      setError(null);
      try {
        const res = await fetch("/api/media-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            kind === "raw" ? { matchId, raw: true } : { matchId }
          ),
        });
        const data = res.ok ? await res.json() : null;
        if (!data?.url) throw new Error("no url");
        window.location.href = data.url;
      } catch {
        setError("Couldn't create a download link. Try again shortly.");
      } finally {
        setBusy(null);
      }
    },
    [busy, matchId]
  );

  // Collapsed Tools-row status: rendering wins, else a ready hint, else the
  // starred count as a gentle nudge.
  const lineReadyStarred = starredReel?.status === "ready" && starredFresh;
  const lineReadyFull = fullReel?.status === "ready" && fullFresh;

  const fullBtnLabel =
    busy === "full"
      ? "Preparing…"
      : effShowFull
        ? fullRendering
          ? "Rendering…"
          : fullSaveReady
            ? `Save video${
                fullReel?.duration_s != null
                  ? ` · ${fmtDuration(fullReel.duration_s)}`
                  : ""
              }`
            : "Make video"
        : busy === "cut"
          ? "Preparing…"
          : "Download";

  const starredBtnLabel =
    busy === "starred"
      ? "Preparing…"
      : starredRendering
        ? "Rendering…"
        : starredSaveReady
          ? `Save video${
              starredReel?.duration_s != null
                ? ` · ${fmtDuration(starredReel.duration_s)}`
                : ""
            }`
          : "Make video";

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
        <span className="text-sm font-semibold">Export</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
            {anyRendering ? (
              <span className="animate-pulse text-cyan-glow/80">Rendering…</span>
            ) : lineReadyFull || lineReadyStarred ? (
              <span className="font-semibold text-emerald-400/90">Ready</span>
            ) : starred.length > 0 ? (
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
              </>
            ) : (
              <span className="text-zinc-500">Video &amp; clips</span>
            )}
          </span>
          <ToolRowChevron />
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close export sheet"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border border-edge bg-surface p-5 pb-8 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Export</h2>
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
            <p className="mt-1 text-sm text-zinc-400">
              Download or share the match, your starred points, or the raw
              upload.
            </p>

            <div className="mt-4 space-y-3">
              {/* Full match — plain cut (score off) or a rendered full-match
                  video with the running scorebug (score on). */}
              <ExportRow
                title="Full match"
                accent
                subtitle={
                  effShowFull
                    ? fullRendering
                      ? "Rendering the scorebug — we'll email you"
                      : fullSaveReady
                        ? "With scorebug · ready"
                        : "Whole match with the running score"
                    : "The playtime video"
                }
              >
                {canScore && (
                  <ScoreToggle
                    on={showScoreFull}
                    onToggle={() => setShowScoreFull((v) => !v)}
                  />
                )}
                <button
                  type="button"
                  disabled={busy !== null || (effShowFull && fullRendering)}
                  onClick={() =>
                    effShowFull
                      ? void runRender("full", effShowFull)
                      : void runDownload("cut")
                  }
                  className={effShowFull ? primaryBtn : quietBtn}
                >
                  {fullBtnLabel}
                </button>
              </ExportRow>

              {/* Starred points — the existing starred export. Muted teaching
                  row at zero stars. */}
              {starred.length > 0 ? (
                <ExportRow
                  title={`Starred points (${starred.length})`}
                  subtitle={
                    starredRendering
                      ? "Rendering — we'll email you"
                      : starredSaveReady
                        ? "Ready"
                        : "Your starred rallies, in order"
                  }
                >
                  {canScore && (
                    <ScoreToggle
                      on={showScoreStarred}
                      onToggle={() => setShowScoreStarred((v) => !v)}
                    />
                  )}
                  <button
                    type="button"
                    disabled={busy !== null || starredRendering}
                    onClick={() => void runRender("starred", effShowStarred)}
                    className={primaryBtn}
                  >
                    {starredBtnLabel}
                  </button>
                </ExportRow>
              ) : (
                <div className="rounded-xl border border-edge bg-ink/40 p-3.5">
                  <p className="text-sm font-semibold text-zinc-500">
                    Starred points
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-600">
                    Star points to export them
                  </p>
                </div>
              )}

              {/* Raw upload — only while the 7-day retention still holds it. */}
              {rawAvailable && (
                <ExportRow
                  title="Raw match"
                  subtitle="Your original upload, uncut"
                >
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void runDownload("raw")}
                    className={quietBtn}
                  >
                    {busy === "raw" ? "Preparing…" : "Download"}
                  </button>
                </ExportRow>
              )}

              {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
