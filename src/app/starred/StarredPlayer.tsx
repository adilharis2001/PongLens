"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClipPlayer } from "@/app/match/[id]/ClipPlayer";
import { clipUrlFor, forgetClipUrl } from "./clipUrls";
import { durationLabel, type StarredPointRow } from "./starred";

/**
 * Starred points played back to back, across matches: Play all, or Play on
 * a selection. Tapping a single point opens it inside its match instead, in
 * the ordinary point view.
 *
 * `ClipPlayer` is the match page's own player, so the gestures, the pinch
 * zoom, the press-and-hold speed and the persistence of both arrive here
 * without being written twice. This file adds only what makes it a run of
 * clips: advance on 'ended', the "‹ 3 / 12 ›" counter the public share page
 * uses, and reading one clip ahead so the gap between rallies is not a
 * spinner. (Until 2026-09-22 it carried its own outcome line, step buttons,
 * Remove star and Open in match; Adil asked for the shared player instead.)
 *
 * Portalled to document.body. `position: fixed` resolves against the
 * nearest transformed ancestor, and AppShell's `.page-enter` holds a
 * transform while it animates in — a takeover the size of the content
 * column has been shipped from that mistake before.
 */

const chevron =
  "flex h-11 w-11 items-center justify-center rounded-full border border-edge text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-25 disabled:hover:border-edge disabled:hover:text-zinc-300";

export function StarredPlayer({
  rows,
  index,
  onIndex,
  onClose,
  titleOf,
}: {
  rows: StarredPointRow[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** The match a row belongs to, as the shelf names it. */
  titleOf: (row: StarredPointRow) => string;
}) {
  const row = rows[index];
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  const go = useCallback(
    (i: number) => {
      if (i < 0 || i >= rows.length) return;
      onIndex(i);
    },
    [onIndex, rows.length]
  );

  // Load this clip, then quietly mint the next one. The read-ahead is the
  // difference between a tape and a slideshow: a six second rally does not
  // leave time to notice a round trip, so the round trip happens during
  // the rally before it.
  useEffect(() => {
    if (!row) return;
    const mine = ++seq.current;
    setSrc(null);
    setFailed(false);
    void (async () => {
      const url = row.has_clip ? await clipUrlFor(row.match_id, row.id) : null;
      if (seq.current !== mine) return;
      if (url) setSrc(url);
      else setFailed(true);
    })();
    const next = rows[index + 1];
    if (next?.has_clip) void clipUrlFor(next.match_id, next.id);
  }, [index, row, rows]);

  // Esc closes, arrows walk. Space is left to the player's own tap target
  // so the two never fight over play/pause.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(index + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(index - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, onClose]);

  // The page behind must not scroll under the takeover.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!row) return null;

  const duration = durationLabel(row);

  const view = (
    <div className="fixed inset-0 z-[80] flex flex-col bg-ink/97 backdrop-blur-sm">
      <header className="flex shrink-0 items-start justify-between gap-4 px-5 pb-4 pt-5 sm:px-8">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-100">
            Point {row.display_no}
            <span className="pl-2 font-normal text-zinc-500">{titleOf(row)}</span>
          </p>
          {duration && (
            <p className="mt-0.5 text-xs tabular-nums text-zinc-500">{duration}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5">
        <div className="w-full max-w-5xl overflow-hidden bg-black sm:rounded-2xl sm:border sm:border-edge">
          {src ? (
            <ClipPlayer
              key={row.id}
              src={src}
              tall
              readPixels={false}
              onStepPoint={(delta) => go(index + delta)}
              onMediaError={() => {
                // A signature the bucket refused, most likely. Drop it and
                // ask again rather than leaving a dead frame on screen.
                forgetClipUrl(row.match_id, row.id);
                setSrc(null);
                setFailed(true);
              }}
              onEnded={() => {
                if (index < rows.length - 1) go(index + 1);
              }}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center">
              <p className="text-sm text-zinc-600">
                {failed
                  ? row.edited
                    ? "This clip is still being recut."
                    : "Couldn't load this clip."
                  : "Loading…"}
              </p>
            </div>
          )}
        </div>

        {rows.length > 1 && (
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => go(index - 1)}
              disabled={index === 0}
              aria-label="Previous point"
              className={chevron}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <span className="min-w-14 text-center text-sm font-semibold tabular-nums text-zinc-300">
              {index + 1} / {rows.length}
            </span>
            <button
              type="button"
              onClick={() => go(index + 1)}
              disabled={index === rows.length - 1}
              aria-label="Next point"
              className={chevron}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(view, document.body);
}
