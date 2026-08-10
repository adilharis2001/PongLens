"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { DictateButton } from "@/components/DictateButton";
import { SectionHeading } from "@/components/SectionHeading";
import { UpLink } from "@/components/UpLink";
import { Segmented } from "@/app/match/[id]/placementTable";
import { createClient } from "@/lib/supabase/client";
import {
  blockedIds,
  eligibleBlockers,
  newlyStartable,
  pendingBlockers,
  scheduleConflict,
  splitByReadiness,
  waitingLabel,
  type BacklogBlocker,
} from "@/lib/backlog/blockers";
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
import { dropVerdict } from "@/lib/backlog/dragModel";
import { BacklogCard } from "./BacklogCard";
import { BacklogEditor } from "./BacklogEditor";
import { BacklogTimeline } from "./BacklogTimeline";
import { DependencyLines, GUTTER } from "./DependencyLines";
import { useCardDrag, type DragState } from "./useCardDrag";

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
  initialBlockers,
}: {
  userId: string;
  initialItems: BacklogItem[];
  initialBlockers: BacklogBlocker[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState(initialItems);
  const [edges, setEdges] = useState(initialBlockers);
  const [view, setView] = useState<View>("list");
  const [filter, setFilter] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  /** Kept apart from `notice` so good news is not styled as a problem. */
  const [released, setReleased] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  /** The card a drop just landed on, briefly ringed so the eye can follow
   *  it when the list reorders underneath. */
  const [justChanged, setJustChanged] = useState<string | null>(null);
  const [list, setList] = useState<HTMLElement | null>(null);
  /** A drag ends with a pointerup on the card, which the browser then
   *  turns into a click. Without this the editor would open every time a
   *  drag finished on top of something. */
  const dropEndedAt = useRef(0);

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

  // Readiness is derived from the graph on every render rather than
  // stored: an item is waiting while anything it needs is unfinished, so
  // ticking a blocker releases its dependents with no second state to
  // keep in step.
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const blocked = useMemo(() => blockedIds(items, edges), [items, edges]);

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
  const waitingCount = useMemo(
    () => open.filter((i) => blocked.has(i.id)).length,
    [open, blocked],
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
      // The database drops these by cascade; mirroring it here keeps the
      // client from briefly showing a card waiting on something gone.
      setEdges((prev) =>
        prev.filter((e) => e.item_id !== id && e.blocker_id !== id),
      );
      setOpenId((current) => (current === id ? null : current));
      return true;
    },
    [supabase],
  );

  const addBlocker = useCallback(
    async (itemId: string, blockerId: string) => {
      const { error } = await supabase
        .from("backlog_blockers")
        .insert({ item_id: itemId, blocker_id: blockerId });
      if (error) return false;
      setEdges((prev) => [...prev, { item_id: itemId, blocker_id: blockerId }]);
      return true;
    },
    [supabase],
  );

  const removeBlocker = useCallback(
    async (itemId: string, blockerId: string) => {
      const { error } = await supabase
        .from("backlog_blockers")
        .delete()
        .eq("item_id", itemId)
        .eq("blocker_id", blockerId);
      if (error) return false;
      setEdges((prev) =>
        prev.filter(
          (e) => !(e.item_id === itemId && e.blocker_id === blockerId),
        ),
      );
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
    setReleased(null);
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
    setReleased(null);
    setPending((s) => new Set(s).add(item.id));
    const lane = item.lane === "done" ? "next" : "done";
    const ok = await patch(item.id, { lane });
    setPending((s) => {
      const next = new Set(s);
      next.delete(item.id);
      return next;
    });
    if (!ok) {
      setNotice("Couldn't save that. Try again.");
      return;
    }
    // What did finishing this let you start? Computed against the same
    // graph the board renders from, so the line can never name something
    // that is still waiting on a second prerequisite.
    const after = blockedIds(
      items.map((i) => (i.id === item.id ? { ...i, lane } : i)),
      edges,
    );
    const freed = newlyStartable(blocked, after)
      .map((id) => byId.get(id)?.title)
      .filter((title): title is string => !!title);
    if (freed.length === 1) {
      setReleased(`Ready now: ${freed[0]}.`);
    } else if (freed.length > 1) {
      setReleased(`Ready now: ${freed[0]} and ${freed.length - 1} more.`);
    }
  }

  const openItem = items.find((i) => i.id === openId) ?? null;

  const editor = openItem ? (
    <BacklogEditor
      item={openItem}
      tags={tags}
      today={today}
      blockers={edges
        .filter((e) => e.item_id === openItem.id)
        .map((e) => byId.get(e.blocker_id))
        .filter((b): b is BacklogItem => !!b)}
      options={eligibleBlockers(openItem.id, items, edges)}
      onPatch={patch}
      onDelete={remove}
      onClose={() => setOpenId(null)}
      onAddBlocker={(blockerId) => addBlocker(openItem.id, blockerId)}
      onRemoveBlocker={(blockerId) => removeBlocker(openItem.id, blockerId)}
    />
  ) : null;

  /** The chip text for a waiting card, or null when it can be started. */
  const waitingOn = (id: string): string | null =>
    blocked.has(id) ? waitingLabel(pendingBlockers(id, edges, byId)) : null;

  // A drop is committed here, where the writes live. The verdict is
  // recomputed from the same pure function the hover hint used, so what
  // lands can never disagree with what the card promised.
  const handleDrop = useCallback(
    async (state: DragState) => {
      dropEndedAt.current = Date.now();
      const { outcome } = dropVerdict(state.id, state.target, items, edges);
      if (!outcome) return;
      setNotice(null);
      setReleased(null);
      const ok =
        outcome.kind === "lane"
          ? await patch(state.id, { lane: outcome.lane })
          : await addBlocker(outcome.itemId, outcome.blockerId);
      if (!ok) {
        setNotice("Couldn't save that. Try again.");
        return;
      }
      setJustChanged(state.id);
      setTimeout(() => setJustChanged((c) => (c === state.id ? null : c)), 1400);
    },
    [items, edges, patch, addBlocker],
  );

  const { drag, onPointerDown } = useCardDrag(handleDrop);
  const verdict = drag
    ? dropVerdict(drag.id, drag.target, items, edges)
    : null;

  // Anything that can move a card and so invalidate the measured line
  // positions. Cheap to compute and cheaper than measuring on every render.
  const revision = `${items.length}:${edges.length}:${openId}:${filter}:${
    showDone
  }:${items.map((i) => i.lane).join("")}:${drag ? "drag" : ""}`;

  const dragged = drag ? byId.get(drag.id) : null;

  const hoveringThis = (id: string) =>
    drag && drag.target?.kind === "item" && drag.target.id === id;

  const renderRow = (item: BacklogItem) => (
    <li key={item.id} className="space-y-2">
      <BacklogCard
        item={item}
        today={today}
        open={openId === item.id}
        pending={pending.has(item.id)}
        waitingOn={waitingOn(item.id)}
        dragging={drag?.id === item.id}
        dropHint={hoveringThis(item.id) ? (verdict?.hint ?? null) : null}
        dropAllowed={verdict?.allowed}
        justChanged={justChanged === item.id}
        onPointerDown={(e) => onPointerDown(e, item.id)}
        onOpen={() => {
          // Swallow the click the browser synthesises at the end of a drag.
          if (Date.now() - dropEndedAt.current < 400) return;
          setOpenId((c) => (c === item.id ? null : item.id));
        }}
        onTick={() => void tick(item)}
      />
      {openId === item.id && editor}
    </li>
  );

  return (
    <>
      {/* The lifted card, following the pointer. Portalled to <body>
          because `position: fixed` resolves against the nearest
          TRANSFORMED ancestor, and AppShell's .page-enter holds one —
          inside the shell this would be positioned against the column
          instead of the viewport. pointer-events: none keeps it out of
          elementFromPoint, which is how the drop target is resolved. */}
      {drag && dragged
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[100] rounded-2xl border border-cyan-glow/70 bg-surface-2 px-3 py-2.5 shadow-2xl shadow-black/60"
              style={{
                left: drag.x - drag.dx,
                top: drag.y - drag.dy,
                width: drag.width,
              }}
            >
              <span className="block truncate text-[15px] text-zinc-100">
                {dragged.title}
              </span>
              {verdict?.hint && (
                <span
                  className={`mt-1 block text-[11px] ${
                    verdict.allowed ? "text-cyan-glow" : "text-amber-300"
                  }`}
                >
                  {verdict.hint}
                </span>
              )}
            </div>,
            document.body,
          )
        : null}

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
      {released && (
        <p className="mt-2 text-sm text-cyan-glow" role="status">
          {released}
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
        {/* "Open" counts what is startable. Waiting work is named
            separately rather than folded in, so the headline number is
            never inflated by things you cannot begin — and never makes
            items look like they vanished either. */}
        <span className="text-sm tabular-nums text-zinc-500">
          {open.length - waitingCount} open
          {waitingCount > 0 && (
            <span className="text-zinc-600"> · {waitingCount} waiting</span>
          )}
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
            waitingOn={waitingOn}
            conflicted={(id) => {
              const item = byId.get(id);
              if (!item) return false;
              return scheduleConflict(item, pendingBlockers(id, edges, byId));
            }}
            onSelect={(id) => setOpenId((c) => (c === id ? null : id))}
          />
          {editor}
        </div>
      ) : (
        <div
          ref={setList}
          className="relative mt-6 space-y-7"
          style={{ paddingLeft: GUTTER }}
        >
          <DependencyLines
            edges={edges}
            container={list}
            revision={revision}
          />
          {OPEN_LANES.map((lane) => {
            const laneItems = open.filter((i) => i.lane === lane);
            const { startable, waiting } = splitByReadiness(laneItems, blocked);
            const laneHovered =
              drag && drag.target?.kind === "lane" && drag.target.lane === lane;
            return (
              <section
                key={lane}
                data-drop-lane={lane}
                className={`rounded-2xl transition-colors ${
                  laneHovered
                    ? verdict?.allowed
                      ? "bg-cyan-glow/5 outline outline-1 outline-dashed outline-cyan-glow/50"
                      : "outline outline-1 outline-dashed outline-zinc-700"
                    : ""
                } ${drag ? "-mx-2 px-2 py-2" : ""}`}
              >
                <div className="flex items-baseline gap-2">
                  <SectionHeading>{LANE_LABEL[lane]}</SectionHeading>
                  {startable.length > 0 && (
                    <span className="text-xs tabular-nums text-zinc-600">
                      {startable.length}
                    </span>
                  )}
                  {laneHovered && verdict?.allowed && (
                    <span className="text-[11px] font-medium text-cyan-glow">
                      Drop to move here
                    </span>
                  )}
                </div>
                {startable.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-600">Nothing.</p>
                ) : (
                  <ul className="mt-2 space-y-2">{startable.map(renderRow)}</ul>
                )}
                {/* Waiting work sits under its own quiet label rather than
                    mixed in: the lane above it is the honest answer to
                    "what can I pick up", and that only works if nothing
                    unstartable is in it. */}
                {waiting.length > 0 && (
                  <div className="mt-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">
                        Waiting
                      </span>
                      <span className="text-[11px] tabular-nums text-zinc-700">
                        {waiting.length}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-2">{waiting.map(renderRow)}</ul>
                  </div>
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
                  {done.slice(0, DONE_SHOWN).map(renderRow)}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}
