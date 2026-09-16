"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RoadmapSections } from "@/components/Roadmap";
import { adjustedScore, type RoadmapItem, type RoadmapVote } from "@/lib/roadmap";

/**
 * The board's Roadmap tab: the same sections as the public /roadmap page,
 * with a vote box on everything not yet shipped. Fetched on the client so
 * switching tabs is instant and the board did not have to load it for
 * people who never look.
 */
export function RoadmapTab() {
  const [items, setItems] = useState<RoadmapItem[] | null>(null);
  const [votes, setVotes] = useState<Record<string, RoadmapVote>>({});

  useEffect(() => {
    const supabase = createClient();
    void Promise.all([
      supabase.from("roadmap_items").select("*").order("stage").order("position"),
      supabase.from("roadmap_votes").select("item_id, value"),
    ]).then(([rows, mine]) => {
      setItems((rows.data ?? []) as RoadmapItem[]);
      const map: Record<string, RoadmapVote> = {};
      for (const v of (mine.data ?? []) as { item_id: string; value: number }[]) {
        map[v.item_id] = v.value > 0 ? 1 : -1;
      }
      setVotes(map);
    });
  }, []);

  /**
   * Optimistic: the score moves under the pointer and settles on whatever
   * the server says. A vote that waits for a round trip reads as a click
   * that missed.
   */
  const vote = useCallback(
    async (item: RoadmapItem, next: RoadmapVote) => {
      const from = votes[item.id] ?? 0;
      setVotes((prev) => ({ ...prev, [item.id]: next }));
      setItems((prev) =>
        prev?.map((i) => (i.id === item.id ? { ...i, score: adjustedScore(i.score, from, next) } : i)) ?? null
      );
      const supabase = createClient();
      const { data, error } = await supabase.rpc("roadmap_vote", {
        p_item: item.id,
        p_value: next,
      });
      const row = (data as { score: number; my_vote: number }[] | null)?.[0];
      if (error || !row) {
        setVotes((prev) => ({ ...prev, [item.id]: from }));
        setItems((prev) => prev?.map((i) => (i.id === item.id ? { ...i, score: item.score } : i)) ?? null);
        return;
      }
      setVotes((prev) => ({ ...prev, [item.id]: row.my_vote > 0 ? 1 : row.my_vote < 0 ? -1 : 0 }));
      setItems((prev) => prev?.map((i) => (i.id === item.id ? { ...i, score: row.score } : i)) ?? null);
    },
    [votes]
  );

  if (items === null) {
    return <p className="mt-6 text-sm text-zinc-600">Loading…</p>;
  }
  return (
    <div>
      <RoadmapSections items={items} votes={votes} onVote={(item, v) => void vote(item, v)} />
      <p className="mt-8 text-sm text-zinc-500">
        Vote up what you want sooner and down what you can live without. This
        page is public at{" "}
        <Link
          href="/roadmap"
          className="font-medium text-zinc-300 underline decoration-edge underline-offset-4 transition-colors hover:text-white"
        >
          ponglens.com/roadmap
        </Link>
        , so you can send it to anyone.
      </p>
    </div>
  );
}
