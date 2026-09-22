"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHeading } from "@/components/SectionHeading";
import { createClient } from "@/lib/supabase/client";
import { deriveMatchTitleParts } from "@/lib/matchTitle";
import { PointFrame } from "@/app/starred/PointFrame";
import {
  durationLabel,
  outcomeLabel,
  outcomeOf,
  type Outcome,
  type StarredPointRow,
} from "@/app/starred/starred";
import { ArrowLink } from "./shared";

/**
 * Home's Starred points row (2026-09-22): the ten newest stars, in the
 * shelf's own order, swiped sideways. A card opens its point inside its
 * match; View all goes to the whole shelf. The iOS twin is the
 * `starredPoints` section of HomeScreen.
 *
 * One call to starred_points(p_limit => 10), made once when Home mounts —
 * stars change when the player stars something, not every ten seconds —
 * and each card's picture loads only as it scrolls into view.
 */

const HOME_STARRED_LIMIT = 10;

const OUTCOME_TEXT: Record<Outcome, string> = {
  won: "text-cyan-glow",
  lost: "text-magenta-soft",
  skipped: "text-amber-300",
  unscored: "text-zinc-400",
};

export function HomeStarred() {
  const [rows, setRows] = useState<StarredPointRow[] | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await createClient().rpc("starred_points", {
        p_limit: HOME_STARRED_LIMIT,
      });
      if (alive) setRows((data ?? []) as StarredPointRow[]);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Arrows for a mouse, a card at a time; a trackpad or a finger swipes
  // the row directly (the match analysis deck does the same).
  const page = useCallback((delta: number) => {
    const el = scroller.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    el.scrollBy({ left: delta * (card.offsetWidth + 12), behavior: "smooth" });
  }, []);

  if (!rows || rows.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between gap-4">
        <SectionHeading>Starred points</SectionHeading>
        <div className="flex items-center gap-3">
          {rows.length > 3 && (
            <div className="hidden items-center gap-1.5 sm:flex">
              <button
                type="button"
                aria-label="Previous starred points"
                onClick={() => page(-1)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-edge text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="Next starred points"
                onClick={() => page(1)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-edge text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          )}
          <ArrowLink href="/starred" label="View all" />
        </div>
      </div>

      <div
        ref={scroller}
        className="mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {rows.map((row) => {
          const match = deriveMatchTitleParts({
            opponentName: row.opponent_name,
            venue: row.venue,
            playedAt: row.played_at,
            matchType: row.match_type,
          }).primary;
          const duration = durationLabel(row);
          return (
            <Link
              key={row.id}
              href={`/match/${row.match_id}?p=${row.id}`}
              className="group w-[62%] shrink-0 snap-start sm:w-56"
            >
              <PointFrame
                row={row}
                className="aspect-video w-full rounded-xl border border-edge transition-colors group-hover:border-cyan-glow/40"
              >
                {duration && (
                  <span className="on-frame absolute bottom-2 right-2.5 text-[11px] font-medium tabular-nums text-zinc-100">
                    {duration}
                  </span>
                )}
              </PointFrame>
              <span className="mt-2 block text-sm font-medium tabular-nums text-zinc-100">
                Point {row.display_no}
              </span>
              <span className="mt-0.5 block truncate text-xs">
                <span className={OUTCOME_TEXT[outcomeOf(row)]}>
                  {outcomeLabel(row)}
                </span>
                <span className="text-zinc-500"> · {match}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
