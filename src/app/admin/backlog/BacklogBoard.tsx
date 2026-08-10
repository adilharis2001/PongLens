"use client";

import { useCallback, useMemo, useState } from "react";

import { DictateButton } from "@/components/DictateButton";
import { SectionHeading } from "@/components/SectionHeading";
import { UpLink } from "@/components/UpLink";
import { Segmented } from "@/app/match/[id]/placementTable";
import { createClient } from "@/lib/supabase/client";
import {
  compareForBoard,
  dateForWhen,
  todayISO,
  WHEN_CHOICES,
  type WhenKey,
} from "@/lib/backlog/schedule";
import { tagTone } from "@/lib/backlog/tagTone";
import {
  LANE_LABEL,
  normalizeTag,
  OPEN_LANES,
  suggestedTags,
  type BacklogItem,
  type BacklogLane,
} from "@/lib/backlog/types";
import { BacklogCard } from "./BacklogCard";
import { BacklogEditor } from "./BacklogEditor";
import { BacklogTimeline } from "./BacklogTimeline";

type View = "list" | "timeline";

/** Done items kept on screen before the list stops growing. The rest stay
 *  in the table; this is a rendering limit, not a retention one. */
const DONE_SHOWN = 40;

/**
 * The backlog: capture at the top, then the same items read two ways.
 *
 * Capture is the feature. Everything above the views is one field, one
 * mic and one button, and a new item needs nothing but words — no lane,
 * no date, no tag. The refinements appear under the field only once
 * there is something to refine, and each is optional. An idea that has
 * to be classified before it can be written down is an idea that gets
 * written down somewhere else.
 *
 * Writes are never optimistic. Every action round-trips before the row
 * changes on screen, and a failure says so and keeps your words; the
 * Journal's ticked cues coming back to life is the bug this avoids.
 */
