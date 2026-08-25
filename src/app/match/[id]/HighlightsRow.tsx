"use client";

import { useCallback, useState } from "react";
import type { Point } from "@/lib/types";
import {
  HIGHLIGHT_BUDGETS_S,
  pickHighlights,
  type ClipPad,
  type HighlightKind,
} from "./highlights";
import { TOOL_ROW_CLASS, ToolRowChevron } from "./ReelBar";

/**
 * The Tools row for the automatic highlights: a chooser with the two
 * cuts, played in the REAL watch player.
 *
 * The row opens a small chooser — Short highlight, Long highlight, each
 * named with its own rally count (the hierarchy Adil set, 2026-08-25).
 * Picking one hands the point ids to Player.openHighlights, which plays
 * only those rallies full screen with the watch player's own transport;
 * its Download pill comes back here, to the sheet that renders the
 * watched cut through the same pipeline as every vertical share.
 *
 * Which rallies is decided by highlights.ts — the same picker the API
 * renders with and the phone previews with, so all three surfaces name
 * the same rallies.
 */

type CutState =
  | { step: "idle" }
  | { step: "rendering" }
  | { step: "failed"; message: string };

export function HighlightsRow({
  matchId,
  points,
  pad,
  tapEnd,
  onPlay,
}: {
  matchId: string;
  points: Point[];
  pad: ClipPad;
  /** app_config.tap_end_playback — must match what the player and the
   *  reel route use, so the row, the tape and the render agree. */
  tapEnd: boolean;
  onPlay: (pointIds: string[], onDownload: () => void) => void;
}) {
  const [chooserOpen, setChooserOpen] = useState(false);
  const [downloadCut, setDownloadCut] = useState<"short" | "long" | null>(
    null
  );

  const short = pickHighlights(points, pad, HIGHLIGHT_BUDGETS_S.reel, tapEnd);
  const long = pickHighlights(points, pad, HIGHLIGHT_BUDGETS_S.long, tapEnd);
  const longWorthIt = long.totalS > short.totalS + 1;

  const summary =
    short.picks.length > 0
      ? `${short.picks.length} ${short.picks.length === 1 ? "rally" : "rallies"} · ${clock(short.totalS)}`
      : "No rallies yet";

  const play = useCallback(
    (cut: "short" | "long") => {
      const picks = cut === "short" ? short.picks : long.picks;
      setChooserOpen(false);
      onPlay(
        picks.map((p) => p.id),
        () => setDownloadCut(cut)
      );
    },
    [short.picks, long.picks, onPlay]
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setChooserOpen(true)}
        className={TOOL_ROW_CLASS}
        disabled={short.picks.length === 0}
      >
        <span className="shrink-0 text-sm font-semibold">Highlights</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs tabular-nums text-zinc-400">
            {summary}
          </span>
          <ToolRowChevron />
        </span>
      </button>

      {chooserOpen && short.picks.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/80 backdrop-blur-sm sm:items-center"
          onClick={() => setChooserOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl border border-edge bg-surface p-5 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-zinc-100">Highlights</h2>
            <div className="mt-4 space-y-2">
              <CutRow
                title="Short highlight"
                detail={`${short.picks.length} ${short.picks.length === 1 ? "rally" : "rallies"} · ${clock(short.totalS)}`}
                onClick={() => play("short")}
              />
              {longWorthIt && (
                <CutRow
                  title="Long highlight"
                  detail={`${long.picks.length} rallies · ${clock(long.totalS)}`}
                  onClick={() => play("long")}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {downloadCut && (
        <DownloadSheet
          matchId={matchId}
          kind={downloadCut === "short" ? "reel" : "long"}
          seconds={downloadCut === "short" ? short.totalS : long.totalS}
          onClose={() => setDownloadCut(null)}
        />
      )}
    </>
  );
}

function clock(seconds: number) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function CutRow({
  title,
  detail,
  onClick,
}: {
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-edge bg-ink/40 px-4 py-3 text-left transition-colors hover:border-zinc-600"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-glow/10 text-cyan-glow">
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M8 5.5v13l11-6.5-11-6.5Z" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-zinc-100">
          {title}
        </span>
        <span className="block text-xs tabular-nums text-zinc-400">
          {detail}
        </span>
      </span>
      <ToolRowChevron />
    </button>
  );
}

/**
 * Rendering the watched cut and handing the file over. Sits ABOVE the
 * player takeover (z-60): the Download pill in the player opens it. The
 * kill switch is enforced by the API — its refusal shows here verbatim.
 */
function DownloadSheet({
  matchId,
  kind,
  seconds,
  onClose,
}: {
  matchId: string;
  kind: HighlightKind;
  seconds: number;
  onClose: () => void;
}) {
  const [showNames, setShowNames] = useState(
    () => localStorage.getItem("shareShowNames") !== "false"
  );
  const [showScore, setShowScore] = useState(
    () => localStorage.getItem("shareShowScore") !== "false"
  );
  const [showLogo, setShowLogo] = useState(
    () => localStorage.getItem("shareShowLogo") !== "false"
  );
  const [state, setState] = useState<CutState>({ step: "idle" });

  const download = useCallback(async () => {
    setState({ step: "rendering" });
    const body = JSON.stringify({
      matchId,
      highlight: kind,
      showScore,
      showNames,
      showLogo,
    });
    const deadline = Date.now() + (kind === "long" ? 240 : 180) * 1000;
    try {
      for (;;) {
        const res = await fetch("/api/reel", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? "Couldn't prepare the video.");
        }
        if (data.status === "ready") break;
        if (Date.now() > deadline) {
          throw new Error("That took too long. Try again in a minute.");
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      const media = await fetch("/api/media-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matchId,
          reel: true,
          download: true,
          scope: `v:hl:${kind}`,
        }),
      });
      const { url } = await media.json();
      if (!url) throw new Error("Couldn't prepare the video. Try again.");
      window.location.assign(url);
      setState({ step: "idle" });
    } catch (e) {
      setState({
        step: "failed",
        message:
          e instanceof Error ? e.message : "Couldn't prepare the video.",
      });
    }
  }, [kind, matchId, showNames, showScore, showLogo]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/80 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl border border-edge bg-surface p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-zinc-100">
          Download this highlight
        </h2>
        <div className="mt-4 flex flex-col gap-3">
          <button
            type="button"
            onClick={download}
            disabled={state.step === "rendering"}
            className="rounded-full border border-cyan-glow/50 px-4 py-2 text-sm font-semibold text-cyan-glow transition-colors hover:bg-cyan-glow/10 disabled:opacity-40"
          >
            {state.step === "rendering"
              ? "Rendering…"
              : `Download (${clock(seconds)})`}
          </button>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-zinc-400">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showNames}
                onChange={(e) => {
                  setShowNames(e.target.checked);
                  localStorage.setItem(
                    "shareShowNames",
                    String(e.target.checked)
                  );
                }}
                className="accent-cyan-400"
              />
              Include names
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showScore}
                onChange={(e) => {
                  setShowScore(e.target.checked);
                  localStorage.setItem(
                    "shareShowScore",
                    String(e.target.checked)
                  );
                }}
                className="accent-cyan-400"
              />
              Include score
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showLogo}
                onChange={(e) => {
                  setShowLogo(e.target.checked);
                  localStorage.setItem(
                    "shareShowLogo",
                    String(e.target.checked)
                  );
                }}
                className="accent-cyan-400"
              />
              Include logo
            </label>
          </div>
          {state.step === "failed" && (
            <p className="text-center text-sm text-amber-300/90">
              {state.message}
            </p>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:text-zinc-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
