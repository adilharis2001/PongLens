import type { Metadata } from "next";

import { AppShell } from "@/components/AppShell";
import type { RoadmapItem } from "@/lib/roadmap";
import { requireAdmin } from "../requireAdmin";
import { RoadmapAdmin } from "./RoadmapAdmin";

export const metadata: Metadata = {
  title: "Roadmap",
  robots: { index: false, follow: false },
};

/**
 * /admin/roadmap — where the public roadmap is kept. Replaced
 * /admin/backlog on 2026-09-16 (Adil: "I don't use the backlog view
 * anymore"). RLS on roadmap_items is is_admin() for writes, so the client
 * reads and writes the table directly; requireAdmin here is the
 * redirect, not the boundary.
 */
export default async function AdminRoadmapPage() {
  const { supabase, avatarUrl } = await requireAdmin();
  const { data } = await supabase
    .from("roadmap_items")
    .select("*")
    .order("stage")
    .order("position");

  return (
    <AppShell avatarUrl={avatarUrl}>
      <RoadmapAdmin initialItems={(data ?? []) as RoadmapItem[]} />
    </AppShell>
  );
}
