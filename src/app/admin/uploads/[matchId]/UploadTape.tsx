"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Point } from "@/lib/types";
import { ClipPlayer } from "../../../match/[id]/ClipPlayer";
import type { ServeInfo } from "../../../match/[id]/serving";
import {
  effectiveEnd,
  paddedEnd,
  skipSpans,
  type ClipPad,
  type EndOptions,
} from "../../../match/[id]/playhead";
import { formatClock, type UploadPointRow } from "../uploadView";

/**
 * The play-by-play: one cut video, walked card by card.
 *
 * ONE video seeked, not N clips loaded. That is the watch player's own
 * data path, so what an admin sees here is what the owner sees on their
 * match page — which is the entire point of the page. It is also one
 * signature instead of one per card, and stepping to the next card is a
 * seek rather than a load.
 *
 * TWO WAYS TO WATCH, because the difference between them is the thing
 * being judged:
 *
 *   "As the player sees it"  stops where their player stops (the winner
 *                            tap, or the observed rally end) and jumps the
 *                            footage they never get shown.
 *   "Everything"             plays each card's full padded clip and hops
 *                            nothing, which is what the cut file actually
 *                            contains.
 *
 * Every boundary comes from playhead.ts unchanged. Re-deriving a rally end
 * as cut_t0 + (t1 - t0) is wrong by the pre pad — about a second — on
 * every single card, systematically, and it is the mistake this codebase
 * makes most.
 */

