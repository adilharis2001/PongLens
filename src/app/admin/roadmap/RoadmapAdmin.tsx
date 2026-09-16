"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SectionHeading } from "@/components/SectionHeading";
import {
  STAGE_DOT,
  STAGE_LABEL,
  STAGE_ORDER,
  groupRoadmap,
  isRoadmapStage,
  moveWithinStage,
  nextPosition,
  shippedLabel,
  type RoadmapItem,
  type RoadmapStage,
} from "@/lib/roadmap";

/**
 * Editing the roadmap: add an entry, change its words or stage, put it
 * above or below its neighbours, remove it. Everything writes straight
 * to roadmap_items under the admin policies and the page shows the row
 * the database handed back, so what you see is what the public page
 * says.
 *
 * Kept deliberately plain. The roadmap is a title and a sentence per
 * entry, and a form with two fields does not need drag and drop.
 */

const FIELD =
  "w-full rounded-xl border border-edge bg-surface-2/60 px-4 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/50";
const SELECT =
  "rounded-xl border border-edge bg-surface-2 px-3 py-2.5 text-sm text-zinc-200 focus:border-cyan-glow/50 focus:outline-none";
const PILL =
  "inline-flex min-h-9 items-center justify-center rounded-full border border-edge px-3.5 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-50";
const PRIMARY =
  "glow-cta inline-flex min-h-9 items-center justify-center rounded-full bg-cyan-glow px-4 text-sm font-semibold text-ink disabled:opacity-50";
const WORD = "text-sm text-zinc-400 transition-colors hover:text-white disabled:opacity-40";

type Draft = {
  title: string;
  description: string;
  stage: RoadmapStage;
  shipped_at: string;
  link: string;
};

const EMPTY: Draft = { title: "", description: "", stage: "planned", shipped_at: "", link: "" };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toRow(d: Draft) {
  return {
    title: d.title.trim(),
    description: d.description.trim(),
    stage: d.stage,
    shipped_at: d.stage === "shipped" ? d.shipped_at || today() : null,
    link: d.link.trim() || null,
  };
}

