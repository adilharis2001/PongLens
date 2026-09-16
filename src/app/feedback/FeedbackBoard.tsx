"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Avatar,
  CHIP,
  CommentCount,
  OfficialReply,
  SEVERITY_CHIP,
  STATUS_CHIP,
  STATUS_LABEL,
  TYPE_CHIP,
  VoteButton,
  relDate,
  type BoardItem,
} from "./boardShared";

export type { BoardItem } from "./boardShared";

/**
 * The board: every post, sorted by what is wanted (Top), what is fresh
 * (New) or what is being talked about (Active). A row opens the post's
 * own page, where the thread lives; the vote box stays on the row so a
 * vote is still one tap.
 *
 * Above the rows, a rail of the stages posts move through — Planned,
 * Building, Done — with a count on each. It appears only once something
 * has moved, so an empty board is not three empty columns, and each pill
 * filters the list to that stage. With no filter the list shows what is
 * still open, which is what a reader comes here for.
 */

type Sort = "top" | "new" | "active";
type Stage = "planned" | "building" | "done";

function EyeOff({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.8 2.8M9.4 5.2A9.5 9.5 0 0 1 12 4.9c4.5 0 7.9 3.3 9 7.1a11.6 11.6 0 0 1-2.9 4.5M6.2 6.9A11.9 11.9 0 0 0 3 12c1.1 3.8 4.5 7.1 9 7.1 1.5 0 2.9-.4 4.1-1"
      />
    </svg>
  );
}

