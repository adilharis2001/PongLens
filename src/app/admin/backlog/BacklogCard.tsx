"use client";

import { monthDay } from "@/lib/backlog/schedule";
import { tagTone } from "@/lib/backlog/tagTone";
import type { BacklogItem } from "@/lib/backlog/types";

/**
 * One row in the list. The whole row opens the item; the tick is its own
 * control with its own hit area, because a mis-tap that completes a task
 * is more annoying than one that opens it.
 *
 * The tick is server-confirmed: the row holds its pending look while the
 * write is in flight and reverts if it fails. Nothing here ever shows a
 * state the database has not agreed to.
 */
export function BacklogCard({
  item,
  today,
  open,
  pending,
  waitingOn,
  dragging,
  dropHint,
  dropAllowed,
  justChanged,
  onOpen,
  onTick,
  onPointerDown,
}: {
  item: BacklogItem;
  today: string;
  open: boolean;
  pending: boolean;
  /** This card is the one currently lifted. */
  dragging?: boolean;
  /** Set while a lifted card is hovering this one. */
  dropHint?: string | null;
  dropAllowed?: boolean;
  /** Briefly true right after a drop landed on or moved this card, so the
   *  eye can find where it went when the list reorders underneath. */
  justChanged?: boolean;
  /** What this item is still waiting on, or null when it can be started.
   *  Advisory: a waiting card is dimmed and labelled, never disabled —
   *  the day the real world happens out of order is the day you most
   *  need to just tick the thing. */
  waitingOn?: string | null;
  onOpen: () => void;
  onTick: () => void;
  onPointerDown?: (event: React.PointerEvent) => void;
}) {
  const done = item.lane === "done";
  const ticked = pending ? !done : done;
  const tone = tagTone(item.tag);
  const overdue =
    !done && item.target_date !== null && item.target_date < today;
  const waiting = !done && !!waitingOn;

  const hovered = dropHint !== null && dropHint !== undefined;

  return (
    <div
      data-card-id={item.id}
      data-drop-item={item.id}
      onPointerDown={onPointerDown}
      className={`relative flex items-start gap-1 rounded-2xl border transition-colors ${
        hovered
          ? dropAllowed
            ? "border-cyan-glow bg-cyan-glow/10"
            : "border-amber-400/60 bg-amber-400/5"
          : open
            ? "border-cyan-glow/40 bg-surface-2"
            : justChanged
              ? "border-cyan-glow/60 bg-surface"
              : "border-edge bg-surface hover:border-zinc-700"
      } ${pending ? "opacity-60" : ""} ${waiting && !hovered ? "opacity-70" : ""} ${
        dragging ? "opacity-30" : ""
      }`}
    >
      {hovered && (
        <span
          className={`pointer-events-none absolute -top-2.5 right-3 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            dropAllowed
              ? "border-cyan-glow bg-ink text-cyan-glow"
              : "border-amber-400/60 bg-ink text-amber-300"
          }`}
        >
          {dropHint}
        </span>
      )}
      <button
        type="button"
        onClick={onTick}
        data-no-drag
        aria-label={ticked ? `Reopen ${item.title}` : `Complete ${item.title}`}
        className="flex h-12 w-12 shrink-0 items-center justify-center"
      >
        <span
          className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border transition-colors ${
            ticked
              ? "border-cyan-glow bg-cyan-glow/20 text-cyan-glow"
              : "border-zinc-600 text-transparent hover:border-cyan-glow/60"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4 10-10" />
          </svg>
        </span>
      </button>

      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        className="min-w-0 flex-1 py-3 pr-3 text-left"
      >
        <span
          className={`block text-[15px] leading-snug ${
            ticked ? "text-zinc-500 line-through" : "text-zinc-100"
          }`}
        >
          {item.title}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {item.tag && (
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone.chip}`}
            >
              {item.tag}
            </span>
          )}
          {/* No date chip: the section heading above already says when,
              and printing it again on every card is the same noise as a
              chapter list repeating the clock. Only the exceptions are
              worth a word — finished, or past its date. */}
          {done && (
            <span className="rounded-full border border-edge bg-ink/40 px-2 py-0.5 text-[11px] text-zinc-500">
              Done
            </span>
          )}
          {overdue && (
            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-300">
              {monthDay(item.target_date!)}
            </span>
          )}
          {waiting && (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-zinc-700 bg-ink/60 px-2 py-0.5 text-[11px] text-zinc-400">
              <svg
                viewBox="0 0 24 24"
                className="h-3 w-3 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path strokeLinecap="round" d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              <span className="truncate">{waitingOn}</span>
            </span>
          )}
          {item.notes.trim() !== "" && (
            <span className="text-[11px] text-zinc-600" title="Has notes">
              Notes
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
