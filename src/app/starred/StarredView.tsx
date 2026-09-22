"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CustomReasonLabels } from "@/app/match/[id]/scorecard";
import { PointFrame } from "./PointFrame";
import { ShareSelectionSheet } from "./ShareSelectionSheet";
import { StarredPlayer } from "./StarredPlayer";
import {
  DIRECTION_LABEL,
  durationLabel,
  groupStarred,
  outcomeLabel,
  outcomeOf,
  reasonLabel,
  selectedInShelfOrder,
  selectionSummary,
  summaryLine,
  type Outcome,
  type StarredGroup,
  type StarredPointRow,
} from "./starred";

/**
 * Every starred point the owner has, grouped by match, newest match first.
 * The rows arrive from starred_points() (134) already numbered and ordered,
 * so this file only draws them.
 *
 * Since 2026-09-22 (Adil): compact rows instead of big tiles, a point plays
 * full screen and steps on through the stars (never into the match page),
 * and Select picks points across matches to share as one video or one
 * link. No Play all: a point that ends moves on to the next star by itself.
 * Spec: docs/superpowers/specs/2026-09-22-starred-points-selection-design.md
 */

const OUTCOME_TEXT: Record<Outcome, string> = {
  won: "text-cyan-glow",
  lost: "text-magenta-soft",
  skipped: "text-amber-300",
  unscored: "text-zinc-400",
};

function StarGlyph({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"
      />
    </svg>
  );
}

