"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { QRCodeSVG } from "qrcode.react";
import { Segmented } from "@/app/match/[id]/placementTable";
import { SharingSection } from "@/components/SharingSection";
import { formatUsd } from "@/lib/reviews/money";
import type {
  CoachProfileRow,
  CoachQueueItem,
  CoachReviewStats,
  StudentOrderItem,
} from "@/lib/reviews/types";
import { orderStatusLabel } from "@/lib/reviews/types";
import type { NoteFeedRow } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { CoachStart } from "./CoachStart";

/**
 * The Coaching tab is the whole coaching world in one place, the way the
 * Journal owns notes, lessons and Recollect. For a coach it reads like a
 * workspace: what needs you now, how the business is doing, then the
 * rooms (orders, offerings, your page). For everyone else it holds their
 * side of coaching: the coaches they work with and the reviews they've
 * bought — with the paid-reviews pitch one tap away, never in the way.
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
 * The free-to-paid nudge: someone already leaving notes on other
 * players' matches is a coach in everything but the page. Shown once;
 * Not now stores a user_metadata flag and it never comes back.
 */
function CoachNudgeCard({
  playerCount,
  defaultName,
}: {
  playerCount: number;
  defaultName: string;
}) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (hidden) return <BecomeCoachCard defaultName={defaultName} />;
  if (open) return <CoachStart defaultName={defaultName} embedded />;
  return (
    <div className="rounded-2xl border border-cyan-glow/30 bg-surface px-5 py-4">
      <p className="text-sm font-medium text-zinc-200">
        You already coach {playerCount === 1 ? "a player" : `${playerCount} players`} here.
      </p>
      <p className="mt-0.5 text-xs text-zinc-500">
        A page lets them pay you for the deep reviews.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="glow-cta rounded-full bg-cyan-glow px-4 py-2 text-sm font-semibold text-ink"
        >
          Set up your page
        </button>
        <button
          type="button"
          onClick={() => {
            setHidden(true);
            void createClient().auth.updateUser({
              data: { pl_coach_nudge_dismissed: true },
            });
          }}
          className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-400"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

/** The whistle-tab landing for someone who isn't a coach yet. */
function BecomeCoachCard({ defaultName }: { defaultName: string }) {
  const [open, setOpen] = useState(false);
  if (open) return <CoachStart defaultName={defaultName} embedded />;
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-edge bg-surface px-5 py-4">
      <div>
        <p className="text-sm font-medium text-zinc-200">
          Offer paid reviews
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">
          Your price, your scope, your turnaround.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="glow-cta shrink-0 rounded-full bg-cyan-glow px-4 py-2 text-xs font-semibold text-ink"
      >
        Set up your page
      </button>
    </div>
  );
}

