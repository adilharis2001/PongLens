"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Tag } from "@/lib/types";

/**
 * Point tags (035): short labels on individual points, the owner's own
 * vocabulary. This file is the whole tagging UI — the chip row that lives
 * inside every Notes section, the picker sheet, and the small glyph the
 * timeline and cards reuse.
 *
 * The picker is built for point 40 of a match: recently-used chips first,
 * type to filter, and a repeat tag is two taps (open, tap chip).
 */

/** Suggested starter labels: shown greyed in the picker while the owner's
 *  vocabulary is empty of them; a row is only created on first real use. */
export const STARTER_LABELS = [
  "forehand error",
  "backhand error",
  "serve fault",
  "receive error",
  "footwork",
  "rushed",
];

export function TagGlyph({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.5 12.6V5.5a2 2 0 0 1 2-2h7.1a2 2 0 0 1 1.4.6l6.5 6.5a2 2 0 0 1 0 2.8l-7.1 7.1a2 2 0 0 1-2.8 0l-6.5-6.5a2 2 0 0 1-.6-1.4Z"
      />
      <circle cx="8.2" cy="8.2" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * The picker sheet: applied tags up top (tap to remove), the vocabulary
 * below (recent first, type to filter), starter suggestions while unused,
 * and "Create" for anything new. Bottom sheet on mobile, centered on
 * desktop — same overlay pattern as the delete confirm.
 */
export function TagPicker({
  pointLabel,
  vocab,
  appliedIds,
  onToggle,
  onCreate,
  onClose,
}: {
  /** "Point 12" — names the sheet so tagging from the timeline is unambiguous. */
  pointLabel: string;
  /** Owner's tags, pre-sorted most-recently-used first. */
  vocab: Tag[];
  appliedIds: Set<string>;
  /** Apply/remove an existing tag on the point. */
  onToggle: (tag: Tag) => void;
  /** Create a new tag (or revive a starter) and apply it. */
  onCreate: (label: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Desktop gets the keyboard focus; on mobile auto-focus would throw the
  // soft keyboard over the chips, which are the fast path.
  useEffect(() => {
    if (window.matchMedia("(min-width: 640px)").matches) {
      inputRef.current?.focus();
    }
  }, []);

  const q = query.trim().toLowerCase();
  const shown = q
    ? vocab.filter((t) => t.label.toLowerCase().includes(q))
    : vocab;
  const known = new Set(vocab.map((t) => t.label.toLowerCase()));
  const starters = STARTER_LABELS.filter(
    (s) => !known.has(s) && (!q || s.includes(q))
  );
  const exactExists =
    q !== "" &&
    (known.has(q) || starters.some((s) => s === q));
  const canCreate = q !== "" && !exactExists && q.length <= 40;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div className="relative w-full rounded-t-2xl border border-edge bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-200">
            Tags · {pointLabel}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-edge bg-surface px-3.5 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
          >
            Done
          </button>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canCreate) {
              onCreate(query.trim());
              setQuery("");
            }
          }}
          placeholder="Search or create a tag"
          aria-label="Search or create a tag"
          autoComplete="off"
          maxLength={40}
          className="mt-3 w-full rounded-xl border border-edge bg-surface-2/40 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
        />

        <div className="mt-3 flex max-h-[45vh] flex-wrap gap-2 overflow-y-auto">
          {canCreate && (
            <button
              type="button"
              onClick={() => {
                onCreate(query.trim());
                setQuery("");
              }}
              className="rounded-full border border-cyan-glow/60 bg-cyan-glow/10 px-3 py-1.5 text-xs font-medium text-cyan-glow transition-colors hover:bg-cyan-glow/20"
            >
              Create &ldquo;{query.trim()}&rdquo;
            </button>
          )}
          {shown.map((t) => {
            const on = appliedIds.has(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onToggle(t)}
                aria-pressed={on}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  on
                    ? "border-cyan-glow/60 bg-cyan-glow/10 text-cyan-glow"
                    : "border-edge text-zinc-300 hover:border-cyan-glow/40 hover:text-white"
                }`}
              >
                {t.label}
                {on && <span className="ml-1.5 text-cyan-glow/80">✓</span>}
              </button>
            );
          })}
          {starters.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onCreate(s)}
              className="rounded-full border border-dashed border-edge px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:border-cyan-glow/40 hover:text-zinc-300"
            >
              {s}
            </button>
          ))}
          {shown.length === 0 && starters.length === 0 && !canCreate && (
            <p className="py-2 text-sm text-zinc-500">
              Type to create your first tag.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The chip row inside a Notes section: this point's tags plus an add
 * button that opens the picker. Chips read; the picker edits — one place
 * to learn.
 */
export function PointTags({
  pointLabel,
  tags,
  vocab,
  onToggle,
  onCreate,
}: {
  pointLabel: string;
  /** Tags currently on this point (resolved rows). */
  tags: Tag[];
  vocab: Tag[];
  onToggle: (tag: Tag) => void;
  onCreate: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const appliedIds = useMemo(() => new Set(tags.map((t) => t.id)), [tags]);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-cyan-glow/40 bg-cyan-glow/5 px-2.5 py-1 text-[11px] font-medium text-cyan-glow/90 transition-colors hover:bg-cyan-glow/15"
        >
          {t.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-edge px-2.5 py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:border-cyan-glow/40 hover:text-zinc-300"
      >
        <TagGlyph className="h-3 w-3" />
        {tags.length === 0 ? "Add tag" : "Edit"}
      </button>
      {open && (
        <TagPicker
          pointLabel={pointLabel}
          vocab={vocab}
          appliedIds={appliedIds}
          onToggle={onToggle}
          onCreate={onCreate}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
