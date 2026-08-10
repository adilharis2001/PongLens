"use client";

import { useEffect, useRef, useState } from "react";

import { AutoTextarea } from "@/components/AutoTextarea";
import { DictateButton } from "@/components/DictateButton";
import {
  droppableSections,
  dateForSection,
  sectionForDate,
  type SectionKey,
} from "@/lib/backlog/sections";
import { normalizeTag, type BacklogItem } from "@/lib/backlog/types";
import { tagTone } from "@/lib/backlog/tagTone";

/** How long typing rests before the row is written. Long enough that a
 *  sentence is one write, short enough that closing the phone right after
 *  typing does not lose the last few words (the panel also flushes on
 *  unmount). */
const AUTOSAVE_MS = 700;

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * The item panel: everything about one backlog item, at a comfortable
 * width. Both views open this same component — the list expands it under
 * the card, the timeline drops it under the scroller — so there is one
 * place an item can be edited and one set of behaviours to trust.
 *
 * Split by how the write behaves, because the two need different
 * promises. The one-tap controls (when, tag, delete) write
 * immediately and say so if the write failed. The two text fields
 * autosave on a rest, which means the panel must never report "Saved"
 * from anything but a round trip that actually came back — the ticked
 * cues that used to reappear in the Journal were exactly this bug.
 */
