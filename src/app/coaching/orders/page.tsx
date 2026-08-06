import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { UpLink } from "@/components/UpLink";
import type { CoachQueueItem } from "@/lib/reviews/types";
import { createClient } from "@/lib/supabase/server";
import { OrderGroup } from "../CoachHub";

export const metadata: Metadata = {
  title: "Orders",
  robots: { index: false, follow: false },
};

/** Every order the coach has ever taken, grouped by whose move it is. */
export default async function CoachOrdersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/coaching/orders");

  const { data: profile } = await supabase
    .from("coach_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/coaching");

  const { data } = await supabase.rpc("coach_queue");
  const queue = (data ?? []) as CoachQueueItem[];

  const groups = {
    yourMove: queue.filter((o) => o.status === "submitted"),
    inProgress: queue.filter(
      (o) => o.status === "in_review" || o.status === "clarification",
    ),
    waiting: queue.filter(
      (o) => o.status === "awaiting_submission" || o.status === "delivered",
    ),
    done: queue.filter((o) =>
      ["completed", "declined", "cancelled"].includes(o.status),
    ),
  };

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return (
    <AppShell avatarUrl={avatarUrl}>
      <div className="mx-auto max-w-lg">
        <UpLink href="/coaching" label="Coaching" />
        <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
          Orders
        </h1>
        {queue.length === 0 && (
          <p className="mt-6 text-sm text-zinc-500">No orders yet.</p>
        )}
        <OrderGroup label="Your move" orders={groups.yourMove} />
        <OrderGroup label="In progress" orders={groups.inProgress} />
        <OrderGroup label="Waiting on them" orders={groups.waiting} />
        <OrderGroup label="Done" orders={groups.done} />
      </div>
    </AppShell>
  );
}
