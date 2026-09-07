"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useWorkspace } from "@/lib/workspace";
import type { Workspace } from "@/lib/workspaceModel";
import { LessonVideosSection } from "./LessonVideosSection";
import { PlayerCoaching } from "./PlayerCoaching";
import { StudentsCard } from "./StudentsCard";
import { CoachFirstSteps, type CoachFirstStepsState } from "./CoachFirstSteps";
import { formatUsd } from "@/lib/reviews/money";
import type {
  CoachProfileRow,
  CoachQueueItem,
  CoachReviewStats,
  StudentOrderItem,
} from "@/lib/reviews/types";
import { orderStatusLabel } from "@/lib/reviews/types";
import type { NoteFeedRow } from "@/lib/types";
import { CoachStart } from "./CoachStart";

/**
 * The coaching home (restructured 2026-09-02). On the coaching side it is
 * today's work and nothing else: the orders that need you and a count of
 * the rest, the roster, the latest entries — the same shape as the iOS
 * Home, plus the order read the app is not allowed to carry. Everything
 * about selling — the queue in full, offerings, your page, availability,
 * payouts — lives one tab over on /coaching/orders. On the playing side
 * it holds your side of coaching: the coaches you work with and the
 * reviews you've bought, with the paid-reviews offer one tap away.
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

export function OrderRow({ order }: { order: CoachQueueItem }) {
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

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </h2>
  );
}

export function OrderGroup({
  label,
  orders,
}: {
  label: string;
  orders: CoachQueueItem[];
}) {
  if (orders.length === 0) return null;
  return (
    <div className="mt-6">
      <SectionLabel>{label}</SectionLabel>
      <div className="divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
        {orders.map((o) => (
          <OrderRow key={o.id} order={o} />
        ))}
      </div>
    </div>
  );
}

/** The offer to sell reviews, for anyone without a coach page yet. */
export function BecomeCoachCard({ defaultName }: { defaultName: string }) {
  const [open, setOpen] = useState(false);
  if (open) return <CoachStart defaultName={defaultName} embedded />;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium text-zinc-200">Offer paid reviews</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          Your price, your scope, your turnaround.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="glow-cta w-full shrink-0 rounded-full bg-cyan-glow px-4 py-2.5 text-sm font-semibold text-ink sm:w-auto sm:py-2"
      >
        Set up your page
      </button>
    </div>
  );
}