export function UploadTape({
  rows,
  startPointId,
  source,
  url,
  pad,
  ends,
  serving,
  names,
  onResign,
  onClose,
}: {
  rows: UploadPointRow[];
  /** WHICH card to open on, by id.
   *
   *  Deliberately not an index. The tape walks only the cards that have a
   *  position in the cut file, so its list is shorter than the page's
   *  wherever a point has no cut_t0 — every pre-011 match and every split
   *  child of one — and an index from the page would then open a
   *  different card than the one that was tapped. */
  startPointId: string | null;
  /** "cut" walks the cards; "raw" is the untouched upload, start to end. */
  source: "cut" | "raw";
  url: string | null;
  pad: ClipPad;
  ends: EndOptions;
  serving: ReadonlyMap<string, ServeInfo>;
  names: { user: string; opponent: string };
  /** Mint a fresh signed URL when the old one expires mid-watch. */
  onResign: (() => Promise<string | null>) | null;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [asPlayerSeesIt, setAsPlayerSeesIt] = useState(true);
  const [src, setSrc] = useState<string | null>(url);
  const playRef = useRef<{ play: () => void; pause: () => void } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const resumeAtRef = useRef<number | null>(null);

  useEffect(() => setSrc(url), [url]);

  // Only cards with a cut offset can be walked. A card with no cut_t0 is
  // pre-011 and has no position in the cut file at all.
  const walk = useMemo(
    () => rows.filter((r) => r.cut_t0 !== null),
    [rows]
  );

  // Resolve the opening card inside the walk, once, on the id the page
  // handed over.
  useEffect(() => {
    const at = walk.findIndex((r) => r.id === startPointId);
    setIndex(at === -1 ? 0 : at);
  }, [startPointId, walk]);

  const current = walk[index] ?? walk[0] ?? null;
  const visibleCount = useMemo(
    () => rows.filter((r) => !r.deleted).length,
    [rows]
  );

  // The effective options for THIS viewing mode. "Everything" turns both
  // endings off, which is one object rather than a second code path.
  const viewEnds: EndOptions = useMemo(
    () => (asPlayerSeesIt ? ends : { tapEnd: false, rallyEnd: null }),
    [asPlayerSeesIt, ends]
  );

  // skipSpans wants EVERY point with cut offsets, deleted included, in
  // timeline order. Handing it only the visible ones silently produces no
  // deleted-footage spans at all.
  //
  // The card being watched is then exempted from its own skip. Choosing a
  // removed card is an explicit "show me this", and without the exemption
  // the hop fires the instant it is seeked to, so the one thing the admin
  // asked to see is the one thing they cannot watch.
  const spans = useMemo(() => {
    if (!asPlayerSeesIt || source !== "cut") return [];
    const all = skipSpans(rows as unknown as Point[], pad, ends);
    if (!current) return all;
    const from = Number(current.cut_t0);
    const to = paddedEnd(current as unknown as Point, pad) ?? from;
    return all.filter((s) => s.end <= from || s.start >= to);
  }, [asPlayerSeesIt, source, rows, pad, ends, current]);

  const go = useCallback(
    (i: number) => {
      if (source === "raw") return;
      const next = walk[Math.max(0, Math.min(walk.length - 1, i))];
      if (!next) return;
      setIndex(walk.indexOf(next));
      const el = videoRef.current;
      if (el) {
        el.currentTime = Number(next.cut_t0);
        playRef.current?.play();
      }
    },
    [walk, source]
  );

  // Seek to the opening card once the media can actually be positioned.
  const onLoadedMetadata = useCallback(
    (el: HTMLVideoElement) => {
      // A re-signed URL remounts the media; put the viewer back where the
      // expiry interrupted them rather than at the top of the match.
      const resume = resumeAtRef.current;
      if (resume !== null) {
        el.currentTime = resume;
        resumeAtRef.current = null;
        playRef.current?.play();
        return;
      }
      if (source === "cut" && current?.cut_t0 != null) {
        el.currentTime = Number(current.cut_t0);
        playRef.current?.play();
      }
    },
    [source, current]
  );

  const onTime = useCallback(
    (el: HTMLVideoElement) => {
      if (source === "raw") return;
      const t = el.currentTime;

      // 1. Stop where the player's own playback stops.
      const stop = stopAtRef.current;
      if (stop !== null && t >= stop && !el.paused) {
        el.pause();
        return;
      }

      // 2. Hop footage the owner never sees. Never while scrubbing.
      if (!el.paused) {
        const span = spans.find((s) => t >= s.start && t < s.end - 0.01);
        if (span) {
          el.currentTime = span.end;
          return;
        }
      }
    },
    [source, spans]
  );

  // The stop point tracks the current card and the viewing mode together.
  useEffect(() => {
    if (source === "raw" || !current) {
      stopAtRef.current = null;
      return;
    }
    stopAtRef.current = current.deleted
      ? paddedEnd(current as unknown as Point, pad)
      : effectiveEnd(current as unknown as Point, pad, viewEnds) ??
        paddedEnd(current as unknown as Point, pad);
  }, [current, pad, viewEnds, source]);

  const resign = useCallback(
    async (state?: { time: number; wasPlaying: boolean }) => {
      if (!onResign) return;
      resumeAtRef.current = state?.time ?? null;
      const fresh = await onResign();
      if (fresh) setSrc(fresh);
    },
    [onResign]
  );

  // Escape closes, and the arrows walk the cards — this is a desktop
  // screen too, and reaching for the mouse to see the next card is the
  // difference between reviewing ninety cards and reviewing nine.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, go, index]);

  if (typeof document === "undefined") return null;

  const serve = current ? serving.get(current.id) ?? null : null;

  return createPortal(
    // Portalled to the body: position:fixed resolves against the nearest
    // TRANSFORMED ancestor, and any page-enter animation up the tree would
    // otherwise give this a "full screen" the size of a content column.
    <div className="fixed inset-0 z-[80] flex flex-col bg-ink">
      <div className="min-h-0 flex-1">
        {src ? (
          <ClipPlayer
            src={src}
            mode="cut"
            fill
            landscape
            // R2's presigned URLs carry no Access-Control-Allow-Origin, and
            // nothing here reads frame pixels, so asking for CORS would buy
            // a failed request and a reload on every load for nothing.
            readPixels={false}
            videoElRef={videoRef}
            playRef={playRef}
            onTime={onTime}
            onLoadedMetadata={onLoadedMetadata}
            onMediaError={(state) => void resign(state)}
            onStepPoint={source === "cut" ? (d) => go(index + d) : undefined}
            onReplay={
              source === "cut" ? () => go(index) : undefined
            }
            onClose={onClose}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-zinc-500">No video to play.</p>
          </div>
        )}
      </div>

      {source === "cut" && current && (
        <div
          className="shrink-0 border-t border-edge bg-ink px-4 py-3"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => go(index - 1)}
              disabled={index <= 0}
              className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:text-white disabled:opacity-40"
            >
              Back
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-sm font-medium text-zinc-200">
                {current.displayNo
                  ? `Card ${current.displayNo} of ${visibleCount}`
                  : "Removed card"}
                <span className="ml-2 font-normal text-zinc-500 tabular-nums">
                  {formatClock(current.t0)} → {formatClock(current.t1)}
                </span>
              </p>
              <p className="truncate text-xs text-zinc-500">
                {[
                  serve?.server
                    ? `${serve.server === "user" ? names.user : names.opponent} served`
                    : null,
                  current.deleted ? "the owner removed this one" : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || " "}
              </p>
            </div>
            <button
              type="button"
              onClick={() => go(index + 1)}
              disabled={index >= walk.length - 1}
              className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:text-white disabled:opacity-40"
            >
              Next
            </button>
          </div>

          <div className="mt-3 flex justify-center">
            <div className="inline-flex rounded-full border border-edge p-0.5">
              {(
                [
                  [true, "As the player sees it"],
                  [false, "Everything"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setAsPlayerSeesIt(value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    asPlayerSeesIt === value
                      ? "bg-cyan-glow/15 text-cyan-glow"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {source === "raw" && (
        <div
          className="shrink-0 border-t border-edge bg-ink px-4 py-3 text-center"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <p className="text-sm text-zinc-400">
            The original upload, uncut.
          </p>
        </div>
      )}
    </div>,
    document.body
  );
}
