"use client";

import { useCallback, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import { CROSSING_REVIEW_ROWS, type CrossingReviewRow } from "./data";
import {
  filterRows,
  formatClock,
  matchOptions,
  tabCounts,
  type CrossingReviewTab,
} from "./crossingReviewView";

const TABS: Array<{ value: CrossingReviewTab; label: string }> = [
  { value: "missed_junk", label: "Junk the rule missed" },
  { value: "flagged_kept", label: "Real points it would flag" },
];

export function CrossingReview() {
  const [tab, setTab] = useState<CrossingReviewTab>("missed_junk");
  const [match, setMatch] = useState("all");
  const counts = tabCounts(CROSSING_REVIEW_ROWS);
  const options = matchOptions(CROSSING_REVIEW_ROWS, tab);
  const rows = filterRows(CROSSING_REVIEW_ROWS, { tab, match });

  // One clip plays at a time; starting another pauses the last.
  const activeVideo = useRef<HTMLVideoElement | null>(null);
  const onPlay = useCallback((video: HTMLVideoElement) => {
    if (activeVideo.current && activeVideo.current !== video) {
      activeVideo.current.pause();
    }
    activeVideo.current = video;
  }, []);

  return (
    <main className="min-h-screen bg-arena pb-24 text-zinc-100">
      <header className="mx-auto flex max-w-[1500px] items-center px-6 py-6">
        <Logo href="/research" />
      </header>

      <div className="mx-auto max-w-[1500px] px-6">
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Crossing review
        </h1>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {TABS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTab(value);
                setMatch("all");
              }}
              className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                tab === value
                  ? "border-cyan-glow/60 bg-cyan-500/15 text-cyan-100"
                  : "border-edge text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              }`}
            >
              {label} ({counts[value]})
            </button>
          ))}

          <select
            value={match}
            onChange={(event) => setMatch(event.target.value)}
            className="ml-auto rounded-full border border-edge bg-ink px-4 py-1.5 text-sm text-zinc-300"
            aria-label="Filter by match"
          >
            <option value="all">All matches</option>
            {options.map((option) => (
              <option key={option.matchId} value={option.matchId}>
                {option.label} ({option.count})
              </option>
            ))}
          </select>
        </div>

        <section
          aria-label="Point clips"
          className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {rows.map((row) => (
            <ClipCard key={row.pointId} row={row} onPlay={onPlay} />
          ))}
        </section>

        {rows.length === 0 && (
          <p className="mt-10 text-sm text-zinc-400">Nothing here.</p>
        )}
      </div>
    </main>
  );
}

function ClipCard({
  row,
  onPlay,
}: {
  row: CrossingReviewRow;
  onPlay: (video: HTMLVideoElement) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: row.matchId, pointId: row.pointId }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.url) throw new Error("no url");
      setUrl(data.url);
      setState("idle");
    } catch {
      setState("error");
    }
  }, [row.matchId, row.pointId]);

  return (
    <figure className="overflow-hidden rounded-xl border border-edge bg-ink/60">
      {/* The box is sized here, not on the video, so nothing jumps when
          metadata arrives. */}
      <div className="relative aspect-video bg-black">
        {url ? (
          <video
            src={url}
            controls
            autoPlay
            playsInline
            preload="metadata"
            onPlay={(event) => onPlay(event.currentTarget)}
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <button
            type="button"
            onClick={load}
            disabled={state === "loading"}
            className="absolute inset-0 flex items-center justify-center text-sm text-zinc-300 transition-colors hover:bg-white/5"
          >
            {state === "loading" && "Loading…"}
            {state === "error" && "Clip unavailable. Tap to retry."}
            {state === "idle" && (
              <span className="flex items-center gap-2">
                <svg
                  viewBox="0 0 24 24"
                  className="h-8 w-8 fill-current text-white/80"
                  aria-hidden
                >
                  <path d="M8 5.5v13l11-6.5-11-6.5z" />
                </svg>
                Play clip
              </span>
            )}
          </button>
        )}
      </div>
      <figcaption className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm">
        <span className="font-medium text-white">
          {row.opponent}
          {row.venue ? ` at ${row.venue}` : ""}
        </span>
        <span className="text-zinc-400">{formatClock(row.t0)}</span>
        <span className="text-zinc-400">{row.dur.toFixed(1)}s</span>
        <span className="ml-auto font-mono text-xs text-zinc-500">
          {row.crossings} {row.crossings === 1 ? "crossing" : "crossings"} ·{" "}
          {row.detections} det
        </span>
      </figcaption>
    </figure>
  );
}
