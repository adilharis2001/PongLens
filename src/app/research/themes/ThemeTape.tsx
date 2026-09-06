"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ClipPlayer } from "@/app/match/[id]/ClipPlayer";
import { clipUrlFor, forgetClipUrl } from "./adminClipUrls";
import { cardWhere, type ThemeCardRow } from "./themeView";

/**
 * One theme's cards, played end to end, with sound.
 *
 * The analysis view beside each card is muted and draws on the picture:
 * it is for reading a single failure frame by frame. This is the other
 * half of the same question — what does this theme SOUND and look like
 * across eleven matches, watched at speed. `ClipPlayer` is the match
 * page's own player, so the gestures, the pinch zoom, the press-and-hold
 * speed, the mute toggle and the fullscreen all arrive without being
 * written a second time.
 *
 * Portalled to document.body: `position: fixed` resolves against the
 * nearest transformed ancestor, and a takeover the size of the content
 * column has been shipped from forgetting that before.
 */

const chevron =
  "flex h-11 w-11 items-center justify-center rounded-full border border-edge text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-25 disabled:hover:border-edge disabled:hover:text-zinc-300";

export function ThemeTape({
  label,
  rows,
  index,
  onIndex,
  onClose,
}: {
  label: string;
  rows: ThemeCardRow[];
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

  // Load this clip, then quietly mint the next. A themed card is a few
  // seconds long, which is not enough time to sit through a round trip
  // between them, so the round trip happens during the card before.
  useEffect(() => {
    if (!row) return;
    const mine = ++seq.current;
    setSrc(null);
    setFailed(false);
    void (async () => {
      const url = row.has_clip
        ? await clipUrlFor(row.match_id, row.point_id)
        : null;
      if (seq.current !== mine) return;
      if (url) setSrc(url);
      else setFailed(true);
    })();
    const next = rows[index + 1];
    if (next?.has_clip) void clipUrlFor(next.match_id, next.point_id);
  }, [index, row, rows]);

  // Esc closes, arrows walk. Space belongs to the player's own tap target
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

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!row) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-ink/95 p-4 backdrop-blur-sm">
      <div className="w-full max-w-5xl">
        {src ? (
          <ClipPlayer
            key={row.point_id}
            src={src}
            tall
            readPixels={false}
            onClose={onClose}
            onStepPoint={(delta) => go(index + delta)}
            onMediaError={() => {
              forgetClipUrl(row.match_id, row.point_id);
              setSrc(null);
              setFailed(true);
            }}
            onEnded={() => {
              if (index < rows.length - 1) go(index + 1);
            }}
          />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-2xl border border-edge bg-surface">
            <p className="text-sm text-zinc-500">
              {failed
                ? row.has_clip
                  ? "Couldn't load this clip."
                  : "This card has no clip."
                : "Loading…"}
            </p>
          </div>
        )}
      </div>

      <div className="flex w-full max-w-5xl items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          className={chevron}
          aria-label="Previous card"
        >
          ←
        </button>
        <div className="min-w-0 text-center">
          <p className="truncate text-sm font-medium text-zinc-200">
            {cardWhere(row)}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {label} · card {index + 1} of {rows.length}
          </p>
        </div>
        <button
          type="button"
          onClick={() => go(index + 1)}
          disabled={index === rows.length - 1}
          className={chevron}
          aria-label="Next card"
        >
          →
        </button>
      </div>
    </div>,
    document.body
  );
}
