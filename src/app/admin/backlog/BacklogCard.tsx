"use client";

import { whenLabel } from "@/lib/backlog/schedule";
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
  onOpen,
  onTick,
}: {
  item: BacklogItem;
  today: string;
  open: boolean;
  pending: boolean;
  onOpen: () => void;
  onTick: () => void;
}) {
  const done = item.lane === "done";
  const ticked = pending ? !done : done;
  const tone = tagTone(item.tag);
  const overdue =
    !done && item.target_date !== null && item.target_date < today;

  return (
    <div
      className={`flex items-start gap-1 rounded-2xl border transition-colors ${
        open
          ? "border-cyan-glow/40 bg-surface-2"
          : "border-edge bg-surface hover:border-zinc-700"
      } ${pending ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        onClick={onTick}
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
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              overdue
                ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                : "border-edge bg-ink/40 text-zinc-500"
            }`}
          >
            {done ? "Done" : whenLabel(item.target_date, today)}
          </span>
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
