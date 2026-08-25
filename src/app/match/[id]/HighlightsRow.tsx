"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { clipUrlFor } from "@/app/starred/clipUrls";
import type { Point } from "@/lib/types";
import {
  HIGHLIGHT_BUDGETS_S,
  pickHighlights,
  type ClipPad,
  type HighlightKind,
} from "./highlights";
import { TOOL_ROW_CLASS, ToolRowChevron } from "./ReelBar";

/**
 * The Tools row for the automatic highlights, and the overlay it opens.
 *
 * Two cuts, each named with its own rally count (the hierarchy Adil set,
 * 2026-08-25): the SHORT highlight, sized for Instagram's minute, and the
 * LONG one, up to two. The overlay plays whichever is selected using the
 * rallies' existing preview clips — no render, no waiting — and offers
 * the watched cut as a download, rendered through the same pipeline as
 * every vertical share.
 *
 * Which rallies is decided by highlights.ts — the same picker the API
 * renders with and the phone previews with, so all three surfaces name
 * the same rallies.
 */

type Cut = "short" | "long";

type CutState =
  | { step: "idle" }
  | { step: "rendering" }
  | { step: "failed"; message: string };

export function HighlightsRow({
  matchId,
  points,
  pad,
}: {
  matchId: string;
  points: Point[];
  pad: ClipPad;
}) {
  const [open, setOpen] = useState(false);
  const [sharingOn, setSharingOn] = useState(true);

  const short = pickHighlights(points, pad, HIGHLIGHT_BUDGETS_S.reel);
  const long = pickHighlights(points, pad, HIGHLIGHT_BUDGETS_S.long);
  const longWorthIt = long.totalS > short.totalS + 1;

  useEffect(() => {
    // The emergency switch (136). Fails open: only a stored 'off' hides
    // the rendered downloads — and never the playback, which needs none.
    const supabase = createClient();
    supabase
      .from("app_config")
      .select("value")
      .eq("key", "instagram_sharing")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value === "off") setSharingOn(false);
      });
  }, []);

  const summary =
    short.picks.length > 0
      ? `${short.picks.length} ${short.picks.length === 1 ? "rally" : "rallies"} · ${clock(short.totalS)}`
      : "No rallies yet";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={TOOL_ROW_CLASS}
      >
        <span className="shrink-0 text-sm font-semibold">Highlights</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs tabular-nums text-zinc-400">
            {summary}
          </span>
          <ToolRowChevron />
        </span>
      </button>
      {open && short.picks.length > 0 && (
        <HighlightsOverlay
          matchId={matchId}
          cuts={{
            short: { picks: short.picks, totalS: short.totalS },
            long: { picks: long.picks, totalS: long.totalS },
          }}
          longWorthIt={longWorthIt}
          sharingOn={sharingOn}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function clock(seconds: number) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function HighlightsOverlay({
  matchId,
  cuts,
  longWorthIt,
  sharingOn,
  onClose,
}: {
  matchId: string;
  cuts: Record<Cut, { picks: Point[]; totalS: number }>;
  longWorthIt: boolean;
  sharingOn: boolean;
  onClose: () => void;
}) {
  const [cut, setCut] = useState<Cut>("short");
  const [index, setIndex] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  const [showNames, setShowNames] = useState(
    () => localStorage.getItem("shareShowNames") !== "false"
  );
  const [showScore, setShowScore] = useState(
    () => localStorage.getItem("shareShowScore") !== "false"
  );
  const [state, setState] = useState<CutState>({ step: "idle" });
  const seq = useRef(0);

  const picks = cuts[cut].picks;
  const point = picks[index];

  useEffect(() => {
    if (!point) return;
    const mine = ++seq.current;
    setSrc(null);
    clipUrlFor(matchId, point.id).then((url) => {
      if (seq.current !== mine) return;
      setSrc(url);
    });
    // Read one ahead so the gap between rallies is not a round trip.
    const next = picks[index + 1];
    if (next) void clipUrlFor(matchId, next.id);
  }, [matchId, point, picks, index]);

  const advance = useCallback(() => {
    setIndex((i) => Math.min(i + 1, picks.length - 1));
  }, [picks.length]);

  const switchCut = useCallback((next: Cut) => {
    setCut(next);
    setIndex(0);
  }, []);

  const download = useCallback(async () => {
    const kind: HighlightKind = cut === "short" ? "reel" : "long";
    setState({ step: "rendering" });
    const body = JSON.stringify({
      matchId,
      highlight: kind,
      showScore,
      showNames,
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
  }, [cut, matchId, showNames, showScore]);

  if (!point) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink/95 backdrop-blur-sm">
      <div className="flex items-start justify-between px-5 pb-3 pt-5">
        <div>
          <div className="text-sm font-semibold text-zinc-100">
            {cut === "short" ? "Short highlight" : "Long highlight"}
          </div>
          <div className="text-xs tabular-nums text-zinc-500">
            {index + 1} of {picks.length}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {longWorthIt && (
            <div className="flex overflow-hidden rounded-full border border-edge bg-surface text-xs">
              {(["short", "long"] as Cut[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => switchCut(c)}
                  className={`px-3 py-1.5 tabular-nums ${
                    cut === c
                      ? "bg-cyan-400/15 text-cyan-200"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {c === "short" ? "Short" : "Long"} · {clock(cuts[c].totalS)}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-edge bg-surface px-4 py-1.5 text-sm text-zinc-300 hover:text-zinc-100"
          >
            Close
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-3">
        {/* Sized on the div, never the video: a media element has no
            intrinsic size until its metadata arrives. */}
        <div className="w-full max-w-4xl">
          <div className="overflow-hidden rounded-2xl border border-edge bg-black">
            {src ? (
              <video
                key={src}
                src={src}
                className="aspect-video w-full"
                controls
                autoPlay
                playsInline
                onEnded={advance}
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center text-sm text-zinc-500">
                Loading…
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-4xl px-5 pb-6 pt-4">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="rounded-full border border-edge bg-surface px-4 py-1.5 text-sm text-zinc-300 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={advance}
            disabled={index >= picks.length - 1}
            className="rounded-full border border-edge bg-surface px-4 py-1.5 text-sm text-zinc-300 disabled:opacity-40"
          >
            Next
          </button>
          {sharingOn && (
            <button
              type="button"
              onClick={download}
              disabled={state.step === "rendering"}
              className="rounded-full border border-edge bg-surface px-4 py-1.5 text-sm text-zinc-200 hover:border-zinc-500 disabled:opacity-40"
            >
              {state.step === "rendering"
                ? "Rendering…"
                : `Download this cut (${clock(cuts[cut].totalS)})`}
            </button>
          )}
        </div>
        {sharingOn && (
          <div className="mt-3 flex items-center justify-center gap-5 text-sm text-zinc-400">
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
          </div>
        )}
        {state.step === "failed" && (
          <p className="mt-3 text-center text-sm text-amber-300/90">
            {state.message}
          </p>
        )}
      </div>
    </div>
  );
}
