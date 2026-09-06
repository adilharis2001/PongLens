"use client";

import { useCallback, useEffect, useState } from "react";
import { downloadReel } from "@/lib/download";
import { TOOL_ROW_CLASS, ToolRowChevron } from "./ReelBar";
import {
  parseHighlightResponse,
  type HighlightAsset,
  type HighlightState,
} from "./highlights";

function clock(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function summary(state: HighlightState | null) {
  if (!state || state.status === "rendering") return "Preparing highlights";
  if (state.status === "failed") return "Highlights unavailable";
  if (state.status === "empty" || state.status === "unavailable") {
    return "No highlight rallies";
  }
  if (state.status !== "ready") return "Highlights unavailable";
  const count = state.manifest.points.length;
  return `${count} ${count === 1 ? "rally" : "rallies"} · ${clock(state.durationS)}`;
}

export function HighlightsRow({
  matchId,
  onPlay,
}: {
  matchId: string;
  onPlay: (asset: HighlightAsset, onDownload: () => void) => void;
}) {
  const [state, setState] = useState<HighlightState | null>(null);

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
        if (next.status === "rendering") timer = setTimeout(load, 1800);
      } catch {
        if (!cancelled) setState({ status: "failed" });
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [matchId]);

  const play = useCallback(() => {
    if (state?.status !== "ready") return;
    onPlay(state, () => {
      void downloadReel(matchId, "highlights").catch(() => {
        window.alert("Couldn't download the highlight. Try again.");
      });
    });
  }, [matchId, onPlay, state]);

  const ready = state?.status === "ready";
  return (
    <button
      type="button"
      onClick={play}
      className={TOOL_ROW_CLASS}
      disabled={!ready}
    >
      <span className="shrink-0 text-sm font-semibold">Highlights</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-xs tabular-nums text-zinc-400">
          {summary(state)}
        </span>
        {ready && <ToolRowChevron />}
      </span>
    </button>
  );
}
