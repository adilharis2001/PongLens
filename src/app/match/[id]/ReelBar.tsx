"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { downloadReel, triggerDownload } from "@/lib/download";
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
 *   Tags         one row per tag with tagged clip-bearing points (036):
 *                that collection rendered like starred (scope 'tag:<id>').
 *   Raw match    the original upload — ONLY while the 30-day raw retention
 *                still holds it (probed via /api/media-url { raw }); the row
 *                hides itself entirely when the upload is gone.
 *
 * Rendered artifacts (full-with-score, starred) go through the existing
 * render pipeline: the manifest + score truth live in /api/reel, the Mac
 * worker renders and emails the owner when it's done, and this component
 * polls match_reels (owner-scoped RLS select) while a render is in flight.
 * Everything ready — rendered or passthrough — downloads through the same
 * presigned attachment link. The file names for the internal DB table (match_reels),
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
  "flex min-h-[3.25rem] w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-ink/30 lg:rounded-xl lg:border lg:border-edge lg:bg-surface lg:hover:border-cyan-glow/40 lg:hover:bg-surface-2";

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

/**
 * Save means save.
 *
 * This used to hand the rendered file to the OS share sheet whenever
 * canShare({files}) passed — which on a phone is every time. "Save · 0:32"
 * opened AirDrop / Messages / Mail and offered no way to simply put the
 * video on the device. Sharing a match already has its own door, the Share
 * row, which sends a link rather than 36 MB of video.
 */

/** The app's cyan switch, label-less (the row already names it). */
function Switch({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
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
  );
}

/** Compact download-icon action (plain passthrough downloads). */
function DownloadAction({
  onClick,
  busy,
  disabled,
}: {
  onClick: () => void;
  busy: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      aria-label="Download"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-50"
    >
      {busy ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent" />
      ) : (
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
            d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"
          />
        </svg>
      )}
    </button>
  );
}

/** Compact render action: a small cyan pill (Make / Save · 0:48), or a
 *  muted "Rendering…" while the worker is busy. */
