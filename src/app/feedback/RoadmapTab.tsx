"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RoadmapSections } from "@/components/Roadmap";
import type { RoadmapItem } from "@/lib/roadmap";

/**
 * The board's Roadmap tab: the same sections as the public /roadmap page,
 * fetched on the client so switching tabs is instant and the board did
 * not have to load it for people who never look.
 */
export function RoadmapTab() {
  const [items, setItems] = useState<RoadmapItem[] | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("roadmap_items")
      .select("*")
      .order("stage")
      .order("position")
      .then(({ data }) => setItems((data ?? []) as RoadmapItem[]));
  }, []);

  if (items === null) {
    return <p className="mt-6 text-sm text-zinc-600">Loading…</p>;
  }
  return (
    <div>
      <RoadmapSections items={items} />
      <p className="mt-8 text-sm text-zinc-500">
        This page is public at{" "}
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