export function RoadmapAdmin({ initialItems }: { initialItems: RoadmapItem[] }) {
  const [items, setItems] = useState<RoadmapItem[]>(initialItems);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase.from("roadmap_items").select("*");
    if (readError) {
      setError("Could not reload the roadmap. Refresh the page.");
      return;
    }
    setItems((data ?? []) as RoadmapItem[]);
  }, []);

  const add = useCallback(
    async (draft: Draft) => {
      const supabase = createClient();
      const { error: insertError } = await supabase.from("roadmap_items").insert({
        ...toRow(draft),
        position: nextPosition(items, draft.stage),
      });
      if (insertError) {
        setError("Could not add that. Check the title and try again.");
        return false;
      }
      setError(null);
      await reload();
      return true;
    },
    [items, reload]
  );

  const save = useCallback(
    async (item: RoadmapItem, draft: Draft) => {
      const supabase = createClient();
      const row = toRow(draft);
      // Moving stage puts the entry last in its new stage.
      const position = draft.stage === item.stage ? item.position : nextPosition(items, draft.stage);
      const { error: updateError } = await supabase
        .from("roadmap_items")
        .update({ ...row, position })
        .eq("id", item.id);
      if (updateError) {
        setError("Could not save that. Try again.");
        return false;
      }
      setError(null);
      await reload();
      return true;
    },
    [items, reload]
  );

  const move = useCallback(
    async (item: RoadmapItem, direction: "up" | "down") => {
      const changes = moveWithinStage(items, item.id, direction);
      if (changes.length === 0) return;
      const supabase = createClient();
      for (const change of changes) {
        const { error: moveError } = await supabase
          .from("roadmap_items")
          .update({ position: change.position })
          .eq("id", change.id);
        if (moveError) {
          setError("Could not reorder. Try again.");
          break;
        }
      }
      await reload();
    },
    [items, reload]
  );

  const remove = useCallback(
    async (item: RoadmapItem) => {
      const supabase = createClient();
      const { error: deleteError } = await supabase.from("roadmap_items").delete().eq("id", item.id);
      if (deleteError) {
        setError("Could not remove that. Try again.");
        return;
      }
      setError(null);
      await reload();
    },
    [reload]
  );

  const groups = groupRoadmap(items);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Roadmap</h1>
        <Link
          href="/roadmap"
          className="text-sm font-medium text-cyan-glow transition-colors hover:text-white"
        >
          Open the public page
        </Link>
      </div>

      <AddCard onAdd={add} />

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      <div className="mt-10 space-y-8">
        {STAGE_ORDER.map((stage) => {
          const group = groups.find((g) => g.stage === stage);
          const rows = group?.items ?? [];
          return (
            <section key={stage}>
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[stage]}`} aria-hidden="true" />
                <SectionHeading>{STAGE_LABEL[stage]}</SectionHeading>
                <span className="text-xs text-zinc-600">{rows.length}</span>
              </div>
              {rows.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-600">Nothing here.</p>
              ) : (
                <ul className="mt-3 space-y-2.5">
                  {rows.map((item, index) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      first={index === 0}
                      last={index === rows.length - 1}
                      onSave={(draft) => save(item, draft)}
                      onMove={(dir) => void move(item, dir)}
                      onRemove={() => void remove(item)}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Fields({
  draft,
  setDraft,
  autoFocus = false,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-3">
      <input
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        placeholder="Title"
        aria-label="Title"
        maxLength={120}
        autoFocus={autoFocus}
        className={FIELD}
      />
      <textarea
        value={draft.description}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        placeholder="One sentence on what it means for a player."
        aria-label="Description"
        rows={2}
        maxLength={400}
        className={`${FIELD} resize-y`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={draft.stage}
          onChange={(e) => {
            const stage = e.target.value;
            if (isRoadmapStage(stage)) setDraft({ ...draft, stage });
          }}
          aria-label="Stage"
          className={SELECT}
        >
          {STAGE_ORDER.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
        {draft.stage === "shipped" && (
          <input
            type="date"
            value={draft.shipped_at}
            onChange={(e) => setDraft({ ...draft, shipped_at: e.target.value })}
            aria-label="Shipped on"
            className={SELECT}
          />
        )}
        <input
          value={draft.link}
          onChange={(e) => setDraft({ ...draft, link: e.target.value })}
          placeholder="Link to try it (optional), like /learn"
          aria-label="Link"
          className={`${FIELD} min-w-[12rem] flex-1`}
        />
      </div>
    </div>
  );
}

function AddCard({ onAdd }: { onAdd: (draft: Draft) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 flex w-full items-center gap-3 rounded-2xl border border-dashed border-edge px-4 py-3 text-left text-sm text-zinc-400 transition-colors hover:border-cyan-glow/40 hover:text-zinc-200"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-edge">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path strokeLinecap="round" d="M12 5v14M5 12h14" />
          </svg>
        </span>
        Add an entry
      </button>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-edge bg-surface p-5">
      <Fields draft={draft} setDraft={setDraft} autoFocus />
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setDraft(EMPTY);
          }}
          className={PILL}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !draft.title.trim()}
          onClick={async () => {
            setBusy(true);
            const ok = await onAdd(draft);
            setBusy(false);
            if (ok) {
              setDraft(EMPTY);
              setOpen(false);
            }
          }}
          className={PRIMARY}
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}

function ItemCard({
  item,
  first,
  last,
  onSave,
  onMove,
  onRemove,
}: {
  item: RoadmapItem;
  first: boolean;
  last: boolean;
  onSave: (draft: Draft) => Promise<boolean>;
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    title: item.title,
    description: item.description,
    stage: item.stage,
    shipped_at: item.shipped_at ?? "",
    link: item.link ?? "",
  });

  const when = item.stage === "shipped" ? shippedLabel(item.shipped_at) : null;

  if (editing) {
    return (
      <li className="rounded-2xl border border-cyan-glow/30 bg-surface p-5">
        <Fields draft={draft} setDraft={setDraft} autoFocus />
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setDraft({
                title: item.title,
                description: item.description,
                stage: item.stage,
                shipped_at: item.shipped_at ?? "",
                link: item.link ?? "",
              });
            }}
            className={PILL}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !draft.title.trim()}
            onClick={async () => {
              setBusy(true);
              const ok = await onSave(draft);
              setBusy(false);
              if (ok) setEditing(false);
            }}
            className={PRIMARY}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-2xl border border-edge bg-surface px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium text-zinc-100">{item.title}</p>
            {when && <span className="shrink-0 text-[11px] text-zinc-500">{when}</span>}
          </div>
          {item.description && (
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">{item.description}</p>
          )}
          {item.link && <p className="mt-1 text-xs text-zinc-500">Try it: {item.link}</p>}
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            onClick={() => onMove("up")}
            disabled={first}
            aria-label="Move up"
            className={`${WORD} px-1`}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove("down")}
            disabled={last}
            aria-label="Move down"
            className={`${WORD} px-1`}
          >
            ↓
          </button>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3">
        {confirming ? (
          <>
            <span className="text-sm text-zinc-400">Remove this entry?</span>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onRemove();
              }}
              className={`${PILL} hover:border-amber-400/60 hover:text-amber-200`}
            >
              Remove
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={PILL}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setEditing(true)} className={WORD}>
              Edit
            </button>
            <button type="button" onClick={() => setConfirming(true)} className={WORD}>
              Remove
            </button>
          </>
        )}
      </div>
    </li>
  );
}
