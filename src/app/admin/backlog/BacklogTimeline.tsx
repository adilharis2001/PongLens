"use client";

import { timelineColumns } from "@/lib/backlog/schedule";
import { tagTone } from "@/lib/backlog/tagTone";
import { LANE_LABEL, type BacklogItem } from "@/lib/backlog/types";

/**
 * The horizontal scale. Columns are uneven on purpose — a column per day
 * for the rest of this week, then a column per week, then one "Later"
 * that absorbs the rest — because a uniform scale spends as much width on
 * next March as on tomorrow, and the near days are the ones being
 * decided. Undated work leads rather than hides: "Someday" is the first
 * column, not a drawer.
 *
 * Full-bleed on every breakpoint: the scroller escapes AppShell's column
 * with negative margins and pads the same amount back inside, so the
 * first card lines up with the text above it and the last one can still
 * reach the screen edge. Scroll snapping makes a column-at-a-time swipe
 * land cleanly on a phone.
 */
export function BacklogTimeline({
  items,
  today,
  selectedId,
  onSelect,
}: {
  items: BacklogItem[];
  today: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const columns = timelineColumns(items, today);

  return (
    <div className="-mx-5 overflow-x-auto overscroll-x-contain px-5 pb-2 [scrollbar-width:thin] sm:-mx-6 sm:px-6">
      <div className="flex w-max snap-x snap-mandatory gap-3">
        {columns.map((column) => (
          <section
            key={column.key}
            className="w-[248px] shrink-0 snap-start sm:w-[264px]"
            aria-label={column.label}
          >
            <header
              className={`flex items-baseline justify-between gap-2 rounded-t-2xl border-x border-t px-3 py-2 ${
                column.kind === "overdue"
                  ? "border-amber-400/30 bg-amber-400/5"
                  : column.kind === "day" && column.from === today
                    ? "border-cyan-glow/30 bg-cyan-glow/5"
                    : "border-edge bg-surface-2/50"
              }`}
            >
              <span className="min-w-0">
                <span
                  className={`block truncate text-sm font-semibold ${
                    column.kind === "overdue"
                      ? "text-amber-300"
                      : column.kind === "day" && column.from === today
                        ? "text-cyan-glow"
                        : "text-zinc-200"
                  }`}
                >
                  {column.label}
                </span>
                {column.sub && (
                  <span className="block truncate text-[11px] text-zinc-500">
                    {column.sub}
                  </span>
                )}
              </span>
              {column.items.length > 0 && (
                <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
                  {column.items.length}
                </span>
              )}
            </header>

            <div className="min-h-[7rem] space-y-2 rounded-b-2xl border-x border-b border-edge bg-ink/20 p-2">
              {column.items.length === 0 ? (
                <p className="px-1 py-3 text-[13px] text-zinc-600">Nothing.</p>
              ) : (
                column.items.map((item) => {
                  const tone = tagTone(item.tag);
                  const selected = item.id === selectedId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelect(item.id)}
                      className={`flex w-full gap-2 rounded-xl border p-2.5 text-left transition-colors ${
                        selected
                          ? "border-cyan-glow/50 bg-surface-2"
                          : "border-edge bg-surface hover:border-zinc-700"
                      }`}
                    >
                      <span
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${tone.dot}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] leading-snug text-zinc-100">
                          {item.title}
                        </span>
                        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
                          <span>{LANE_LABEL[item.lane]}</span>
                          {item.tag && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="truncate">{item.tag}</span>
                            </>
                          )}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