function PlayGlyph({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

function ChevronRight({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
    </svg>
  );
}

function CheckCircle({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
        on ? "border-cyan-glow bg-cyan-glow text-ink" : "border-zinc-500"
      }`}
    >
      {on && (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      )}
    </span>
  );
}

/** The point's two lines: its number, then outcome · reason · length. */
function RowText({ row, reasons }: { row: StarredPointRow; reasons: CustomReasonLabels }) {
  const outcome = outcomeOf(row);
  const reason = reasonLabel(row, reasons);
  const direction = row.direction ? DIRECTION_LABEL[row.direction] : null;
  const rest = [reason, direction, row.edited ? "Updating clip" : durationLabel(row)]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-medium tabular-nums text-zinc-100">
        Point {row.display_no}
      </span>
      <span className="mt-0.5 block truncate text-xs">
        <span className={OUTCOME_TEXT[outcome]}>{outcomeLabel(row)}</span>
        {rest && <span className="text-zinc-500"> · {rest}</span>}
      </span>
    </span>
  );
}

function Row({
  row,
  reasons,
  selecting,
  selected,
  onOpen,
  onToggle,
  onUnstar,
}: {
  row: StarredPointRow;
  reasons: CustomReasonLabels;
  selecting: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onUnstar: () => void;
}) {
  const frame = <PointFrame row={row} className="aspect-video w-24 shrink-0 rounded-lg" />;

  if (selecting) {
    return (
      <li>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={selected}
          className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors sm:px-4 ${
            selected ? "bg-cyan-glow/5" : "hover:bg-surface-2/50"
          }`}
        >
          <CheckCircle on={selected} />
          {frame}
          <RowText row={row} reasons={reasons} />
        </button>
      </li>
    );
  }

  // The row plays the point full screen. The star sits beside the row's
  // button, not inside it: a button in a button is not markup, and the two
  // must not fight for the tap.
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Play point ${row.display_no}`}
        className="group flex w-full items-center gap-3 py-2.5 pl-3 pr-14 text-left transition-colors hover:bg-surface-2/50 sm:pl-4"
      >
        {frame}
        <RowText row={row} reasons={reasons} />
      </button>
      <button
        type="button"
        onClick={onUnstar}
        aria-label={`Remove the star from point ${row.display_no}`}
        className="absolute right-1.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-amber-300 transition-colors hover:text-amber-200"
      >
        <StarGlyph className="h-4.5 w-4.5" />
      </button>
    </li>
  );
}

function GroupHeader({
  group,
  selecting,
  allSelected,
  onToggleAll,
}: {
  group: StarredGroup;
  selecting: boolean;
  allSelected: boolean;
  onToggleAll: () => void;
}) {
  const words = (
    <span className="min-w-0">
      <span className="block truncate text-base font-semibold text-zinc-100">
        {group.title}
      </span>
      <span className="mt-0.5 block truncate text-xs text-zinc-500">
        {group.subtitle}
      </span>
    </span>
  );
  if (selecting) {
    return (
      <div className="flex items-end justify-between gap-4 px-1">
        {words}
        <button
          type="button"
          onClick={onToggleAll}
          className="shrink-0 py-1 text-sm font-medium text-cyan-glow transition-colors hover:text-white"
        >
          {allSelected ? "Deselect all" : "Select all"}
        </button>
      </div>
    );
  }
  return (
    <Link
      href={`/match/${group.matchId}`}
      className="group flex items-end justify-between gap-4 px-1"
    >
      {words}
      <span className="flex shrink-0 items-center gap-1 pb-0.5 text-xs font-medium tabular-nums text-zinc-500 transition-colors group-hover:text-zinc-300">
        {group.points.length} point{group.points.length === 1 ? "" : "s"}
        <ChevronRight className="h-4 w-4" />
      </span>
    </Link>
  );
}

/** The RPC's own order, for putting a row back where it came from. */
function byShelfOrder(a: StarredPointRow, b: StarredPointRow) {
  return (
    new Date(b.played_at).getTime() - new Date(a.played_at).getTime() ||
    a.display_no - b.display_no
  );
}

const PILL =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white";

export function StarredView({
  initialRows,
  reasonLabels,
}: {
  initialRows: StarredPointRow[];
  reasonLabels: { id: string; label: string }[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [player, setPlayer] = useState<{ rows: StarredPointRow[]; index: number } | null>(null);
  const [sharing, setSharing] = useState(false);
  /** The last star removed, so it can be put back without a round trip. */
  const [undo, setUndo] = useState<{ row: StarredPointRow; at: number } | null>(null);
  const undoTimer = useRef<number | null>(null);

  const groups = useMemo(() => groupStarred(rows), [rows]);
  const reasons: CustomReasonLabels = useMemo(
    () => new Map(reasonLabels.map((r) => [r.id, r.label])),
    [reasonLabels]
  );
  const picked = useMemo(() => selectedInShelfOrder(rows, selected), [rows, selected]);

  useEffect(
    () => () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    },
    []
  );

  const writeStar = useCallback(async (row: StarredPointRow, next: boolean) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("points")
      .update({ starred: next })
      .eq("id", row.id);
    return !error;
  }, []);

  const unstar = useCallback(
    async (row: StarredPointRow) => {
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      setUndo({ row, at: Date.now() });
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(() => setUndo(null), 7000);
      const ok = await writeStar(row, false);
      if (!ok) {
        // The write is the truth. Put it back rather than leave the page
        // showing a set the database disagrees with.
        setRows((rs) => [...rs, row].sort(byShelfOrder));
        setUndo(null);
      }
    },
    [writeStar]
  );

  const putBack = useCallback(async () => {
    if (!undo) return;
    const row = undo.row;
    setUndo(null);
    setRows((rs) => [...rs, row].sort(byShelfOrder));
    await writeStar(row, true);
  }, [undo, writeStar]);

  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((group: StarredGroup) => {
    setSelected((s) => {
      const next = new Set(s);
      const all = group.points.every((p) => next.has(p.id));
      for (const p of group.points) {
        if (all) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  }, []);

  const startSelecting = useCallback(() => {
    setUndo(null);
    setSelected(new Set());
    setSelecting(true);
  }, []);

  const stopSelecting = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  if (rows.length === 0) {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Starred points
        </h1>
        <div className="mt-8 rounded-2xl border border-edge bg-surface p-8 text-center">
          <p className="text-sm text-zinc-400">
            No starred points yet. Tap the star on any point to keep it here.
          </p>
          <Link
            href="/matches"
            className="mt-5 inline-flex rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white"
          >
            Go to matches
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Starred points
          </h1>
          <p className="mt-1.5 text-sm tabular-nums text-zinc-500">
            {summaryLine(rows)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selecting ? (
            <button type="button" onClick={stopSelecting} className={PILL}>
              Cancel
            </button>
          ) : (
            <button type="button" onClick={startSelecting} className={PILL}>
              Select
            </button>
          )}
        </div>
      </div>

      <div className={`mt-8 space-y-8 ${selecting ? "pb-28" : ""}`}>
        {groups.map((group) => (
          <section key={group.matchId}>
            <GroupHeader
              group={group}
              selecting={selecting}
              allSelected={group.points.every((p) => selected.has(p.id))}
              onToggleAll={() => toggleGroup(group)}
            />
            <ul className="mt-3 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
              {group.points.map((row) => (
                <Row
                  key={row.id}
                  row={row}
                  reasons={reasons}
                  selecting={selecting}
                  selected={selected.has(row.id)}
                  onOpen={() =>
                    setPlayer({ rows, index: rows.findIndex((r) => r.id === row.id) })
                  }
                  onToggle={() => toggle(row.id)}
                  onUnstar={() => void unstar(row)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* The selection bar: what is picked, and the two things to do with
          it. Clear of the phone's tab bar, like the Undo pill. */}
      {selecting && picked.length > 0 && (
        <div className="fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 md:bottom-8">
          <div className="flex w-full max-w-md items-center gap-2 rounded-2xl border border-edge bg-surface/95 py-2 pl-4 pr-2 shadow-lg backdrop-blur">
            <span className="min-w-0 flex-1 truncate text-sm font-medium tabular-nums text-zinc-200">
              {selectionSummary(picked)}
            </span>
            <button
              type="button"
              onClick={() => setPlayer({ rows: picked, index: 0 })}
              className={`${PILL} min-h-11`}
            >
              <PlayGlyph className="h-3.5 w-3.5" />
              Play
            </button>
            <button
              type="button"
              onClick={() => setSharing(true)}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
            >
              Share
            </button>
          </div>
        </div>
      )}

      {undo && !selecting && (
        <div className="fixed inset-x-0 bottom-24 z-40 flex justify-center px-5 md:bottom-8">
          <div className="flex items-center gap-4 rounded-full border border-edge bg-surface/95 py-2 pl-5 pr-2 shadow-lg backdrop-blur">
            <span className="text-sm text-zinc-300">Star removed</span>
            <button
              type="button"
              onClick={() => void putBack()}
              className="rounded-full border border-edge px-3.5 py-1.5 text-sm font-medium text-cyan-glow transition-colors hover:border-cyan-glow/60"
            >
              Undo
            </button>
          </div>
        </div>
      )}

      {player && (
        <StarredPlayer
          rows={player.rows}
          index={player.index}
          onIndex={(i) => setPlayer((p) => (p ? { ...p, index: i } : p))}
          onClose={() => setPlayer(null)}
        />
      )}

      <ShareSelectionSheet
        open={sharing}
        onClose={() => setSharing(false)}
        rows={picked}
      />
    </>
  );
}
