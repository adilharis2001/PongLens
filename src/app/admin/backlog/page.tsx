import type { Metadata } from "next";

import { AppShell } from "@/components/AppShell";
import type { BacklogBlocker } from "@/lib/backlog/blockers";
import type { BacklogItem } from "@/lib/backlog/types";
import { requireAdmin } from "../requireAdmin";
import { BacklogBoard } from "./BacklogBoard";

export const metadata: Metadata = {
  title: "Backlog",
  robots: { index: false, follow: false },
};

/**
 * /admin/backlog — the operator's own working list: everything to build,
 * write, ship or send, in one place regardless of which kind of work it
 * is. RLS on backlog_items is is_admin() plus authorship, so the client
 * reads and writes the table directly; requireAdmin here is the redirect,
 * not the boundary.
 *
 * Wide shell: the timeline lays out horizontally and earns the extra
 * column on a laptop. On a phone it scrolls, which is the point.
 */
export default async function AdminBacklogPage() {
  const { supabase, user, avatarUrl } = await requireAdmin();

  const [{ data }, { data: edges }] = await Promise.all([
    supabase
      .from("backlog_items")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.from("backlog_blockers").select("item_id, blocker_id"),
  ]);

  return (
    <AppShell avatarUrl={avatarUrl} wide>
      <BacklogBoard
        userId={user.id}
        initialItems={(data ?? []) as BacklogItem[]}
        initialBlockers={(edges ?? []) as BacklogBlocker[]}
      />
    </AppShell>
  );
}
