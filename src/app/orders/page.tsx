import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { formatUsd } from "@/lib/reviews/money";
import type { StudentOrderItem } from "@/lib/reviews/types";
import { orderStatusLabel } from "@/lib/reviews/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Your reviews",
  robots: { index: false, follow: false },
};

/** Every review the student has commissioned, newest first. */
export default async function OrdersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/orders");

  const { data } = await supabase.rpc("student_review_orders");
  const orders = (data ?? []) as StudentOrderItem[];

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return (
    <AppShell avatarUrl={avatarUrl}>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Your reviews
      </h1>
      {orders.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">No reviews yet.</p>
      ) : (
        <div className="mt-6 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
          {orders.map((o) => (
            <Link
              key={o.id}
              href={`/orders/${o.id}`}
              className="flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-surface-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-200">
                  {o.offering_title}
                  <span className="text-zinc-500"> · {o.coach_name}</span>
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {orderStatusLabel(o.status, "student")}
                </p>
              </div>
              <span className="shrink-0 text-sm tabular-nums text-zinc-400">
                {formatUsd(o.price_cents)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
