"use client";

import {
  itemsInSection,
  visibleSections,
  type SectionKey,
} from "@/lib/backlog/sections";
import { tagTone } from "@/lib/backlog/tagTone";
import type { BacklogItem } from "@/lib/backlog/types";

/**
 * The same sections as the list, laid out left to right.
 *
 * Columns come from visibleSections, so the two views can never disagree
 * about where a card belongs — the list is this board rotated, and on a
 * laptop it shows the whole week at once instead of one section at a
 * time.
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
  waitingOn,
  onSelect,
}: {
  items: BacklogItem[];
  today: string;
  selectedId: string | null;
  /** What an item waits on, or null when it can be started. */
  waitingOn: (id: string) => string | null;
  onSelect: (id: string) => void;
}) {
  const sections = visibleSections(items, today);

  return (
    <div className="-mx-5 overflow-x-auto overscroll-x-contain px-5 pb-2 [scrollbar-width:thin] sm:-mx-6 sm:px-6">
      <div className="flex w-max snap-x snap-mandatory gap-3">
        {sections.map((section) => {
          const columnItems = itemsInSection(items, section.key, today);
          const accent: Record<string, string> = {
            overdue: "border-amber-400/30 bg-amber-400/5",
            today: "border-cyan-glow/30 bg-cyan-glow/5",
          };
          const headTone: Record<string, string> = {
            overdue: "text-amber-300",
            today: "text-cyan-glow",
          };
          return (
            <section
              key={section.key}
              className="w-[248px] shrink-0 snap-start sm:w-[264px]"
              aria-label={section.label}
            >
              <header
                className={`flex items-baseline justify-between gap-2 rounded-t-2xl border-x border-t px-3 py-2 ${
                  accent[section.key] ?? "border-edge bg-surface-2/50"
                }`}
              >
                <span
                  className={`truncate text-sm font-semibold ${
                    headTone[section.key] ?? "text-zinc-200"
                  }`}
                >
                  {section.label}
                </span>
                {columnItems.length > 0 && (
                  <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
                    {columnItems.length}
                  </span>
                )}
              </header>

              <div className="min-h-[7rem] space-y-2 rounded-b-2xl border-x border-b border-edge bg-ink/20 p-2">
                {columnItems.length === 0 ? (
                  <p className="px-1 py-3 text-[13px] text-zinc-600">Nothing.</p>
                ) : (
                  columnItems.map((item) => {
                    const tone = tagTone(item.tag);
                    const selected = item.id === selectedId;
                    const waiting = waitingOn(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelect(item.id)}
                        className={`flex w-full gap-2 rounded-xl border p-2.5 text-left transition-colors ${
                          selected
                            ? "border-cyan-glow/50 bg-surface-2"
                            : "border-edge bg-surface hover:border-zinc-700"
                        } ${waiting && !selected ? "opacity-70" : ""}`}
                      >
                        <span
                          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${tone.dot}`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] leading-snug text-zinc-100">
                            {item.title}
                          </span>
                          {item.tag && (
                            <span className="mt-1 block truncate text-[11px] text-zinc-500">
                              {item.tag}
                            </span>
                          )}
                          {waiting && (
                            <span className="mt-1 block truncate text-[11px] text-zinc-500">
                              {waiting}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export type { SectionKey };
