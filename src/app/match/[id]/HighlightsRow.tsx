"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BottomSheet, SHEET_PRIMARY_BUTTON } from "@/components/BottomSheet";
import { downloadReel } from "@/lib/download";
import { TOOL_ROW_CLASS, ToolRowChevron } from "./ReelBar";
import {
  parseHighlightResponse,
  highlightLifecycleView,
  highlightRequestSheetIsVisible,
  type HighlightAsset,
  type HighlightState,
} from "./highlights";

function clock(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function summary(state: HighlightState | null) {
  if (!state) return "Preparing highlights";
  if (state.status !== "ready") return highlightLifecycleView(state).rowSummary;
  const count = state.manifest.points.length;
  return `${count} ${count === 1 ? "rally" : "rallies"} · ${clock(state.durationS)}`;
}

export function HighlightsRow({
  matchId,
  onPlay,
  onScore,
  onStateChange,
}: {
  matchId: string;
  onPlay: (asset: HighlightAsset, onDownload: () => void) => void;
  onScore: () => void;
  onStateChange?: (state: HighlightState | null) => void;
}) {
  const [state, setState] = useState<HighlightState | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [acknowledgement, setAcknowledgement] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const requestSheetVisible = highlightRequestSheetIsVisible(sheetOpen, state);

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const res = await fetch(
          `/api/highlights?matchId=${encodeURIComponent(matchId)}`,
          { cache: "no-store" },
        );
        const next = parseHighlightResponse(res.ok ? await res.json() : null);
        if (cancelled) return;
        setState(next);
        if (
          next.status !== "ready" &&
          highlightLifecycleView(next).shouldPoll
        ) {
          timer = setTimeout(load, 1800);
        }
      } catch {
        if (!cancelled) setState({ status: "failed" });
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [matchId, refreshSequence]);

  const close = useCallback(() => {
    setSheetOpen(false);
    setError("");
  }, []);

  // The sheet handles Escape, scroll-lock and its own focus; the row only
  // has to take the focus back when the sheet goes.
  useEffect(() => {
    if (!requestSheetVisible) return;
    const trigger = triggerRef.current;
    return () => {
      trigger?.focus({ preventScroll: true });
    };
  }, [requestSheetVisible]);

  useEffect(() => {
    if (!acknowledgement) return;
    const timer = window.setTimeout(() => setAcknowledgement(false), 5_000);
    return () => window.clearTimeout(timer);
  }, [acknowledgement]);

  const play = useCallback(() => {
    if (state?.status !== "ready") return;
    onPlay(state, () => {
      void downloadReel(matchId, "highlights").catch(() => {
        window.alert("Couldn't download the highlight. Try again.");
      });
    });
  }, [matchId, onPlay, state]);

  const open = useCallback(() => {
    if (state?.status === "ready") {
      play();
      return;
    }
    if (
      state?.status === "needs_generation" ||
      state?.status === "needs_scoring" ||
      state?.status === "needs_update" ||
      state?.status === "updating" ||
      state?.status === "rendering"
    ) {
      setError("");
      setSheetOpen(true);
    }
  }, [play, state?.status]);

  const requestUpdate = useCallback(async () => {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/highlights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        code?: string;
        scoredPoints?: number;
        scorablePoints?: number;
        requiredPoints?: number;
        requiredPercent?: number;
        eligible?: boolean;
      };
      if (!response.ok) {
        if (body.code === "highlights_current") {
          close();
          setRefreshSequence((value) => value + 1);
          return;
        }
        if (body.code === "rally_clips_updating") {
          setState({ status: "updating" });
          setRefreshSequence((value) => value + 1);
          return;
        }
        if (body.code === "highlights_score_required") {
          setState(parseHighlightResponse({ status: "needs_scoring", ...body }));
          return;
        }
        throw new Error(
          body.code === "render_queue_full"
            ? "Three videos are already being prepared. Try again when one is finished."
            : "Couldn't prepare highlights. Try again.",
        );
      }
      setState({ status: "rendering" });
      setSheetOpen(false);
      setAcknowledgement(true);
      setRefreshSequence((value) => value + 1);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Couldn't prepare highlights. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [close, matchId]);

  const actionable =
    state?.status === "ready" ||
    state?.status === "needs_generation" ||
    state?.status === "needs_scoring" ||
    state?.status === "needs_update" ||
    state?.status === "updating" ||
    state?.status === "rendering";
  const requestView =
    state && state.status !== "ready" ? highlightLifecycleView(state) : null;
  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup={state?.status === "ready" ? undefined : "dialog"}
        onClick={open}
        className={TOOL_ROW_CLASS}
        disabled={!actionable}
      >
        <span className="shrink-0 text-sm font-semibold">Highlights</span>
        <span className="flex min-w-0 items-center gap-2">
          {(state?.status === "rendering" || state?.status === "updating") && (
            <span
              aria-hidden="true"
              className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-glow/30 border-t-cyan-glow"
            />
          )}
          <span
            aria-live="polite"
            className="shrink-0 text-xs tabular-nums text-zinc-400"
          >
            {summary(state)}
          </span>
          {actionable && <ToolRowChevron />}
        </span>
      </button>

      {requestView && (
        <BottomSheet
          open={requestSheetVisible}
          portal
          title={requestView.sheetTitle}
          subtitle={requestView.body}
          onClose={close}
          closeLabel="Close highlights sheet"
        >
          {requestView.shouldPoll && (
            <div className="mt-5 flex items-center gap-3 text-sm text-zinc-300">
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-glow/30 border-t-cyan-glow"
              />
              {requestView.rowSummary}
            </div>
          )}
          {requestView.actionLabel && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                if (requestView.actionKind === "score") {
                  close();
                  onScore();
                  return;
                }
                void requestUpdate();
              }}
              className={`${SHEET_PRIMARY_BUTTON} mt-5 disabled:cursor-wait`}
            >
              {submitting ? "Starting…" : requestView.actionLabel}
            </button>
          )}
          <p
            aria-live="polite"
            className={`text-sm text-red-300 ${error ? "mt-3" : ""}`}
          >
            {error}
          </p>
        </BottomSheet>
      )}

      {acknowledgement && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-24 left-1/2 z-[70] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl border border-edge bg-surface px-4 py-3 text-sm text-zinc-100 shadow-2xl md:bottom-6"
        >
          Highlights are updating.
        </div>
      )}
    </div>
  );
}
