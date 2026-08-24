"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClipPlayer } from "@/app/match/[id]/ClipPlayer";
import type { CustomReasonLabels } from "@/app/match/[id]/scorecard";
import { clipUrlFor, forgetClipUrl } from "./clipUrls";
import {
  durationLabel,
  outcomeLabel,
  outcomeOf,
  reasonLabel,
  type StarredPointRow,
} from "./starred";

/**
 * The starred set, played as a sequence.
 *
 * `ClipPlayer` is the match page's own player, so the gestures, the pinch
 * zoom, the press-and-hold speed and the persistence of both all arrive
 * here without being written twice. Everything this file adds is what
 * turns one clip into a tape: advance on 'ended', prev/next, and reading
 * one clip ahead so the gap between rallies is not a spinner.
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
  reasons,
  onIndex,
  onClose,
  onUnstar,
}: {
  rows: StarredPointRow[];
  index: number;
  reasons: CustomReasonLabels;
  onIndex: (i: number) => void;
  onClose: () => void;
  onUnstar: (row: StarredPointRow) => void;
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

  const reason = reasonLabel(row, reasons);
  const duration = durationLabel(row);
  const outcome = outcomeOf(row);
  const outcomeTint =
    outcome === "won"
      ? "text-cyan-glow"
      : outcome === "lost"
        ? "text-magenta-soft"
        : outcome === "skipped"
          ? "text-amber-300"
          : "text-zinc-400";

  const view = (
    <div className="fixed inset-0 z-[80] flex flex-col bg-ink/97 backdrop-blur-sm">
      <header className="flex shrink-0 items-start justify-between gap-4 px-5 pb-4 pt-5 sm:px-8">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-100">
            Point {row.display_no}
            <span className="pl-2 font-normal text-zinc-500">
              {row.opponent_name?.trim() || "Match"}
            </span>
          </p>
          <p className="mt-0.5 text-xs tabular-nums text-zinc-500">
            {index + 1} of {rows.length}
            {duration ? ` · ${duration}` : ""}
          </p>
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

      {/* Picture and its controls travel together and centre as one
          block. Pinned to opposite ends of the screen they read as two
          unrelated things, and on a phone the buttons end up a thumb's
          journey away from the rally they act on. */}
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

        <div className="w-full max-w-5xl px-5 sm:px-8">
          <div className="flex items-center justify-between gap-3">
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

            <div className="flex min-w-0 flex-col items-center px-2 text-center">
              <span className={`truncate text-sm font-semibold ${outcomeTint}`}>
                {outcomeLabel(row)}
              </span>
              {reason && (
                <span className="mt-0.5 truncate text-xs text-zinc-500">
                  {reason}
                </span>
              )}
            </div>

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

          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              type="button"
              // The set shrinks under the player, so where it stands next is
              // the host's decision to make — it is the one holding the list.
              onClick={() => onUnstar(row)}
              className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-amber-300 transition-colors hover:border-amber-300/50"
            >
              Remove star
            </button>
            <Link
              href={`/match/${row.match_id}?p=${row.id}`}
              className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white"
            >
              Open in match
            </Link>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(view, document.body);
}