function RenderAction({
  label,
  onClick,
  rendering,
  disabled,
}: {
  label: string;
  onClick: () => void;
  rendering: boolean;
  disabled?: boolean;
}) {
  if (rendering) {
    return (
      <span className="shrink-0 animate-pulse text-xs font-medium text-cyan-glow/80">
        Rendering…
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 rounded-full bg-cyan-glow px-3.5 py-1.5 text-xs font-semibold text-ink transition-opacity disabled:opacity-50"
    >
      {label}
    </button>
  );
}

/** One export row in the divided list: label + subtitle left, action right. */
function ExportRow({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-zinc-100">{title}</p>
        <p className="mt-0.5 truncate text-xs text-zinc-500">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export function ReelRow({
  matchId,
  visiblePoints,
  canScore,
  tagOptions,
}: {
  matchId: string;
  /** timeline-ordered, non-deleted points (exports are built from these) */
  visiblePoints: Point[];
  /** any confirmed winners? shows the Score toggles when true */
  canScore: boolean;
  /** this match's tags with their clip-bearing tagged point ids, timeline
   *  order (a tag row appears per non-empty tag) */
  tagOptions?: { id: string; label: string; pointIds: string[] }[];
}) {
  const [open, setOpen] = useState(false);
  // Render state per scope, keyed off the stored match_reels rows.
  const [starredReel, setStarredReel] = useState<ReelState | null>(null);
  const [fullReel, setFullReel] = useState<ReelState | null>(null);
  const [tagReels, setTagReels] = useState<Map<string, ReelState>>(new Map());
  // One "Include score" choice governs every rendered export (cleaner than
  // a toggle per row).
  const [showScore, setShowScore] = useState(true);
  const adopted = useRef(false);
  // Which artifact is mid-request (button-local busy; scope string or
  // 'cut'/'raw'). null = idle.
  const [busy, setBusy] = useState<string | null>(null);
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
    const tags = new Map<string, ReelState>();
    for (const [k, v] of byScope) {
      if (k.startsWith("tag:")) tags.set(k, v);
    }
    setTagReels(tags);
    // Adopt the stored score choice once, when the rows first load
    // (prefer the full export's, else the starred one's).
    if (!adopted.current && (s || f)) {
      adopted.current = true;
      setShowScore((f ?? s)!.show_score);
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
  const isRendering = (r: ReelState | null | undefined) =>
    r?.status === "queued" || r?.status === "rendering";
  const anyTagRendering = [...tagReels.values()].some(isRendering);
  const anyRendering = starredRendering || fullRendering || anyTagRendering;

  // Poll while the sheet is open and a render is in flight (either scope).
  useEffect(() => {
    if (!open || !anyRendering) return;
    const timer = window.setInterval(() => void load(), REEL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, anyRendering, load]);

  // Probe raw availability when the sheet opens (the object may have aged
  // out of the 30-day retention).
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

  const effShow = canScore && showScore;
  const starredSaveReady =
    starredReel?.status === "ready" &&
    starredFresh &&
    starredReel.show_score === effShow;
  const fullSaveReady =
    fullReel?.status === "ready" &&
    fullFresh &&
    fullReel.show_score === effShow;

  // Render (or re-render) an export, then hand it off. Shared by the
  // starred row, the full-with-score row, and every tag row.
  const runRender = useCallback(
    async (scope: string, showScore: boolean) => {
      if (busy) return;
      setBusy(scope);
      setError(null);
      try {
        const res = await fetch("/api/reel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            scope.startsWith("tag:")
              ? { matchId, tagId: scope.slice(4), showScore }
              : { matchId, scope, showScore }
          ),
        });
        const data = res.ok ? await res.json() : null;
        if (!data?.status) throw new Error("no status");
        const ids =
          scope === "full"
            ? fullIds
            : scope === "starred"
              ? starredIds
              : ((tagOptions ?? []).find((t) => `tag:${t.id}` === scope)
                  ?.pointIds ?? []);
        const setForScope = (next: ReelState) => {
          if (scope === "full") setFullReel(next);
          else if (scope === "starred") setStarredReel(next);
          else setTagReels((m) => new Map(m).set(scope, next));
        };
        if (data.status !== "ready") {
          setForScope({
            status: String(data.status),
            duration_s: null,
            show_score: showScore,
            pointIds: ids,
          });
          return;
        }
        setForScope({
          status: "ready",
          duration_s:
            data.durationS !== undefined && data.durationS !== null
              ? Number(data.durationS)
              : null,
          show_score: showScore,
          pointIds: ids,
        });
        await downloadReel(matchId, scope);
      } catch {
        setError("Couldn't prepare the video. Try again.");
      } finally {
        setBusy(null);
      }
    },
    [busy, matchId, fullIds, starredIds, tagOptions]
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
        triggerDownload(data.url);
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

  // Compact pill labels (RenderAction shows "Rendering…" on its own).
  const fullBtnLabel =
    busy === "full"
      ? "…"
      : fullSaveReady
        ? `Save · ${fmtDuration(fullReel?.duration_s ?? 0)}`
        : "Create";

  const starredBtnLabel =
    busy === "starred"
      ? "…"
      : starredSaveReady
        ? `Save · ${fmtDuration(starredReel?.duration_s ?? 0)}`
        : "Create";

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
              Download or share this match.
            </p>

            {/* One score choice governs every rendered video. */}
            {canScore && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-edge bg-surface px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100">
                    Include score
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Burn the scoreboard into rendered videos
                  </p>
                </div>
                <Switch
                  on={showScore}
                  onToggle={() => setShowScore((v) => !v)}
                  label="Include score"
                />
              </div>
            )}

            <div className="mt-3 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
              {/* Full match — plain cut download (score off) or a rendered
                  full-match video with the running scorebug (score on). */}
              <ExportRow
                title="Full match"
                subtitle={
                  effShow
                    ? fullRendering
                      ? "Rendering — we'll email you"
                      : fullSaveReady
                        ? "With scoreboard · ready"
                        : "Whole match, with scoreboard"
                    : "The playtime video"
                }
                action={
                  effShow ? (
                    <RenderAction
                      label={fullBtnLabel}
                      rendering={fullRendering}
                      disabled={busy !== null}
                      onClick={() => void runRender("full", effShow)}
                    />
                  ) : (
                    <DownloadAction
                      busy={busy === "cut"}
                      disabled={busy !== null}
                      onClick={() => void runDownload("cut")}
                    />
                  )
                }
              />

              {/* Starred points — always a render; scoreboard per the toggle. */}
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
                  action={
                    <RenderAction
                      label={starredBtnLabel}
                      rendering={starredRendering}
                      disabled={busy !== null}
                      onClick={() => void runRender("starred", effShow)}
                    />
                  }
                />
              ) : (
                <ExportRow
                  title="Starred points"
                  subtitle="Star points to export them"
                  action={null}
                />
              )}

              {/* Tag collections — one row per non-empty tag, rendered
                  exactly like starred (036). */}
              {(tagOptions ?? [])
                .filter((t) => t.pointIds.length > 0)
                .map((t) => {
                  const scope = `tag:${t.id}`;
                  const reel = tagReels.get(scope) ?? null;
                  const rendering = isRendering(reel);
                  const fresh = idsFresh(reel, t.pointIds);
                  const saveReady =
                    reel?.status === "ready" &&
                    fresh &&
                    reel.show_score === effShow;
                  const label =
                    busy === scope
                      ? "…"
                      : saveReady
                        ? `Save · ${fmtDuration(reel?.duration_s ?? 0)}`
                        : "Create";
                  return (
                    <ExportRow
                      key={t.id}
                      title={`${t.label} (${t.pointIds.length})`}
                      subtitle={
                        rendering
                          ? "Rendering — we'll email you"
                          : saveReady
                            ? "Ready"
                            : "Points with this tag, in order"
                      }
                      action={
                        <RenderAction
                          label={label}
                          rendering={rendering}
                          disabled={busy !== null}
                          onClick={() => void runRender(scope, effShow)}
                        />
                      }
                    />
                  );
                })}

              {/* Raw upload — only while the 30-day retention still holds it. */}
              {rawAvailable && (
                <ExportRow
                  title="Raw match"
                  subtitle="Your original upload, uncut"
                  action={
                    <DownloadAction
                      busy={busy === "raw"}
                      disabled={busy !== null}
                      onClick={() => void runDownload("raw")}
                    />
                  }
                />
              )}
            </div>

            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The Export row for an UNPROCESSED match: the same Tools-card door and
 * the same sheet chrome as ReelRow, holding the one artifact that exists
 * before processing — the original upload. Point clips, rendered reels
 * and tag collections appear via ReelRow once the match is processed.
 * Availability is probed on open, exactly as ReelRow probes its raw row:
 * a legacy match whose original is gone gets an honest line, not a link
 * that 404s.
 */
export function RawExportRow({ matchId }: { matchId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = probing, false = gone, true = present.
  const [rawAvailable, setRawAvailable] = useState<boolean | null>(null);

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

  const download = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, raw: true }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.url) throw new Error("no url");
      triggerDownload(data.url);
    } catch {
      setError("Couldn't create a download link. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }, [busy, matchId]);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={TOOL_ROW_CLASS}
      >
        <span className="text-sm font-semibold">Export</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="shrink-0 text-xs text-zinc-500">Original video</span>
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
              Point clips and rendered videos appear here after processing.
            </p>

            <div className="mt-4 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
              <ExportRow
                title="Original video"
                subtitle={
                  rawAvailable === false
                    ? "No longer stored"
                    : "Your upload, as recorded"
                }
                action={
                  rawAvailable === false ? null : (
                    <DownloadAction
                      busy={busy}
                      disabled={rawAvailable !== true}
                      onClick={() => void download()}
                    />
                  )
                }
              />
            </div>

            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
