"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type BoardItem = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: "bug" | "idea" | "improvement" | "private";
  status: "open" | "planned" | "building" | "done" | "declined";
  qa: { q: string; a: string }[];
  vote_count: number;
  created_at: string;
  author_name: string;
  author_avatar: string | null;
  voted: boolean;
};

const TYPE_CHIP: Record<string, string> = {
  bug: "border-red-400/40 bg-red-400/10 text-red-300",
  idea: "border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow",
  improvement: "border-violet-400/40 bg-violet-400/10 text-violet-300",
  private: "border-edge bg-surface-2 text-zinc-400",
};

const STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  building: "Building",
  done: "Done",
  declined: "Declined",
};

function relDate(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function Chevron({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 14 6-6 6 6" />
    </svg>
  );
}

function Row({
  item,
  isAdmin,
  expanded,
  onToggleExpand,
  onVote,
  onAdminChange,
}: {
  item: BoardItem;
  isAdmin: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onVote: () => void;
  onAdminChange: (field: "status" | "type", value: string) => void;
}) {
  return (
    <li className="border-b border-edge/60 last:border-b-0">
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onVote}
          aria-label={item.voted ? "Remove vote" : "Vote"}
          aria-pressed={item.voted}
          className={`flex w-10 shrink-0 flex-col items-center rounded-xl border py-1.5 transition-colors ${
            item.voted
              ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
              : "border-edge bg-surface-2/40 text-zinc-400 hover:border-cyan-glow/40 hover:text-zinc-200"
          }`}
        >
          <Chevron className="h-4 w-4" />
          <span className="text-xs font-semibold tabular-nums">
            {item.vote_count}
          </span>
        </button>

        <button
          type="button"
          onClick={onToggleExpand}
          className="min-w-0 flex-1 text-left"
        >
          <p className="text-sm font-medium leading-snug text-zinc-100">
            {item.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${
                TYPE_CHIP[item.type] ?? TYPE_CHIP.idea
              }`}
            >
              {item.type}
            </span>
            {item.status !== "open" && (
              <span className="rounded-full border border-edge bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
                {STATUS_LABEL[item.status]}
              </span>
            )}
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              {item.author_avatar ? (
                <Image
                  src={item.author_avatar}
                  alt=""
                  width={16}
                  height={16}
                  unoptimized
                  className="rounded-full border border-edge"
                />
              ) : (
                <span className="flex h-4 w-4 items-center justify-center rounded-full border border-edge bg-surface-2 text-[9px] text-zinc-400">
                  {item.author_name.slice(0, 1).toUpperCase()}
                </span>
              )}
              {item.author_name} · {relDate(item.created_at)}
            </span>
          </div>
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pl-[4.25rem]">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
            {item.body}
          </p>
          {Array.isArray(item.qa) && item.qa.length > 0 && (
            <div className="mt-3 space-y-2 border-l-2 border-edge pl-3">
              {item.qa.map((pair, i) => (
                <div key={i}>
                  <p className="text-xs font-medium text-zinc-500">{pair.q}</p>
                  <p className="mt-0.5 text-sm text-zinc-300">{pair.a}</p>
                </div>
              ))}
            </div>
          )}
          {isAdmin && (
            <div className="mt-3 flex gap-2">
              <select
                value={item.status}
                onChange={(e) => onAdminChange("status", e.target.value)}
                className="rounded-lg border border-edge bg-surface-2 px-2 py-1 text-xs text-zinc-200 focus:border-cyan-glow/50 focus:outline-none"
              >
                {["open", "planned", "building", "done", "declined"].map(
                  (s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  )
                )}
              </select>
              <select
                value={item.type}
                onChange={(e) => onAdminChange("type", e.target.value)}
                className="rounded-lg border border-edge bg-surface-2 px-2 py-1 text-xs text-zinc-200 focus:border-cyan-glow/50 focus:outline-none"
              >
                {["bug", "idea", "improvement", "private"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function FeedbackBoard({
  isAdmin,
  refreshKey,
}: {
  isAdmin: boolean;
  refreshKey: number;
}) {
  const [sort, setSort] = useState<"top" | "new">("top");
  const [items, setItems] = useState<BoardItem[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc("feedback_board", { p_sort: sort });
    if (data) setItems(data as BoardItem[]);
  }, [sort]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const vote = useCallback(async (item: BoardItem) => {
    // optimistic toggle
    setItems((prev) =>
      prev?.map((i) =>
        i.id === item.id
          ? {
              ...i,
              voted: !i.voted,
              vote_count: i.vote_count + (i.voted ? -1 : 1),
            }
          : i
      ) ?? null
    );
    const supabase = createClient();
    const { data, error } = await supabase
      .rpc("feedback_toggle_vote", { p_item: item.id })
      .single();
    if (error) {
      // revert
      setItems((prev) =>
        prev?.map((i) => (i.id === item.id ? item : i)) ?? null
      );
      return;
    }
    const row = data as { vote_count: number; voted: boolean };
    setItems((prev) =>
      prev?.map((i) =>
        i.id === item.id
          ? { ...i, vote_count: row.vote_count, voted: row.voted }
          : i
      ) ?? null
    );
  }, []);

  const adminChange = useCallback(
    async (item: BoardItem, field: "status" | "type", value: string) => {
      setItems(
        (prev) =>
          prev?.map((i) =>
            i.id === item.id ? { ...i, [field]: value } : i
          ) ?? null
      );
      const supabase = createClient();
      const { error } = await supabase
        .from("feedback_items")
        .update({ [field]: value })
        .eq("id", item.id);
      if (error) {
        setItems((prev) =>
          prev?.map((i) => (i.id === item.id ? item : i)) ?? null
        );
      }
    },
    []
  );

  if (items === null) {
    return (
      <div className="mt-10">
        <BoardHeader sort={sort} setSort={setSort} />
        <p className="mt-6 text-sm text-zinc-600">Loading…</p>
      </div>
    );
  }

  const active = items.filter(
    (i) => i.status !== "done" && i.status !== "declined"
  );
  const finished = items.filter(
    (i) => i.status === "done" || i.status === "declined"
  );

  return (
    <div className="mt-10">
      <BoardHeader sort={sort} setSort={setSort} />

      {active.length === 0 && finished.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">
          Nothing yet. You go first.
        </p>
      ) : (
        <>
          <ul className="mt-4 overflow-hidden rounded-2xl border border-edge bg-surface">
            {active.map((item) => (
              <Row
                key={item.id}
                item={item}
                isAdmin={isAdmin}
                expanded={expandedId === item.id}
                onToggleExpand={() =>
                  setExpandedId((cur) => (cur === item.id ? null : item.id))
                }
                onVote={() => void vote(item)}
                onAdminChange={(f, v) => void adminChange(item, f, v)}
              />
            ))}
            {active.length === 0 && (
              <li className="px-4 py-4 text-sm text-zinc-500">
                Nothing open right now.
              </li>
            )}
          </ul>

          {finished.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setDoneOpen((v) => !v)}
                className="flex items-center gap-2 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-300"
              >
                <span
                  className={`inline-block transition-transform ${
                    doneOpen ? "rotate-90" : ""
                  }`}
                >
                  ›
                </span>
                Done ({finished.length})
              </button>
              {doneOpen && (
                <ul className="mt-3 overflow-hidden rounded-2xl border border-edge bg-surface opacity-80">
                  {finished.map((item) => (
                    <Row
                      key={item.id}
                      item={item}
                      isAdmin={isAdmin}
                      expanded={expandedId === item.id}
                      onToggleExpand={() =>
                        setExpandedId((cur) =>
                          cur === item.id ? null : item.id
                        )
                      }
                      onVote={() => void vote(item)}
                      onAdminChange={(f, v) => void adminChange(item, f, v)}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BoardHeader({
  sort,
  setSort,
}: {
  sort: "top" | "new";
  setSort: (s: "top" | "new") => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-lg font-semibold text-zinc-100">Board</h2>
      <div className="flex rounded-full border border-edge bg-surface p-0.5">
        {(["top", "new"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSort(s)}
            aria-pressed={sort === s}
            className={`rounded-full px-3.5 py-1 text-xs font-semibold capitalize transition-colors ${
              sort === s
                ? "bg-surface-2 text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