function RowLink({
  href,
  label,
  detail,
}: {
  href: string;
  label: string;
  detail?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between px-5 py-4 text-sm font-medium text-zinc-200 transition-colors hover:bg-surface-2"
    >
      {label}
      <span className="flex items-center gap-2 text-xs font-normal text-zinc-500">
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

function ActionPill({
  onClick,
  href,
  active,
  children,
}: {
  onClick?: () => void;
  href?: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  const cls = `inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-medium transition-colors ${
    active
      ? "border-cyan-glow/60 text-cyan-glow"
      : "border-edge bg-surface text-zinc-300 hover:border-cyan-glow/40"
  }`;
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

export function CoachHub({
  profile,
  initialQueue,
  stats,
  offeringCount,
  studentOrders,
  coachNotes,
  hasCoachLinks,
  pageOpens7d,
  nudgePlayerCount,
  nudgeNoteCount,
  nudgeDismissed,
  userId,
  defaultName,
}: {
  profile: CoachProfileRow | null;
  initialQueue: CoachQueueItem[];
  stats: CoachReviewStats;
  offeringCount: number;
  studentOrders: StudentOrderItem[];
  coachNotes: NoteFeedRow[];
  hasCoachLinks: boolean;
  pageOpens7d: number;
  nudgePlayerCount: number;
  nudgeNoteCount: number;
  nudgeDismissed: boolean;
  userId: string;
  defaultName: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [accepting, setAccepting] = useState(
    profile?.accepting_orders ?? true,
  );
  const [maxActive, setMaxActive] = useState(
    profile?.max_active_orders ?? null,
  );
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectNote, setConnectNote] = useState<string | null>(null);
  const bootRan = useRef(false);

  // One housekeeping pass per visit: quiet deliveries auto-complete and
  // any unpaid completions release; returning from onboarding re-syncs the
  // capability flags Stripe just granted.
  useEffect(() => {
    if (bootRan.current || !profile) return;
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
  }, [router, searchParams, profile]);

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

  const activeCount = useMemo(
    () =>
      initialQueue.filter((o) =>
        ["awaiting_submission", "submitted", "in_review", "clarification",
          "delivered"].includes(o.status),
      ).length,
    [initialQueue],
  );

  // Until the three setup steps are done, the coach side of the tab IS
  // the setup: one checklist, no workspace furniture for a business that
  // doesn't exist yet. Any order history means the business exists, so
  // an established coach never falls back in here.
  const payoutsReady =
    !!profile && profile.charges_enabled && profile.payouts_enabled;
  const setupMode =
    !!profile &&
    initialQueue.length === 0 &&
    stats.completed_count === 0 &&
    !(offeringCount > 0 && payoutsReady && profile.published);

  // "Coaching" runs in two directions: you as a coach, and the coaches
  // you have. Someone living both gets a view switch; everyone else gets
  // exactly their side with no chrome. Hydrates to "coach" and reads the
  // remembered choice in an effect — sessionStorage in an initializer is
  // a hydration mismatch (see useIsCoach).
  const playerSide =
    hasCoachLinks || studentOrders.length > 0 || coachNotes.length > 0;
  const dual = !!profile && playerSide;
  const [view, setView] = useState<"coach" | "player">(
    profile ? "coach" : "player",
  );
  useEffect(() => {
    if (!dual) return;
    const stored = sessionStorage.getItem("pl-coaching-view");
    if (stored === "coach" || stored === "player") setView(stored);
  }, [dual]);
  const showCoach = !!profile && (!dual || view === "coach");
  const showPlayer = !profile || (dual && view === "player");

  async function saveAvailability(next: {
    accepting?: boolean;
    maxActive?: number | null;
  }) {
    if (!profile) return;
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
    setConnectNote(null);
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
    // A dead button reads as a broken page; say what happened.
    setConnectNote("Stripe didn't answer. Try again in a moment.");
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

  const pageUrl = profile
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/coach/${profile.handle}`
    : "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard denied; View page still shows the address
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Coaching
      </h1>

      {dual && (
        <div className="mt-4">
          <Segmented
            ariaLabel="Coaching view"
            options={[
              { key: "coach", label: "Coach" },
              { key: "player", label: "Your coaches" },
            ]}
            value={view}
            onChange={(v) => {
              setView(v);
              sessionStorage.setItem("pl-coaching-view", v);
            }}
          />
        </div>
      )}

      {profile && showCoach && !setupMode && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ActionPill href={`/coach/${profile.handle}`}>
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
            View page
          </ActionPill>
          <ActionPill onClick={copyLink} active={copied}>
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
          </ActionPill>
          <ActionPill onClick={() => setShowQr(!showQr)} active={showQr}>
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <rect x="4" y="4" width="6" height="6" rx="1" />
              <rect x="14" y="4" width="6" height="6" rx="1" />
              <rect x="4" y="14" width="6" height="6" rx="1" />
              <path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" />
            </svg>
            QR
          </ActionPill>
        </div>
      )}

      {showQr && profile && showCoach && (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-edge bg-surface p-6">
          <div className="rounded-xl bg-white p-4">
            <QRCodeSVG
              value={pageUrl}
              size={180}
              level="M"
              marginSize={2}
              bgColor="#ffffff"
              fgColor="#0a0a12"
            />
          </div>
          <p className="text-xs text-zinc-500">
            Scan to open your page. Put it up at the club.
          </p>
        </div>
      )}

      {profile && showCoach && needsYou.length > 0 && (
        <OrderGroup label="Needs you" orders={needsYou} />
      )}

      {profile && showCoach && stats.completed_count > 0 && (
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
        </div>
      )}

      {profile && showCoach && setupMode && (
        <CoachSetup
          handle={profile.handle}
          offeringDone={offeringCount > 0}
          payoutsDone={payoutsReady}
          payoutsStarted={!!profile.stripe_account_id}
          published={profile.published}
          connectBusy={connectBusy}
          connectNote={connectNote}
          onConnect={connect}
        />
      )}

      {profile && showCoach && !setupMode && (
        <div className="mt-6">
          <div className="divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
            <RowLink
              href="/coaching/orders"
              label="Orders"
              detail={activeCount > 0 ? `${activeCount} active` : undefined}
            />
            <RowLink
              href="/coaching/offerings"
              label="Offerings"
              detail={String(offeringCount)}
            />
            <RowLink
              href="/coaching/profile"
              label="Your page"
              detail={
                profile.published
                  ? `${pageOpens7d} ${
                      pageOpens7d === 1 ? "open" : "opens"
                    } this week`
                  : "Hidden"
              }
            />
          </div>
        </div>
      )}

      {profile && showCoach && !setupMode && (
        <div className="mt-6">
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
          {connectNote && (
            <p className="mt-2 text-xs text-amber-400">{connectNote}</p>
          )}
        </div>
      )}

      {profile && showCoach && !setupMode && (
        <div className="mt-6">
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
                <p className="font-medium text-zinc-200">
                  Most orders at once
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  New purchases pause at the limit.
                </p>
              </div>
              <select
                value={maxActive ?? ""}
                onChange={(e) => {
                  const v =
                    e.target.value === "" ? null : Number(e.target.value);
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
      )}

      {/* ---- the player's side of coaching ---- */}

      {showPlayer && <FromYourCoaches notes={coachNotes} />}

      {showPlayer && studentOrders.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Reviews you bought
          </h2>
          <div className="divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
            {studentOrders.slice(0, 3).map((o) => (
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
            {studentOrders.length > 3 && (
              <RowLink href="/orders" label="All your reviews" />
            )}
          </div>
        </div>
      )}

      {showPlayer && (
        <div className="mt-8">
          <SharingSection userId={userId} />
        </div>
      )}

      {!profile && (
        <div className="mt-8">
          {nudgePlayerCount >= 1 && nudgeNoteCount >= 3 && !nudgeDismissed ? (
            <CoachNudgeCard
              playerCount={nudgePlayerCount}
              defaultName={defaultName}
            />
          ) : (
            <BecomeCoachCard defaultName={defaultName} />
          )}
        </div>
      )}
    </>
  );
}

function noteAge(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function noteMatchLabel(n: NoteFeedRow): string {
  const parts: string[] = [];
  if (n.opponent_name) parts.push(`vs ${n.opponent_name}`);
  parts.push(
    new Date(n.played_at).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  );
  if (n.venue) parts.push(n.venue);
  return parts.join(" · ");
}

/**
 * What your coaches have said lately, grouped by match — the coaching
 * lens over the notes feed. The Journal keeps the full archive; this
 * answers "what did they tell me, and where" and jumps to the exact
 * point. Hidden entirely when there is nothing to show.
 */
function FromYourCoaches({ notes }: { notes: NoteFeedRow[] }) {
  if (notes.length === 0) return null;

  const byMatch = new Map<string, NoteFeedRow[]>();
  for (const n of notes) {
    const list = byMatch.get(n.match_id) ?? [];
    if (list.length < 2) list.push(n);
    byMatch.set(n.match_id, list);
  }
  const groups = [...byMatch.entries()].slice(0, 3);

  return (
    <div className="mt-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        From your coaches
      </h2>
      <div className="space-y-4">
        {groups.map(([matchId, list]) => {
          const newest = list[0];
          const href = newest.point_id
            ? `/match/${matchId}?p=${newest.point_id}`
            : `/match/${matchId}`;
          return (
            <div
              key={matchId}
              className="rounded-2xl border border-edge bg-surface"
            >
              <div className="flex items-center justify-between gap-3 border-b border-edge/60 px-5 py-3">
                <p className="truncate text-xs font-medium text-zinc-400">
                  {noteMatchLabel(newest)}
                </p>
                <Link
                  href={href}
                  className="shrink-0 text-xs text-zinc-500 hover:text-cyan-glow"
                >
                  Open the match
                </Link>
              </div>
              <div className="divide-y divide-edge/40">
                {list.map((n) => (
                  <div key={n.id} className="px-5 py-3">
                    <p className="text-xs font-medium text-amber-400">
                      {n.author_name ?? "Coach"}
                      <span className="ml-2 font-normal text-zinc-600">
                        {noteAge(n.created_at)}
                      </span>
                    </p>
                    <p className="mt-1 flex items-start gap-1.5 text-sm text-zinc-300">
                      {n.audio_path && (
                        <svg
                          viewBox="0 0 24 24"
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <rect x="9" y="3" width="6" height="11" rx="3" />
                          <path
                            strokeLinecap="round"
                            d="M5 11a7 7 0 0 0 14 0M12 18v3"
                          />
                        </svg>
                      )}
                      {n.image_path && (
                        <svg
                          viewBox="0 0 24 24"
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <rect x="3" y="5" width="18" height="14" rx="2" />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m6 16 4-4 3 3 2.5-2.5L19 16"
                          />
                        </svg>
                      )}
                      <span className="line-clamp-2 min-w-0">
                        {n.body || (n.audio_path ? "Voice note" : "Drawing")}
                      </span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * First visit, nothing set up yet: show the shape of the whole thing in
 * three glances before anything else. Cards, not a tour — the house
 * decision is that spotlight tours don't survive contact with real users.
 */
/**
 * Setup mode: the three steps between claiming a handle and taking the
 * first order, in the dashboard First-steps idiom. State-derived like
 * that one — the product state IS the checklist, and the workspace
 * replaces it the moment all three are done.
 */
function CoachSetup({
  handle,
  offeringDone,
  payoutsDone,
  payoutsStarted,
  published,
  connectBusy,
  connectNote,
  onConnect,
}: {
  handle: string;
  offeringDone: boolean;
  payoutsDone: boolean;
  payoutsStarted: boolean;
  published: boolean;
  connectBusy: boolean;
  connectNote: string | null;
  onConnect: () => void;
}) {
  const items: {
    label: string;
    done: boolean;
    href?: string;
    onClick?: () => void;
  }[] = [
    {
      label: "Create an offering",
      done: offeringDone,
      href: "/coaching/offerings",
    },
    {
      label:
        payoutsStarted && !payoutsDone
          ? "Finish payouts setup"
          : "Set up payouts",
      done: payoutsDone,
      onClick: onConnect,
    },
    {
      label: "Publish your page",
      done: published,
      href: "/coaching/profile",
    },
  ];
  const doneCount = items.filter((i) => i.done).length;

  const chevron = (
    <svg
      viewBox="0 0 24 24"
      className="ml-auto h-4 w-4 text-zinc-600"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
    </svg>
  );

  return (
    <section className="mt-6 rounded-2xl border border-edge bg-surface p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold text-zinc-100">
          Before your first order
        </h2>
        <span className="text-xs tabular-nums text-zinc-500">
          {doneCount} of {items.length}
        </span>
      </div>
      <ul className="mt-4 space-y-1">
        {items.map((item) => {
          const icon = item.done ? (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-glow/15 text-cyan-glow">
              <svg
                viewBox="0 0 24 24"
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m5 13 4 4 10-10"
                />
              </svg>
            </span>
          ) : (
            <span
              className="h-5 w-5 shrink-0 rounded-full border border-edge"
              aria-hidden="true"
            />
          );
          const text = (
            <span
              className={`text-sm ${
                item.done
                  ? "text-zinc-500 line-through decoration-zinc-700"
                  : "text-zinc-200"
              }`}
            >
              {item.label}
            </span>
          );
          return (
            <li key={item.label}>
              {item.done ? (
                <span className="flex items-center gap-3 rounded-xl px-2 py-2">
                  {icon}
                  {text}
                </span>
              ) : item.href ? (
                <Link
                  href={item.href}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-2"
                >
                  {icon}
                  {text}
                  {chevron}
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={connectBusy}
                  onClick={item.onClick}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-2 disabled:opacity-60"
                >
                  {icon}
                  {text}
                  {chevron}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {connectNote && (
        <p className="mt-3 text-xs text-amber-400">{connectNote}</p>
      )}
      <p className="mt-3 border-t border-edge/60 pt-3 text-xs text-zinc-500">
        Your page will be at ponglens.com/coach/{handle}.
      </p>
    </section>
  );
}