export function BacklogBoard({
  userId,
  initialItems,
}: {
  userId: string;
  initialItems: BacklogItem[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState(initialItems);
  const [view, setView] = useState<View>("list");
  const [filter, setFilter] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const [draft, setDraft] = useState("");
  const [draftTag, setDraftTag] = useState("");
  const [draftWhen, setDraftWhen] = useState<WhenKey>("someday");
  const [adding, setAdding] = useState(false);
  const [dictating, setDictating] = useState(false);

  // One clock read for the whole render tree: every relative label and
  // every column boundary has to agree on what "today" is.
  const [today] = useState(() => todayISO());

  const tags = useMemo(() => suggestedTags(items), [items]);
  const usedTags = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) if (item.tag) set.add(item.tag);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const visible = useMemo(
    () => (filter ? items.filter((i) => i.tag === filter) : items),
    [items, filter],
  );
  const open = useMemo(
    () => visible.filter((i) => i.lane !== "done").sort(compareForBoard),
    [visible],
  );
  const done = useMemo(
    () =>
      visible
        .filter((i) => i.lane === "done")
        .sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? "")),
    [visible],
  );

  const patch = useCallback(
    async (id: string, fields: Partial<BacklogItem>) => {
      const { data, error } = await supabase
        .from("backlog_items")
        .update(fields)
        .eq("id", id)
        .select()
        .single();
      if (error || !data) return false;
      setItems((prev) =>
        prev.map((i) => (i.id === id ? (data as BacklogItem) : i)),
      );
      return true;
    },
    [supabase],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("backlog_items")
        .delete()
        .eq("id", id);
      if (error) return false;
      setItems((prev) => prev.filter((i) => i.id !== id));
      setOpenId((current) => (current === id ? null : current));
      return true;
    },
    [supabase],
  );

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const title = draft.trim().slice(0, 200);
    if (!title || adding) return;
    setAdding(true);
    setNotice(null);
    const { data, error } = await supabase
      .from("backlog_items")
      .insert({
        author_id: userId,
        title,
        tag: normalizeTag(draftTag),
        lane: "next" satisfies BacklogLane,
        target_date: dateForWhen(draftWhen, today),
      })
      .select()
      .single();
    setAdding(false);
    if (error || !data) {
      // The typed words stay put. A shrug that also eats the sentence is
      // the reason people stop trusting a capture box.
      setNotice("Couldn't save that. Try again.");
      return;
    }
    setItems((prev) => [data as BacklogItem, ...prev]);
    setDraft("");
    setDraftTag("");
    setDraftWhen("someday");
  }

  async function tick(item: BacklogItem) {
    if (pending.has(item.id)) return;
    setNotice(null);
    setPending((s) => new Set(s).add(item.id));
    const ok = await patch(item.id, {
      lane: item.lane === "done" ? "next" : "done",
    });
    setPending((s) => {
      const next = new Set(s);
      next.delete(item.id);
      return next;
    });
    if (!ok) setNotice("Couldn't save that. Try again.");
  }

  const openItem = items.find((i) => i.id === openId) ?? null;

  const editor = openItem ? (
    <BacklogEditor
      item={openItem}
      tags={tags}
      today={today}
      onPatch={patch}
      onDelete={remove}
      onClose={() => setOpenId(null)}
    />
  ) : null;

  return (
    <>
      <UpLink href="/admin" label="Admin" />
      <h1 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">
        Backlog
      </h1>

      {/* Capture. Sticky so it stays reachable however far you scroll —
          the whole point is that jotting never costs a scroll back up.
          sticky-under-nav clears AppNav's own bars (globals.css): at
          top-0 this parks behind them and the field is invisible exactly
          when it is needed. */}
      <form
        onSubmit={add}
        className="bg-arena sticky-under-nav z-20 -mx-5 mt-5 px-5 py-3 sm:-mx-6 sm:px-6"
      >
        <div className="flex items-center gap-2 rounded-2xl border border-edge bg-surface p-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add to the backlog"
            maxLength={200}
            aria-label="Add to the backlog"
            className="min-w-0 flex-1 bg-transparent px-2 py-2 text-base text-zinc-100 caret-cyan-glow outline-none placeholder:text-zinc-600"
          />
          <DictateButton
            label="Speak a new item"
            onBusyChange={setDictating}
            onTranscript={(text) =>
              setDraft((d) => (d.trim() ? `${d.trim()} ${text}` : text))
            }
            onError={() => setNotice("Couldn't process the recording.")}
          />
          {!dictating && (
            <button
              type="submit"
              disabled={!draft.trim() || adding}
              className="shrink-0 rounded-full border border-cyan-glow/40 bg-cyan-glow/10 px-4 py-2 text-sm font-medium text-cyan-glow transition-colors hover:border-cyan-glow disabled:border-edge disabled:bg-transparent disabled:text-zinc-600"
            >
              {adding ? "Adding…" : "Add"}
            </button>
          )}
        </div>

        {/* Refinements appear only once there is something to refine. */}
        {draft.trim() !== "" && (
          <div className="mt-2 space-y-2">
            <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
              <div className="flex w-max gap-2">
                {tags.map((tag) => {
                  const active = normalizeTag(draftTag) === tag;
                  const tone = tagTone(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setDraftTag(active ? "" : tag)}
                      className={`whitespace-nowrap rounded-full border px-3 py-1 text-[13px] transition-colors ${
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
            <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
              <div className="flex w-max gap-2">
                {WHEN_CHOICES.map((choice) => (
                  <button
                    key={choice.key}
                    type="button"
                    onClick={() => setDraftWhen(choice.key)}
                    className={`whitespace-nowrap rounded-full border px-3 py-1 text-[13px] transition-colors ${
                      draftWhen === choice.key
                        ? "border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow"
                        : "border-edge bg-ink/40 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </form>

      {notice && (
        <p className="mt-2 text-sm text-amber-300" role="status">
          {notice}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <Segmented<View>
          ariaLabel="View"
          value={view}
          onChange={setView}
          options={[
            { key: "list", label: "List" },
            { key: "timeline", label: "Timeline" },
          ]}
        />
        <span className="text-sm text-zinc-500 tabular-nums">
          {open.length} open
        </span>
      </div>

      {usedTags.length > 0 && (
        <div className="-mx-5 mt-3 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
          <div className="flex w-max gap-2">
            <button
              type="button"
              onClick={() => setFilter(null)}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-[13px] transition-colors ${
                filter === null
                  ? "border-zinc-500 bg-surface-2 text-zinc-100"
                  : "border-edge bg-ink/40 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              All
            </button>
            {usedTags.map((tag) => {
              const active = filter === tag;
              const tone = tagTone(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setFilter(active ? null : tag)}
                  className={`whitespace-nowrap rounded-full border px-3 py-1 text-[13px] transition-colors ${
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

      {items.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-500">Nothing here yet.</p>
      ) : view === "timeline" ? (
        <div className="mt-5 space-y-4">
          <BacklogTimeline
            items={open}
            today={today}
            selectedId={openId}
            onSelect={(id) => setOpenId((c) => (c === id ? null : id))}
          />
          {editor}
        </div>
      ) : (
        <div className="mt-6 space-y-7">
          {OPEN_LANES.map((lane) => {
            const laneItems = open.filter((i) => i.lane === lane);
            return (
              <section key={lane}>
                <div className="flex items-baseline gap-2">
                  <SectionHeading>{LANE_LABEL[lane]}</SectionHeading>
                  {laneItems.length > 0 && (
                    <span className="text-xs tabular-nums text-zinc-600">
                      {laneItems.length}
                    </span>
                  )}
                </div>
                {laneItems.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-600">Nothing.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {laneItems.map((item) => (
                      <li key={item.id} className="space-y-2">
                        <BacklogCard
                          item={item}
                          today={today}
                          open={openId === item.id}
                          pending={pending.has(item.id)}
                          onOpen={() =>
                            setOpenId((c) => (c === item.id ? null : item.id))
                          }
                          onTick={() => void tick(item)}
                        />
                        {openId === item.id && editor}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          {done.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setShowDone((s) => !s)}
                aria-expanded={showDone}
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Done
                <span className="tabular-nums text-zinc-600">
                  {done.length}
                </span>
                <svg
                  viewBox="0 0 24 24"
                  className={`h-4 w-4 transition-transform ${
                    showDone ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {showDone && (
                <ul className="mt-2 space-y-2">
                  {done.slice(0, DONE_SHOWN).map((item) => (
                    <li key={item.id} className="space-y-2">
                      <BacklogCard
                        item={item}
                        today={today}
                        open={openId === item.id}
                        pending={pending.has(item.id)}
                        onOpen={() =>
                          setOpenId((c) => (c === item.id ? null : item.id))
                        }
                        onTick={() => void tick(item)}
                      />
                      {openId === item.id && editor}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}
