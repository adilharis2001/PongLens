"use client";

import { useEffect, useRef, useState } from "react";

import { AutoTextarea } from "@/components/AutoTextarea";
import { DictateButton } from "@/components/DictateButton";
import { Segmented } from "@/app/match/[id]/placementTable";
import {
  dateForWhen,
  whenLabel,
  WHEN_CHOICES,
  type WhenKey,
} from "@/lib/backlog/schedule";
import {
  normalizeTag,
  OPEN_LANES,
  LANE_LABEL,
  type BacklogItem,
  type BacklogLane,
} from "@/lib/backlog/types";
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
 * promises. The one-tap controls (lane, when, tag, delete) write
 * immediately and say so if the write failed. The two text fields
 * autosave on a rest, which means the panel must never report "Saved"
 * from anything but a round trip that actually came back — the ticked
 * cues that used to reappear in the Journal were exactly this bug.
 */
export function BacklogEditor({
  item,
  tags,
  today,
  onPatch,
  onDelete,
  onClose,
}: {
  item: BacklogItem;
  /** Tags already in use, offered as chips under the field. */
  tags: string[];
  today: string;
  onPatch: (id: string, fields: Partial<BacklogItem>) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes);
  const [tagDraft, setTagDraft] = useState(item.tag);
  const [save, setSave] = useState<SaveState>("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
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

  const activeWhen: WhenKey | null =
    WHEN_CHOICES.find((c) => dateForWhen(c.key, today) === item.target_date)
      ?.key ?? (item.target_date === null ? "someday" : null);

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

      <div className="mt-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Lane
        </span>
        <div className="mt-2">
          <Segmented<BacklogLane>
            ariaLabel="Lane"
            value={item.lane === "done" ? "next" : item.lane}
            onChange={(lane) => void apply({ lane })}
            options={OPEN_LANES.map((lane) => ({
              key: lane,
              label: LANE_LABEL[lane],
            }))}
          />
        </div>
      </div>

      <div className="mt-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          When
        </span>
        <div className="-mx-4 mt-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <div className="flex w-max gap-2">
            {WHEN_CHOICES.map((choice) => {
              const active = activeWhen === choice.key;
              return (
                <button
                  key={choice.key}
                  type="button"
                  onClick={() =>
                    void apply({
                      target_date: dateForWhen(choice.key, today),
                    })
                  }
                  className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow"
                      : "border-edge bg-ink/40 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>
        </div>
        <label className="mt-2 flex items-center gap-2">
          <span className="text-sm text-zinc-500">Exact date</span>
          <input
            type="date"
            value={item.target_date ?? ""}
            onChange={(e) =>
              void apply({ target_date: e.target.value || null })
            }
            className="rounded-full border border-edge bg-ink/40 px-3 py-1.5 text-sm text-zinc-300 outline-none focus:border-cyan-glow/50"
          />
        </label>
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
                  )} · ${whenLabel(item.target_date, today)}`}
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
