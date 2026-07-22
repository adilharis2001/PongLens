"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Note, Point } from "@/lib/types";
import type { MapLabels } from "./PlacementMap";
import { PointDetail } from "./PointDetail";
import type { ServeInfo } from "./serving";
import type { Side } from "./sides";

/**
 * Mobile point view: full-screen sheet wrapping PointDetail.
 * Prev/next buttons in the header plus horizontal swipe to move
 * between points. Desktop (lg+) uses the split-view pane instead.
 */
export function PointSheet({
  matchId,
  ownerId,
  point,
  serve,
  notes,
  userId,
  userSide,
  gameIndex,
  mapLabels,
  strictness,
  index,
  total,
  onClose,
  onPrev,
  onNext,
  onPointUpdate,
  onNoteAdded,
  onDelete,
  onSplit,
  onClipEdited,
}: {
  matchId: string;
  ownerId: string;
  point: Point;
  serve: ServeInfo | undefined;
  notes: Note[];
  userId: string;
  userSide: Side | null;
  gameIndex: number;
  mapLabels: MapLabels;
  strictness: string;
  index: number; // 0-based position in the (visible) point list
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onPointUpdate: (patch: Partial<Point>) => void;
  onNoteAdded: (note: Note) => void;
  onDelete: (point: Point) => void;
  onSplit: (newPoint: Point) => void;
  onClipEdited: () => void;
}) {
  const touchRef = useRef<{ x: number; y: number } | null>(null);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = touchRef.current;
      touchRef.current = null;
      if (!start) return;
      // Don't hijack video scrubbing or text selection inside inputs.
      const el = e.target as HTMLElement;
      if (el.closest("video, input, textarea, select, audio")) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) onNext();
      else onPrev();
    },
    [onNext, onPrev]
  );

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      {/* backdrop */}
      <button
        type="button"
        aria-label="Close point view"
        onClick={onClose}
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
      />
      {/* panel: full-screen sheet on mobile, right panel on sm+ */}
      <div
        className="absolute inset-x-0 bottom-0 top-10 overflow-y-auto rounded-t-2xl border border-edge bg-surface shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[430px] sm:rounded-none sm:border-y-0 sm:border-r-0"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-edge/70 bg-surface/95 px-4 py-3 backdrop-blur">
          <p className="text-sm font-semibold">
            Point {index + 1}
            <span className="ml-2 text-xs font-normal text-zinc-500">
              {index + 1} of {total}
            </span>
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onPrev}
              disabled={index === 0}
              aria-label="Previous point"
              className="rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-40"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={index >= total - 1}
              aria-label="Next point"
              className="rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-40"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ml-1 rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-4 pb-10">
          <PointDetail
            key={point.id}
            matchId={matchId}
            ownerId={ownerId}
            point={point}
            serve={serve}
            notes={notes}
            userId={userId}
            userSide={userSide}
            gameIndex={gameIndex}
            mapLabels={mapLabels}
            strictness={strictness}
            onPointUpdate={onPointUpdate}
            onNoteAdded={onNoteAdded}
            onDelete={onDelete}
            onSplit={onSplit}
            onClipEdited={onClipEdited}
          />
        </div>
      </div>
    </div>
  );
}
