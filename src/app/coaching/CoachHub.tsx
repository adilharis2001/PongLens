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
          {(order.status === "delivered" || order.status === "completed") &&
            order.review_viewed_at && (
              <span className="text-cyan-glow"> · watched</span>
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

/**
 * First visit, nothing set up yet: show the shape of the whole thing in
 * three glances before the checklist. Cards, not a tour — the house
 * decision (dashboard checklist, 043 era) is that spotlight tours don't
 * survive contact with real users.
 */
function FirstRun({ handle }: { handle: string }) {
  const steps = [
    {
      title: "Pick a template",
      copy: "Serve, receive or full match. Your price, your turnaround, every word editable.",
      glyph: (
        <svg viewBox="0 0 48 32" className="h-8 w-12" aria-hidden="true">
          <rect x="2" y="6" width="26" height="20" rx="4" className="fill-surface-2 stroke-edge" strokeWidth="1.5" />
          <rect x="10" y="3" width="26" height="20" rx="4" className="fill-surface stroke-cyan-glow/50" strokeWidth="1.5" />
          <path d="M16 10h14M16 15h9" className="stroke-zinc-500" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      title: "Set up payouts",
      copy: "Stripe runs checkout and pays your bank. You never handle a card.",
      glyph: (
        <svg viewBox="0 0 48 32" className="h-8 w-12" aria-hidden="true">
          <rect x="6" y="6" width="36" height="22" rx="4" className="fill-surface-2 stroke-edge" strokeWidth="1.5" />
          <path d="M6 13h36" className="stroke-cyan-glow/60" strokeWidth="3" />
          <path d="M12 22h10" className="stroke-zinc-500" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      title: "Share your link",
      copy: `Publish, then send /coach/${handle} to your students. Orders land here.`,
      glyph: (
        <svg viewBox="0 0 48 32" className="h-8 w-12" fill="none" aria-hidden="true">
          <path d="M20 22a7 7 0 0 1 0-10l4-4a7 7 0 0 1 10 10l-2 2" className="stroke-cyan-glow/70" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M28 10a7 7 0 0 1 0 10l-4 4a7 7 0 0 1-10-10l2-2" className="stroke-zinc-500" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ),
    },
  ];
  return (
    <div className="mt-6">
      <div className="grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <div
            key={s.title}
            className="rounded-2xl border border-edge bg-surface p-4"
          >
            <div className="flex items-center justify-between">
              {s.glyph}
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-cyan-glow/50 text-xs font-semibold text-cyan-glow">
                {i + 1}
              </span>
            </div>
            <p className="mt-3 text-sm font-semibold text-zinc-200">
              {s.title}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              {s.copy}
            </p>
          </div>
        ))}
      </div>
      <Link
        href="/coaching/offerings"
        className="glow-cta mt-4 block w-full rounded-full bg-cyan-glow px-5 py-3 text-center text-sm font-semibold text-ink"
      >
        Start with a template
      </Link>
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

  async function openStripeDashboard() {
    setConnectBusy(true);
    try {
      const res = await fetch("/api/reviews/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "dashboard" }),
      });
      const body = (await res.json()) as { url?: string | null };
      if (res.ok && body.url) {
        window.open(body.url, "_blank", "noopener");
      }
    } catch {
      // quiet; the button re-enables
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Coaching
        </h1>
        <div className="flex items-center gap-2">
          <a
            href={`/coach/${profile.handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
              />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
            View your page
          </a>
          <button
            type="button"
            onClick={copyLink}
            className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-medium transition-colors ${
              copied
                ? "border-cyan-glow/60 text-cyan-glow"
                : "border-edge bg-surface text-zinc-300 hover:border-cyan-glow/40"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <rect x="8" y="8" width="12" height="12" rx="2.5" />
              <path
                strokeLinecap="round"
                d="M4.5 15.5A2.5 2.5 0 0 1 4 14V6.5A2.5 2.5 0 0 1 6.5 4H14c.55 0 1.05.18 1.46.48"
              />
            </svg>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>

      {offeringCount === 0 && initialQueue.length === 0 && (
        <FirstRun handle={profile.handle} />
      )}

      {setupLeft && offeringCount > 0 && (
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
        <div className="mt-6 flex flex-wrap items-end gap-6 rounded-2xl border border-edge bg-surface px-5 py-4 text-sm">
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
          <p className="ml-auto pb-0.5 text-xs text-zinc-600">
            Card fees come out of your share.
          </p>
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
          Payouts
        </h2>
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-edge bg-surface px-5 py-4">
          <div>
            <p className="text-sm font-medium text-zinc-200">
              {!profile.stripe_account_id
                ? "Not set up"
                : profile.charges_enabled && profile.payouts_enabled
                  ? "Ready"
                  : "Onboarding not finished"}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {!profile.stripe_account_id
                ? "Connect Stripe to sell reviews."
                : profile.charges_enabled && profile.payouts_enabled
                  ? "Stripe pays your bank when an order completes."
                  : "Stripe needs a few more details from you."}
            </p>
          </div>
          {profile.charges_enabled && profile.payouts_enabled ? (
            <button
              type="button"
              disabled={connectBusy}
              onClick={openStripeDashboard}
              className="shrink-0 rounded-full border border-edge px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40 disabled:opacity-60"
            >
              {connectBusy ? "Opening" : "Open Stripe"}
            </button>
          ) : (
            <button
              type="button"
              disabled={connectBusy}
              onClick={connect}
              className="glow-cta shrink-0 rounded-full bg-cyan-glow px-4 py-2 text-xs font-semibold text-ink disabled:opacity-60"
            >
              {connectBusy
                ? "Opening Stripe"
                : profile.stripe_account_id
                  ? "Finish setup"
                  : "Set up payouts"}
            </button>
          )}
        </div>
      </div>

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
