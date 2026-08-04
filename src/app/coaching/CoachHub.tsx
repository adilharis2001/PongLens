"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatUsd } from "@/lib/reviews/money";
import type {
  CoachProfileRow,
  CoachQueueItem,
  CoachReviewStats,
} from "@/lib/reviews/types";
import { orderStatusLabel } from "@/lib/reviews/types";
import { createClient } from "@/lib/supabase/client";

/**
 * The queue. Orders are grouped by whose move it is — the coach's pile
 * first, then waiting-on-student, then finished — with each order's own
 * promised-by date carried on the row. Availability controls (pause,
 * capacity) live here because this is where load is felt.
 */

function promiseLabel(promisedBy: string | null): {
  text: string;
  overdue: boolean;
} | null {
  if (!promisedBy) return null;
  const due = new Date(promisedBy);
  const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
  if (days < 0) return { text: "past your promised date", overdue: true };
  if (days === 0) return { text: "promised today", overdue: false };
  if (days === 1) return { text: "promised by tomorrow", overdue: false };
  return {
    text: `promised by ${due.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    })}`,
    overdue: false,
  };
}

function OrderRow({ order }: { order: CoachQueueItem }) {
  const promise =
    order.status === "in_review" || order.status === "clarification"
      ? promiseLabel(order.promised_by)
      : null;
  return (
    <Link
      href={`/coaching/orders/${order.id}`}
      className="flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-surface-2"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-zinc-200">
          {order.student_name}
          <span className="text-zinc-500"> · {order.offering_title}</span>
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {orderStatusLabel(order.status, "coach")}
          {promise && (
            <span className={promise.overdue ? "text-amber-400" : undefined}>
              {" "}
              · {promise.text}
            </span>
          )}
        </p>
      </div>
      <span className="shrink-0 text-sm font-medium tabular-nums text-zinc-300">
        {formatUsd(order.coach_share_cents)}
      </span>
    </Link>
  );
}

function Group({
  label,
  orders,
}: {
  label: string;
  orders: CoachQueueItem[];
}) {
  if (orders.length === 0) return null;
  return (
    <div className="mt-6">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </h2>
      <div className="divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
        {orders.map((o) => (
          <OrderRow key={o.id} order={o} />
        ))}
      </div>
    </div>
  );
}

