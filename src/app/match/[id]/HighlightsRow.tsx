"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { clipUrlFor } from "@/app/starred/clipUrls";
import type { Point } from "@/lib/types";
import type { ClipPad } from "./clipEdit";
import {
  HIGHLIGHT_BUDGETS_S,
  pickHighlights,
  type HighlightKind,
} from "./highlights";
import { TOOL_ROW_CLASS, ToolRowChevron } from "./ReelBar";

/**
 * The Tools row for the automatic highlights, and the overlay it opens.
 *
 * The row sits below Score Keeper and reads "5 rallies · 0:48" — the reel
 * cut, the flagship of the three. The overlay plays the picked rallies'
 * existing preview clips back to back (no render, no waiting) and offers
 * the three rendered cuts as downloads: the Story cut (20s), the Reel cut
 * (60s) and the long cut (120s — for anywhere that takes more than a
 * minute; the Instagram handover itself is an app-only thing).
 *
 * Which rallies is decided by highlights.ts — the same picker the API
 * renders with and the phone previews with, so all three surfaces name
 * the same rallies.
 */

const cutLabel: Record<HighlightKind, string> = {
  story: "Story cut",
  reel: "Reel cut",
  long: "Long cut",
};

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

  const reel = pickHighlights(points, pad, HIGHLIGHT_BUDGETS_S.reel);
  const story = pickHighlights(points, pad, HIGHLIGHT_BUDGETS_S.story);
  const long = pickHighlights(points, pad, HIGHLIGHT_BUDGETS_S.long);

  useEffect(() => {
    // The emergency switch (136). Fails open: only a stored 'off' hides
    // the rendered cuts — and never the playback, which needs no render.
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
    reel.picks.length > 0
      ? `${reel.picks.length} ${reel.picks.length === 1 ? "rally" : "rallies"} · ${clock(reel.totalS)}`
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
      {open && (
        <HighlightsOverlay
          matchId={matchId}
          allPoints={points}
          picks={reel.picks}
          cuts={{
            story: { n: story.picks.length, s: story.totalS },
            reel: { n: reel.picks.length, s: reel.totalS },
            long: { n: long.picks.length, s: long.totalS },
          }}
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
  allPoints,
  picks,
  cuts,
  sharingOn,
  onClose,
}: {
  matchId: string;
  allPoints: Point[];
  picks: Point[];
  cuts: Record<HighlightKind, { n: number; s: number }>;
  sharingOn: boolean;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  const [showNames, setShowNames] = useState(
    () => localStorage.getItem("shareShowNames") !== "false"
  );
  const [showScore, setShowScore] = useState(
    () => localStorage.getItem("shareShowScore") !== "false"
  );
  const [cutStates, setCutStates] = useState<Record<HighlightKind, CutState>>({
    story: { step: "idle" },
    reel: { step: "idle" },
    long: { step: "idle" },
  });
  const videoRef = useRef<HTMLVideoElement>(null);
  const seq = useRef(0);

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

  const requestCut = useCallback(
    async (kind: HighlightKind) => {
      setCutStates((s) => ({ ...s, [kind]: { step: "rendering" } }));
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
        setCutStates((s) => ({ ...s, [kind]: { step: "idle" } }));
      } catch (e) {
        setCutStates((s) => ({
          ...s,
          [kind]: {
            step: "failed",
            message:
              e instanceof Error ? e.message : "Couldn't prepare the video.",
          },
        }));
      }
    },
    [matchId, showNames, showScore]
  );

  const anyRendering = Object.values(cutStates).some(
    (s) => s.step === "rendering"
  );
  const failure = Object.values(cutStates).find((s) => s.step === "failed");

  if (!point) return null;
  const pointNo = allPoints.findIndex((p) => p.id === point.id) + 1;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink/95 backdrop-blur-sm">
      <div className="flex items-start justify-between px-5 pb-3 pt-5">
        <div>
          <div className="text-sm font-semibold text-zinc-100">Highlights</div>
          <div className="text-xs tabular-nums text-zinc-500">
            {index + 1} of {picks.length} · Point {pointNo}
            {point.starred ? " ★" : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-edge bg-surface px-4 py-1.5 text-sm text-zinc-300 hover:text-zinc-100"
        >
          Close
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-3">
        {/* Sized on the div, never the video: a media element has no
            intrinsic size until its metadata arrives. */}
        <div className="w-full max-w-4xl">
          <div className="overflow-hidden rounded-2xl border border-edge bg-black">
            {src ? (
              <video
                ref={videoRef}
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
        <div className="flex items-center justify-center gap-3">
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
        </div>

        {sharingOn && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            {(Object.keys(cutLabel) as HighlightKind[]).map((kind) =>
              cuts[kind].n > 0 &&
              (kind !== "long" || cuts.long.s > cuts.reel.s + 1) ? (
                <button
                  key={kind}
                  type="button"
                  onClick={() => requestCut(kind)}
                  disabled={anyRendering}
                  className="rounded-full border border-edge bg-surface px-4 py-1.5 text-sm text-zinc-200 hover:border-zinc-500 disabled:opacity-40"
                >
                  {cutStates[kind].step === "rendering"
                    ? "Rendering…"
                    : `Download the ${cutLabel[kind]} (${clock(cuts[kind].s)})`}
                </button>
              ) : null
            )}
          </div>
        )}
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
        {failure && failure.step === "failed" && (
          <p className="mt-3 text-center text-sm text-amber-300/90">
            {failure.message}
          </p>
        )}
      </div>
    </div>
  );
}