export function BacklogEditor({
  item,
  tags,
  today,
  blockers,
  options,
  onPatch,
  onDelete,
  onClose,
  onAddBlocker,
  onRemoveBlocker,
}: {
  item: BacklogItem;
  /** Tags already in use, offered as chips under the field. */
  tags: string[];
  today: string;
  /** Everything this item waits on, finished or not. */
  blockers: BacklogItem[];
  /** What may still be added — self, existing blockers and anything that
   *  would close a loop are filtered out upstream, so an offered row can
   *  always be picked. */
  options: BacklogItem[];
  onPatch: (id: string, fields: Partial<BacklogItem>) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onClose: () => void;
  onAddBlocker: (blockerId: string) => Promise<boolean>;
  onRemoveBlocker: (blockerId: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes);
  const [tagDraft, setTagDraft] = useState(item.tag);
  const [save, setSave] = useState<SaveState>("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Partial<BacklogItem> | null>(null);

  // A different item in the same panel is a different document — but only
  // a different id is. Resetting whenever the item's fields change would
  // fire on the row coming back from a successful save, wiping the very
  // "Saved" the save just earned and leaving you to wonder whether your
  // notes made it.
  const loadedId = useRef(item.id);
  useEffect(() => {
    if (loadedId.current === item.id) return;
    loadedId.current = item.id;
    setTitle(item.title);
    setNotes(item.notes);
    setTagDraft(item.tag);
    setSave("idle");
    setConfirmDelete(false);
    setPicking(false);
    setSearch("");
  }, [item.id, item.title, item.notes, item.tag]);

  const flush = useRef(async () => {});
  flush.current = async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const fields = pending.current;
    if (!fields) return;
    pending.current = null;
    setSave("saving");
    const ok = await onPatch(item.id, fields);
    setSave(ok ? "saved" : "error");
  };

  // Leaving the panel with unwritten words is the one way this loses
  // work, so unmount flushes.
  useEffect(() => {
    const run = flush;
    return () => {
      void run.current();
    };
  }, []);

  function queue(fields: Partial<BacklogItem>) {
    pending.current = { ...(pending.current ?? {}), ...fields };
    setSave("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush.current(), AUTOSAVE_MS);
  }

  async function apply(fields: Partial<BacklogItem>) {
    setSave("saving");
    const ok = await onPatch(item.id, fields);
    setSave(ok ? "saved" : "error");
  }

  const currentSection: SectionKey = sectionForDate(item.target_date, today);

  return (
    <div className="rounded-2xl border border-edge bg-surface-2/60 p-4 sm:p-5">
      <div className="flex items-start gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Title</span>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              queue({ title: e.target.value });
            }}
            onBlur={() => void flush.current()}
            maxLength={200}
            className="w-full rounded-xl border border-edge bg-ink/50 px-3 py-2.5 text-base font-medium text-zinc-100 caret-cyan-glow outline-none focus:border-cyan-glow/50"
          />
        </label>
        <DictateButton
          label="Speak this title"
          onTranscript={(text) => {
            // Replaces rather than appends: a title is one line, and a
            // second dictation is almost always a correction of the
            // first, not a continuation of it.
            const next = text.slice(0, 200);
            setTitle(next);
            queue({ title: next });
          }}
          onError={() => setSave("error")}
        />
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Notes
          </span>
          <DictateButton
            label="Speak these notes"
            onTranscript={(text) => {
              const next = notes.trim() ? `${notes.trim()} ${text}` : text;
              setNotes(next);
              queue({ notes: next });
            }}
            onError={() => setSave("error")}
          />
        </div>
        <AutoTextarea
          variant="composer"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            queue({ notes: e.target.value });
          }}
          onBlur={() => void flush.current()}
          placeholder="Anything worth remembering when you pick this up."
          className="mt-2 rounded-xl border border-edge bg-ink/50 px-3 py-2.5 text-[15px] text-zinc-200"
        />
      </div>

      {/* One control where Lane and When used to be two. The section
          IS when it is meant to happen, and priority is now the card's
          position in the list rather than anything typed here. */}
      <div className="mt-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          When
        </span>
        <div className="-mx-4 mt-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <div className="flex w-max gap-2">
            {droppableSections(today).map((section) => {
              const active = currentSection === section.key;
              return (
                <button
                  key={section.key}
                  type="button"
                  onClick={() =>
                    void apply({
                      target_date: dateForSection(section.key, today),
                    })
                  }
                  className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow"
                      : "border-edge bg-ink/40 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {section.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* What has to come first. Listed as rows rather than chips: the
          useful part is the whole title, and a truncated chip turns
          "Stripe live keys" and "Stripe webhook" into the same word. */}
      <div className="mt-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Needs first
        </span>
        {blockers.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {blockers.map((blocker) => {
              const satisfied = blocker.lane === "done";
              return (
                <li
                  key={blocker.id}
                  className="flex items-center gap-2 rounded-xl border border-edge bg-ink/40 px-3 py-2"
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      satisfied
                        ? "border-cyan-glow bg-cyan-glow/20 text-cyan-glow"
                        : "border-zinc-600 text-transparent"
                    }`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-2.5 w-2.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3.5"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m5 13 4 4 10-10"
                      />
                    </svg>
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${
                      satisfied ? "text-zinc-500 line-through" : "text-zinc-200"
                    }`}
                  >
                    {blocker.title}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await onRemoveBlocker(blocker.id);
                      if (!ok) setSave("error");
                    }}
                    className="shrink-0 text-sm text-zinc-400 transition-colors hover:text-white"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {picking ? (
          <div className="mt-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Which one?"
              autoFocus
              className="w-full rounded-xl border border-edge bg-ink/50 px-3 py-2 text-sm text-zinc-200 caret-cyan-glow outline-none focus:border-cyan-glow/50"
            />
            <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto overscroll-contain">
              {options
                .filter((o) =>
                  o.title.toLowerCase().includes(search.trim().toLowerCase()),
                )
                .slice(0, 20)
                .map((option) => (
                  <li key={option.id}>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await onAddBlocker(option.id);
                        if (ok) {
                          setPicking(false);
                          setSearch("");
                        } else {
                          setSave("error");
                        }
                      }}
                      className="w-full truncate rounded-xl border border-edge bg-surface px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:border-cyan-glow/50"
                    >
                      {option.title}
                    </button>
                  </li>
                ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                setPicking(false);
                setSearch("");
              }}
              className="mt-2 rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:text-white"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="mt-2">
            {blockers.length === 0 && (
              <p className="mb-2 text-sm text-zinc-600">
                Nothing has to come first.
              </p>
            )}
            <button
              type="button"
              onClick={() => setPicking(true)}
              disabled={options.length === 0}
              className="rounded-full border border-edge bg-surface px-4 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:text-zinc-600 disabled:hover:border-edge"
            >
              Add something
            </button>
          </div>
        )}
      </div>

      <div className="mt-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Tag
        </span>
        <input
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onBlur={() => {
            const tag = normalizeTag(tagDraft);
            setTagDraft(tag);
            if (tag !== item.tag) void apply({ tag });
          }}
          placeholder="Anything you like"
          maxLength={40}
          className="mt-2 w-full rounded-xl border border-edge bg-ink/50 px-3 py-2 text-sm text-zinc-200 caret-cyan-glow outline-none focus:border-cyan-glow/50"
        />
        {tags.length > 0 && (
          <div className="-mx-4 mt-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
            <div className="flex w-max gap-2">
              {tags.map((tag) => {
                const active = tag === item.tag;
                const tone = tagTone(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      const next = active ? "" : tag;
                      setTagDraft(next);
                      void apply({ tag: next });
                    }}
                    className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors ${
                      active
                        ? tone.chip
                        : "border-edge bg-ink/40 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-zinc-500" aria-live="polite">
          {save === "saving"
            ? "Saving…"
            : save === "saved"
              ? "Saved"
              : save === "error"
                ? "Couldn't save that. Try again."
                : `Added ${new Date(item.created_at).toLocaleDateString(
                    "en-US",
                    { month: "short", day: "numeric" },
                  )}`}
        </span>
        <div className="flex items-center gap-2">
          {confirmDelete ? (
            <>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:text-white"
              >
                Keep
              </button>
              <button
                type="button"
                onClick={async () => {
                  const ok = await onDelete(item.id);
                  if (!ok) setSave("error");
                }}
                className="rounded-full border border-amber-400/40 px-4 py-1.5 text-sm text-amber-300 transition-colors hover:border-amber-400 hover:text-amber-200"
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-400 transition-colors hover:border-amber-400/40 hover:text-amber-300"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={async () => {
                  await flush.current();
                  onClose();
                }}
                className="rounded-full border border-edge bg-surface px-4 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white"
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