export function CoachHub({
  profile,
  initialQueue,
  stats,
  offeringCount,
}: {
  profile: CoachProfileRow;
  initialQueue: CoachQueueItem[];
  stats: CoachReviewStats;
  offeringCount: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [accepting, setAccepting] = useState(profile.accepting_orders);
  const [maxActive, setMaxActive] = useState(profile.max_active_orders);
  const [copied, setCopied] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const bootRan = useRef(false);

  // One housekeeping pass per visit: quiet deliveries auto-complete and
  // any unpaid completions release; returning from onboarding re-syncs the
  // capability flags Stripe just granted.
  useEffect(() => {
    if (bootRan.current) return;
    bootRan.current = true;
    const boot = async () => {
      await fetch("/api/reviews/transition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sweep" }),
      }).catch(() => {});
      if (searchParams.get("connected") === "1") {
        await fetch("/api/reviews/connect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "sync" }),
        }).catch(() => {});
        router.replace("/coaching");
      }
      router.refresh();
    };
    void boot();
  }, [router, searchParams]);

  const groups = useMemo(() => {
    const q = initialQueue;
    return {
      yourMove: q.filter((o) => o.status === "submitted"),
      inProgress: q.filter((o) => o.status === "in_review"),
      waiting: q.filter(
        (o) =>
          o.status === "awaiting_submission" ||
          o.status === "clarification" ||
          o.status === "delivered",
      ),
      done: q.filter((o) =>
        ["completed", "declined", "cancelled"].includes(o.status),
      ),
    };
  }, [initialQueue]);

  async function saveAvailability(next: {
    accepting?: boolean;
    maxActive?: number | null;
  }) {
    const supabase = createClient();
    await supabase
      .from("coach_profiles")
      .update({
        accepting_orders: next.accepting ?? accepting,
        max_active_orders:
          next.maxActive === undefined ? maxActive : next.maxActive,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", profile.user_id);
  }

  async function connect() {
    setConnectBusy(true);
    try {
      const res = await fetch("/api/reviews/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "link" }),
      });
      const body = (await res.json()) as { url?: string };
      if (res.ok && body.url) {
        window.location.href = body.url;
        return;
      }
    } catch {
      // fall through
    }
    setConnectBusy(false);
  }

  async function copyLink() {
    const url = `${window.location.origin}/coach/${profile.handle}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard denied; the link is still visible in the row
    }
  }

  const setupSteps: Array<{ label: string; done: boolean; href?: string }> = [
    {
      label: "Create an offering",
      done: offeringCount > 0,
      href: "/coaching/offerings",
    },
    { label: "Set up payouts", done: profile.charges_enabled },
    {
      label: "Publish your page",
      done: profile.published,
      href: "/coaching/profile",
    },
  ];
  const setupLeft = setupSteps.some((s) => !s.done);

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Coaching
        </h1>
        <button
          type="button"
          onClick={copyLink}
          className="rounded-full border border-edge bg-surface px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40"
        >
          {copied ? "Copied" : `/coach/${profile.handle}`}
        </button>
      </div>

      {setupLeft && (
        <div className="mt-6 rounded-2xl border border-edge bg-surface p-5">
          <ul className="space-y-3">
            {setupSteps.map((step) => (
              <li key={step.label} className="flex items-center gap-3 text-sm">
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
                    step.done
                      ? "border-cyan-glow/50 text-cyan-glow"
                      : "border-edge text-transparent"
                  }`}
                >
                  ✓
                </span>
                {step.done ? (
                  <span className="text-zinc-500 line-through">
                    {step.label}
                  </span>
                ) : step.href ? (
                  <Link
                    href={step.href}
                    className="text-zinc-200 hover:text-cyan-glow"
                  >
                    {step.label}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={connect}
                    disabled={connectBusy}
                    className="text-left text-zinc-200 hover:text-cyan-glow disabled:opacity-60"
                  >
                    {connectBusy ? "Opening Stripe" : step.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats.completed_count > 0 && (
        <div className="mt-6 flex gap-6 rounded-2xl border border-edge bg-surface px-5 py-4 text-sm">
          <div>
            <p className="text-lg font-semibold tabular-nums text-zinc-100">
              {formatUsd(stats.earned_cents)}
            </p>
            <p className="text-xs text-zinc-500">earned</p>
          </div>
          <div>
            <p className="text-lg font-semibold tabular-nums text-zinc-100">
              {stats.completed_count}
            </p>
            <p className="text-xs text-zinc-500">completed</p>
          </div>
          <div>
            <p className="text-lg font-semibold tabular-nums text-zinc-100">
              {stats.active_count}
            </p>
            <p className="text-xs text-zinc-500">active</p>
          </div>
        </div>
      )}

      <Group label="Your move" orders={groups.yourMove} />
      <Group label="In progress" orders={groups.inProgress} />
      <Group label="Waiting on them" orders={groups.waiting} />
      <Group label="Done" orders={groups.done} />

      {initialQueue.length === 0 && (
        <p className="mt-6 text-sm text-zinc-500">No orders yet.</p>
      )}

      <div className="mt-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Availability
        </h2>
        <div className="divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
          <label className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm">
            <span className="font-medium text-zinc-200">
              Taking new orders
            </span>
            <input
              type="checkbox"
              checked={accepting}
              onChange={(e) => {
                setAccepting(e.target.checked);
                void saveAvailability({ accepting: e.target.checked });
              }}
              className="h-5 w-9 cursor-pointer appearance-none rounded-full bg-surface-2 outline outline-1 outline-edge transition-colors checked:bg-cyan-glow/80 before:mt-0.5 before:ml-0.5 before:block before:h-4 before:w-4 before:rounded-full before:bg-zinc-400 before:transition-transform checked:before:translate-x-4 checked:before:bg-ink"
            />
          </label>
          <div className="flex items-center justify-between px-5 py-4 text-sm">
            <div>
              <p className="font-medium text-zinc-200">Most orders at once</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                New purchases pause at the limit.
              </p>
            </div>
            <select
              value={maxActive ?? ""}
              onChange={(e) => {
                const v = e.target.value === "" ? null : Number(e.target.value);
                setMaxActive(v);
                void saveAvailability({ maxActive: v });
              }}
              className="rounded-xl border border-edge bg-surface-2 px-3 py-2 text-sm text-zinc-200 outline-none"
            >
              <option value="">No limit</option>
              {[1, 2, 3, 5, 10, 20].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <div className="divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
          <Link
            href="/coaching/offerings"
            className="flex items-center justify-between px-5 py-4 text-sm font-medium text-zinc-200 transition-colors hover:bg-surface-2"
          >
            Offerings
            <span className="text-xs text-zinc-500">{offeringCount}</span>
          </Link>
          <Link
            href="/coaching/profile"
            className="flex items-center justify-between px-5 py-4 text-sm font-medium text-zinc-200 transition-colors hover:bg-surface-2"
          >
            Your page
            <span className="text-xs text-zinc-500">
              {profile.published ? "Published" : "Hidden"}
            </span>
          </Link>
        </div>
      </div>
    </>
  );
}