export function RowLink({
  href,
  label,
  detail,
  sub,
}: {
  href: string;
  label: string;
  detail?: string;
  /** One quiet sentence under the label saying what lives behind the
   *  row — always there, so a first-time coach never has to guess. */
  sub?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-4 px-5 py-4 text-sm font-medium text-zinc-200 transition-colors hover:bg-surface-2"
    >
      <span className="min-w-0">
        {label}
        {sub && (
          <span className="mt-0.5 block text-xs font-normal text-zinc-500">
            {sub}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs font-normal text-zinc-500">
        {detail}
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 text-zinc-500"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
        </svg>
      </span>
    </Link>
  );
}

export function CoachHub({
  workspace,
  profile,
  initialQueue,
  stats,
  offeringCount,
  studentOrders,
  coachNotes,
  userId,
  firstSteps,
}: {
  /** The side the server resolved (158). */
  workspace: Workspace;
  profile: CoachProfileRow | null;
  initialQueue: CoachQueueItem[];
  stats: CoachReviewStats;
  offeringCount: number;
  studentOrders: StudentOrderItem[];
  coachNotes: NoteFeedRow[];
  userId: string;
  /** The coach's checklist state, or null on the playing side. */
  firstSteps: CoachFirstStepsState | null;
}) {
  const router = useRouter();
  const bootRan = useRef(false);

  // One housekeeping pass per visit: quiet deliveries auto-complete and
  // any unpaid completions release. The Stripe return lands on Orders.
  useEffect(() => {
    if (bootRan.current || !profile) return;
    bootRan.current = true;
    const boot = async () => {
      await fetch("/api/reviews/transition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sweep" }),
      }).catch(() => {});
      router.refresh();
    };
    void boot();
  }, [router, profile]);

  // What needs you now: orders waiting on your move, and the ones inside
  // a day of their promised date. Five at most; the rest is a count.
  const needsYou = useMemo(() => {
    const q = initialQueue;
    const move = q.filter((o) => o.status === "submitted");
    const overdue = q.filter(
      (o) =>
        (o.status === "in_review" || o.status === "clarification") &&
        o.promised_by &&
        new Date(o.promised_by).getTime() - Date.now() < 24 * 3600 * 1000,
    );
    return [...move, ...overdue].slice(0, 5);
  }, [initialQueue]);

  const counts = useMemo(() => {
    const q = initialQueue;
    return {
      toStart: q.filter((o) => o.status === "submitted").length,
      inProgress: q.filter(
        (o) => o.status === "in_review" || o.status === "clarification",
      ).length,
      waiting: q.filter((o) => o.status === "awaiting_submission").length,
      delivered: q.filter(
        (o) => o.status === "delivered" || o.status === "completed",
      ).length,
    };
  }, [initialQueue]);

  // The three setup steps between claiming a handle and the first order.
  // Orders holds the checklist; Home says how far along it is.
  const payoutsReady =
    !!profile && profile.charges_enabled && profile.payouts_enabled;
  const setupMode =
    !!profile &&
    initialQueue.length === 0 &&
    stats.completed_count === 0 &&
    !(offeringCount > 0 && payoutsReady && profile.published);
  const setupDone =
    (offeringCount > 0 ? 1 : 0) +
    (payoutsReady ? 1 : 0) +
    (profile?.published ? 1 : 0);

  /** A coach with an empty roster, which is the only state where the
   *  order of this page matters: the card that adds somebody has to come
   *  before the eight-row checklist rather than after it. Read from the
   *  server's own count so the two do not disagree for a frame. */
  const noStudents = !!firstSteps && firstSteps.studentCount === 0;

  const orderSummary = (() => {
    const parts: string[] = [];
    if (counts.toStart > 0) parts.push(`${counts.toStart} to start`);
    if (counts.inProgress > 0) parts.push(`${counts.inProgress} in progress`);
    if (counts.waiting > 0) parts.push(`${counts.waiting} waiting on them`);
    if (counts.delivered > 0) parts.push(`${counts.delivered} delivered`);
    return parts.length > 0 ? parts.join(" · ") : "No orders yet.";
  })();

  // "Coaching" runs in two directions: you as a coach, and the coaches
  // you have. Which one this page shows is the workspace's decision (158)
  // — the same switch that changes the nav — never a toggle of its own.
  const coachWorkspace = useWorkspace(workspace) === "coach";
  const showPlayer = !coachWorkspace;

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Coaching</h1>

      {/* ---- the coaching side ---- */}

      {/* First steps: the new-coach checklist. Gone once the roster is
          established, every step is done, or it was hidden.
          BELOW the card while there are no students. Eight rows fill a
          660px phone on their own, which put the one thing a new coach
          came here to do — add somebody — under the fold and out of
          sight (Adil, 2026-09-05). The checklist is reference; the card
          is the door, and the door goes first. */}
      {coachWorkspace && noStudents && <StudentsCard />}

      {coachWorkspace && firstSteps && firstSteps.studentCount < 5 && (
        <CoachFirstSteps state={firstSteps} />
      )}

      {coachWorkspace && profile && (
        <div className="mt-6">
          <SectionLabel>Orders</SectionLabel>
          <div className="divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
            {!setupMode &&
              needsYou.map((o) => <OrderRow key={o.id} order={o} />)}
            {setupMode ? (
              <RowLink
                href="/coaching/orders"
                label="Before your first order"
                sub="Create an offering, set up payouts, publish your page."
                detail={`${setupDone} of 3`}
              />
            ) : (
              <RowLink
                href="/coaching/orders"
                label="All orders"
                sub={orderSummary}
              />
            )}
          </div>
        </div>
      )}

      {coachWorkspace && !noStudents && <StudentsCard />}

      {coachWorkspace && <LessonVideosSection />}

      {/* ---- the player's side of coaching ---- */}

      {/* One feed of everything between this player and their coaches,
          narrowed by coach. It replaces three sections that each answered
          part of the question and none of it in order: what a coach said
          on a match, the reviews you bought, and the list of coaches. */}
      {showPlayer && (
        <PlayerCoaching
          userId={userId}
          coachNotes={coachNotes}
          studentOrders={studentOrders}
        />
      )}

    </>
  );
}
