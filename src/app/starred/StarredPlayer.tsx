"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClipPlayer } from "@/app/match/[id]/ClipPlayer";
import { deriveMatchTitleParts } from "@/lib/matchTitle";
import { clipUrlFor, forgetClipUrl } from "./clipUrls";
import type { StarredPointRow } from "./starred";

/**
 * A starred point, full screen, the way the match player shows video:
 * black edge to edge, the picture as large as the window allows, and the
 * clip player's expand button, which is the match player's own full-screen
 * code (real full screen with a landscape lock, or the rotated view on
 * iPhone Safari). The arrows step through the stars, across matches, and a
 * point that ends moves on to the next. Opened from the shelf, a
 * selection's Play and Home's row; never the match page (Adil, 2026-09-22).
 * The iOS twin is StarredPlayerScreen.
 *
 * `ClipPlayer` is the match page's own player, so the gestures, the pinch
 * zoom, the press-and-hold speed and the persistence of both arrive here
 * without being written twice.
 *
 * Portalled to document.body. `position: fixed` resolves against the
 * nearest transformed ancestor, and AppShell's `.page-enter` holds a
 * transform while it animates in — a takeover the size of the content
 * column has been shipped from that mistake before.
 */

/** The match player's corner-button style. */
const CORNER =
  "flex h-9 w-9 items-center justify-center rounded-full border border-edge bg-ink/70 text-zinc-300 backdrop-blur transition-colors hover:text-white disabled:opacity-30 disabled:hover:text-zinc-300";

export function StarredPlayer({
  rows,
  index,
  onIndex,
  onClose,
}: {
  rows: StarredPointRow[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
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

  const match = deriveMatchTitleParts({
    opponentName: row.opponent_name,
    venue: row.venue,
    playedAt: row.played_at,
    matchType: row.match_type,
  }).primary;

  const view = (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black">
      <header className="flex shrink-0 items-start justify-between gap-3 px-4 pb-3 pt-4 sm:px-6">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tabular-nums text-zinc-100">
            Point {row.display_no}
          </p>
          <p className="mt-0.5 truncate text-xs tabular-nums text-zinc-400">
            {match} · {index + 1} of {rows.length}
          </p>
        </div>
        {/* Previous and next are the clip player's own arrows on the
            picture's sides (onStepPoint), where the match player keeps
            them too; a second pair up here would only repeat them. */}
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close player"
            className={CORNER}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </header>

      {/* The rest of the window is the picture's: `fill` drops the clip
          player's height cap, `landscape` offers its expand button. */}
      <div className="relative min-h-0 flex-1">
        {src ? (
          <ClipPlayer
            key={row.id}
            src={src}
            fill
            landscape
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
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-zinc-500">
              {failed
                ? row.edited
                  ? "This clip is still being recut."
                  : "Couldn't load this clip."
                : "Loading…"}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(view, document.body);
}
