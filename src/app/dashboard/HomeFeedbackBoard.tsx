"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SectionHeading } from "@/components/SectionHeading";
import { createClient } from "@/lib/supabase/client";
import {
  Avatar,
  CHIP,
  Chevron,
  CommentCount,
  OfficialBadge,
  STATUS_CHIP,
  STATUS_LABEL,
  TYPE_CHIP,
  relDate,
  type BoardItem,
} from "@/app/feedback/boardShared";

/**
 * The feedback board's corner of Home: the three posts being talked about
 * most recently, and a row inviting the reader to add their own.
 *
 * Shown only to a player with at least one upload (the caller decides).
 * Someone who has not put a match through yet has nothing to have an
 * opinion about, and a board of other people's requests would be the
 * first thing they scroll past on the way to finding out what the app
 * does. It sits last on the page for the same reason: it is where you go
 * once the app has done something for you.
 */
export function HomeFeedbackBoard({
  userId,
  show,
}: {
  userId: string;
  show: boolean;
}) {
  const [items, setItems] = useState<BoardItem[] | null>(null);

  useEffect(() => {
    if (!show) return;
    const supabase = createClient();
    void supabase
      .rpc("feedback_board", { p_sort: "active", p_limit: 8 })
      .then(({ data }) => {
        const rows = ((data ?? []) as BoardItem[]).filter(
          (i) => !i.hidden && i.status !== "done" && i.status !== "declined"
        );
        setItems(rows.slice(0, 3));
      });
  }, [show]);

  if (!show || items === null) return null;

  return (
    <section>
      <div className="flex items-center justify-between">
        <SectionHeading>Feedback board</SectionHeading>
        <Link
          href="/feedback"
          className="inline-flex items-center gap-1 text-sm font-medium text-cyan-glow transition-colors hover:text-white"
        >
          See all
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
          </svg>
        </Link>
      </div>

      <ul className="mt-4 space-y-2.5">
        {items.map((item) => {
          const author = item.user_id === userId ? "You" : item.author_name;
          return (
            <li key={item.id}>
              <Link
                href={`/feedback/${item.id}`}
                className="flex items-start gap-3 rounded-xl border border-edge bg-surface px-4 py-3 transition-colors hover:border-cyan-glow/40"
              >
                <span
                  className={`flex w-9 shrink-0 flex-col items-center rounded-lg border py-1 ${
                    item.voted
                      ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                      : "border-edge bg-surface-2/40 text-zinc-400"
                  }`}
                  aria-label={`${item.vote_count} votes`}
                >
                  <Chevron className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-semibold tabular-nums">{item.vote_count}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-100">
                    {item.title}
                  </span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className={`${CHIP} capitalize ${TYPE_CHIP[item.type] ?? TYPE_CHIP.idea}`}>
                      {item.type}
                    </span>
                    {item.status !== "open" && (
                      <span className={`${CHIP} ${STATUS_CHIP[item.status] ?? STATUS_CHIP.declined}`}>
                        {STATUS_LABEL[item.status]}
                      </span>
                    )}
                    {item.official_reply && <OfficialBadge />}
                    <CommentCount count={item.comment_count} />
                    <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                      <Avatar name={item.author_name} src={item.author_avatar} />
                      {author} · {relDate(item.last_activity_at)}
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
        <li>
          <Link
            href="/feedback?compose=1"
            className="flex items-center gap-3 rounded-xl border border-dashed border-edge px-4 py-3 text-sm text-zinc-400 transition-colors hover:border-cyan-glow/40 hover:text-zinc-200"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-edge text-zinc-400">
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" d="M12 5v14M5 12h14" />
              </svg>
            </span>
            Have an idea, or found a bug? Add it to the board.
          </Link>
        </li>
      </ul>
    </section>
  );
}