function Row({
  item,
  viewerId,
  onVote,
}: {
  item: BoardItem;
  viewerId?: string;
  onVote: () => void;
}) {
  const author = item.user_id === viewerId ? "You" : item.author_name;
  return (
    <li className="border-b border-edge/60 last:border-b-0">
      <div className="flex items-start gap-3 px-4 py-3">
        {/* A private row cannot be voted on (feedback_toggle_vote refuses
            it), so the column keeps its box without offering the action.
            QA reports are the only rows that land here. */}
        {item.hidden ? (
          <span
            title="Not on the board"
            aria-label="Not on the board"
            className="flex h-11 w-10 shrink-0 items-center justify-center rounded-xl border border-edge bg-surface-2/40 text-zinc-600"
          >
            <EyeOff className="h-4 w-4" />
          </span>
        ) : (
          <VoteButton count={item.vote_count} voted={item.voted} onVote={onVote} />
        )}

        <Link href={`/feedback/${item.id}`} className="group min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-zinc-100 group-hover:text-white">
            {item.title}
          </p>
          {item.body.trim() && item.body.trim() !== item.title.trim() && (
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-zinc-400">
              {item.body}
            </p>
          )}
          {item.official_reply && (
            <OfficialReply text={item.official_reply} at={item.official_reply_at} />
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`${CHIP} capitalize ${TYPE_CHIP[item.type] ?? TYPE_CHIP.idea}`}>
              {item.type}
            </span>
            {item.severity && (
              <span
                className={`${CHIP} capitalize ${SEVERITY_CHIP[item.severity] ?? SEVERITY_CHIP.minor}`}
              >
                {item.severity}
              </span>
            )}
            {item.status !== "open" && (
              <span className={`${CHIP} ${STATUS_CHIP[item.status] ?? STATUS_CHIP.declined}`}>
                {STATUS_LABEL[item.status]}
              </span>
            )}
            {!item.hidden && <CommentCount count={item.comment_count} />}
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <Avatar name={item.author_name} src={item.author_avatar} />
              {author} · {relDate(item.created_at)}
            </span>
          </div>
        </Link>
      </div>
    </li>
  );
}

export function FeedbackBoard({
  isAdmin,
  isQa = false,
  userId,
  refreshKey,
}: {
  isAdmin: boolean;
  /**
   * QA role (092): shows the Mine filter for tracking own reports, and
   * (101) opens the board already on it, since QA reports never appear in
   * anyone else's list.
   */
  isQa?: boolean;
  userId?: string;
  refreshKey: number;
}) {
  // A tester opens this page to check on their own reports, so it opens on
  // them: filtered to Mine, newest first. The defaults for everyone else
  // are unchanged — the board is a ranked list of what players want, which
  // is what "top" is for.
  const [sort, setSort] = useState<Sort>(isQa ? "new" : "top");
  const [mine, setMine] = useState(isQa);
  const [qaOnly, setQaOnly] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [items, setItems] = useState<BoardItem[] | null>(null);

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
      setItems((prev) => prev?.map((i) => (i.id === item.id ? item : i)) ?? null);
      return;
    }
    const row = data as { vote_count: number; voted: boolean };
    setItems((prev) =>
      prev?.map((i) =>
        i.id === item.id ? { ...i, vote_count: row.vote_count, voted: row.voted } : i
      ) ?? null
    );
  }, []);

  const mineToggle = isQa && userId ? mine : null;
  // The admin's counterpart to Mine. QA reports carry no votes, so under
  // the default vote ranking they sit below every player request forever;
  // this is the way to pull the tester's list to the front.
  const qaToggle = isAdmin ? qaOnly : null;

  const scoped = useMemo(
    () =>
      (items ?? [])
        .filter((i) => (mineToggle === true ? i.user_id === userId : true))
        .filter((i) => (qaToggle === true ? i.hidden === true : true)),
    [items, mineToggle, qaToggle, userId]
  );

  // The rail's counts come from everything in scope, not from the current
  // filter, so a pill's number does not change when you press it.
  const stageCounts = useMemo(
    () => ({
      planned: scoped.filter((i) => i.status === "planned").length,
      building: scoped.filter((i) => i.status === "building").length,
      done: scoped.filter((i) => i.status === "done" || i.status === "declined").length,
    }),
    [scoped]
  );
  const railVisible = stageCounts.planned + stageCounts.building + stageCounts.done > 0;

  const visible = useMemo(() => {
    if (stage === "done") {
      return scoped.filter((i) => i.status === "done" || i.status === "declined");
    }
    if (stage) return scoped.filter((i) => i.status === stage);
    return scoped.filter((i) => i.status !== "done" && i.status !== "declined");
  }, [scoped, stage]);

  const header = (
    <BoardHeader
      sort={sort}
      setSort={setSort}
      mine={mineToggle}
      setMine={setMine}
      qaOnly={qaToggle}
      setQaOnly={setQaOnly}
    />
  );

  if (items === null) {
    return (
      <div>
        {header}
        <p className="mt-6 text-sm text-zinc-600">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      {header}

      {railVisible && (
        <StageRail counts={stageCounts} stage={stage} setStage={setStage} />
      )}

      {scoped.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">Nothing yet. You go first.</p>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-2xl border border-edge bg-surface">
          {visible.map((item) => (
            <Row
              key={item.id}
              item={item}
              viewerId={userId}
              onVote={() => void vote(item)}
            />
          ))}
          {visible.length === 0 && (
            <li className="px-4 py-4 text-sm text-zinc-500">
              {stage ? `Nothing ${STATUS_LABEL[stage].toLowerCase()} right now.` : "Nothing open right now."}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Planned, Building, Done, each with its count. One press filters to that
 * stage; pressing the lit pill again goes back to the open list.
 */
function StageRail({
  counts,
  stage,
  setStage,
}: {
  counts: Record<Stage, number>;
  stage: Stage | null;
  setStage: (s: Stage | null) => void;
}) {
  const stages: Stage[] = ["planned", "building", "done"];
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by stage">
      {stages.map((s) => {
        const on = stage === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => setStage(on ? null : s)}
            aria-pressed={on}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              on
                ? STATUS_CHIP[s]
                : "border-edge text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            }`}
          >
            {STATUS_LABEL[s]}
            <span
              className={`tabular-nums ${on ? "opacity-80" : "text-zinc-500"}`}
            >
              {counts[s]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function BoardHeader({
  sort,
  setSort,
  mine,
  setMine,
  qaOnly,
  setQaOnly,
}: {
  sort: Sort;
  setSort: (s: Sort) => void;
  /** null hides the toggle (non-QA viewers). */
  mine: boolean | null;
  setMine: (v: boolean) => void;
  /** null hides the toggle (everyone but the admin). */
  qaOnly: boolean | null;
  setQaOnly: (v: boolean) => void;
}) {
  const pill = (on: boolean) =>
    `rounded-full border px-3.5 py-1 text-xs font-semibold transition-colors ${
      on
        ? "border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow"
        : "border-edge text-zinc-500 hover:text-zinc-300"
    }`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold text-zinc-100">Board</h2>
      <div className="flex items-center gap-2">
        {qaOnly !== null && (
          <button
            type="button"
            onClick={() => setQaOnly(!qaOnly)}
            aria-pressed={qaOnly}
            className={pill(qaOnly)}
          >
            QA
          </button>
        )}
        {mine !== null && (
          <button
            type="button"
            onClick={() => setMine(!mine)}
            aria-pressed={mine}
            className={pill(mine)}
          >
            Mine
          </button>
        )}
        <div className="flex rounded-full border border-edge bg-surface p-0.5">
          {(["top", "new", "active"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              aria-pressed={sort === s}
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${
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
    </div>
  );
}
