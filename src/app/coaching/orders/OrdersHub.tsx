"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { QRCodeSVG } from "qrcode.react";
import { PAYOUT_COUNTRIES } from "@/lib/payments/countries";
import { formatUsd } from "@/lib/reviews/money";
import type {
  CoachProfileRow,
  CoachQueueItem,
  CoachReviewStats,
} from "@/lib/reviews/types";
import { createClient } from "@/lib/supabase/client";
import { BecomeCoachCard, OrderGroup, RowLink, SectionLabel } from "../CoachHub";

/**
 * The marketplace, in one column (2026-09-02): the queue first, then the
 * page players buy from, then how you take orders and how you are paid.
 * It used to be the right-hand half of the coaching hub, which left a
 * coach with no orders a page that was mostly empty space. Home keeps a
 * short read of the queue and links here.
 *
 * A coach without a page lands on the offer to make one — the same card
 * the playing side shows — so the Orders tab is a door and not a wall.
 */
export function OrdersHub({
  profile,
  queue,
  stats,
  offeringCount,
  pageOpens7d,
  sponsoredLeft,
  defaultName,
}: {
  profile: CoachProfileRow | null;
  queue: CoachQueueItem[];
  stats: CoachReviewStats;
  offeringCount: number;
  pageOpens7d: number;
  /** Sponsored reviews the coach can still cover (096); null hides it. */
  sponsoredLeft: number | null;
  defaultName: string;
}) {
  if (!profile) {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Orders
        </h1>
        <div className="mt-6">
          <BecomeCoachCard defaultName={defaultName} />
        </div>
      </>
    );
  }
  return (
    <Marketplace
      profile={profile}
      queue={queue}
      stats={stats}
      offeringCount={offeringCount}
      pageOpens7d={pageOpens7d}
      sponsoredLeft={sponsoredLeft}
    />
  );
}

function Marketplace({
  profile,
  queue,
  stats,
  offeringCount,
  pageOpens7d,
  sponsoredLeft,
}: {
  profile: CoachProfileRow;
  queue: CoachQueueItem[];
  stats: CoachReviewStats;
  offeringCount: number;
  pageOpens7d: number;
  sponsoredLeft: number | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [accepting, setAccepting] = useState(profile.accepting_orders ?? true);
  const [maxActive, setMaxActive] = useState(profile.max_active_orders ?? null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [payoutCountry, setPayoutCountry] = useState(
    profile.payout_country ?? "",
  );
  const [connectNote, setConnectNote] = useState<string | null>(null);
  const bootRan = useRef(false);

  // One housekeeping pass per visit: quiet deliveries auto-complete and
  // any unpaid completions release; returning from Stripe onboarding
  // re-syncs the capability flags it just granted.
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
        router.replace("/coaching/orders");
      }
      router.refresh();
    };
    void boot();
  }, [router, searchParams]);

  const groups = useMemo(
    () => ({
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
    }),
    [queue],
  );

  // Until the three setup steps are done, this page IS the setup: one
  // checklist, no furniture for a business that doesn't exist yet. Any
  // order history means the business exists, so an established coach
  // never falls back in here.
  const payoutsReady = profile.charges_enabled && profile.payouts_enabled;
  const setupMode =
    queue.length === 0 &&
    stats.completed_count === 0 &&
    !(offeringCount > 0 && payoutsReady && profile.published);

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

  /**
   * Saved on change rather than behind a Save button: the coach is about to
   * leave for Stripe, and a country sitting unsaved in a select is exactly
   * the thing that would be lost on the way.
   */
  async function savePayoutCountry(code: string) {
    setPayoutCountry(code);
    setConnectNote(null);
    if (!code) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("coach_profiles")
      .update({ payout_country: code })
      .eq("user_id", profile.user_id);
    if (error) setConnectNote("Could not save that country. Try again.");
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
      const body = (await res.json()) as { url?: string; code?: string };
      if (res.ok && body.url) {
        window.location.href = body.url;
        return;
      }
      // Stripe fixes the country forever, so the route refuses rather than
      // guessing. Say what is missing instead of blaming Stripe for it.
      if (body.code === "country_required") {
        setConnectNote("Choose where you are paid first.");
        setConnectBusy(false);
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

  const pageUrl = `${
    typeof window !== "undefined" ? window.location.origin : ""
  }/coach/${profile.handle}`;

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
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Orders</h1>

      {setupMode ? (
        <CoachSetup
          handle={profile.handle}
          offeringDone={offeringCount > 0}
          payoutsDone={payoutsReady}
          payoutsStarted={!!profile.stripe_account_id}
          published={profile.published}
          connectBusy={connectBusy}
          connectNote={connectNote}
          onConnect={connect}
          payoutCountry={payoutCountry}
          onPayoutCountry={(code) => void savePayoutCountry(code)}
        />
      ) : (
        <>
          {/* Money only, and only once there is money to show. */}
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
            </div>
          )}

          {queue.length === 0 && (
            <p className="mt-6 text-sm text-zinc-500">No orders yet.</p>
          )}
          <OrderGroup label="Your move" orders={groups.yourMove} />
          <OrderGroup label="In progress" orders={groups.inProgress} />
          <OrderGroup label="Waiting on them" orders={groups.waiting} />
          <OrderGroup label="Done" orders={groups.done} />

          <div className="mt-8">
            <SectionLabel>Your page</SectionLabel>
            <div className="divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
              <RowLink
                href="/coaching/profile"
                label="Your page"
                sub="Your public page, where players find and buy."
                detail={
                  profile.published
                    ? `${pageOpens7d} ${pageOpens7d === 1 ? "open" : "opens"} this week`
                    : "Hidden"
                }
              />
              <RowLink
                href="/coaching/offerings"
                label="Offerings"
                sub="What you sell and the price you set."
                detail={String(offeringCount)}
              />
              {sponsoredLeft != null && (
                <RowLink
                  href="/coaching/sponsored"
                  label="Sponsored reviews"
                  sub="Cover a review for a student. They pay nothing."
                  detail={`${sponsoredLeft} left`}
                />
              )}
              <div className="flex flex-wrap items-center gap-2 px-5 py-3">
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
            </div>
            {showQr && (
              <div className="mt-3 flex flex-col items-center gap-3 rounded-2xl border border-edge bg-surface p-6">
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
          </div>

          <div className="mt-8">
            <SectionLabel>Availability</SectionLabel>
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

          <div className="mt-8">
            <SectionLabel>Payouts</SectionLabel>
            {!profile.stripe_account_id && (
              <div className="mb-3 rounded-2xl border border-edge bg-surface px-5 py-4">
                <label
                  htmlFor="payout-country"
                  className="text-sm font-medium text-zinc-200"
                >
                  Where are you paid?
                </label>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Stripe cannot change this later, so it has to be the country
                  of the bank account you want the money in.
                </p>
                <select
                  id="payout-country"
                  value={payoutCountry}
                  onChange={(e) => void savePayoutCountry(e.target.value)}
                  className="mt-3 rounded-full border border-edge bg-surface-2 px-4 py-2 text-sm text-zinc-200 focus:border-cyan-glow/50 focus:outline-none"
                >
                  <option value="">Choose a country</option>
                  {PAYOUT_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
                  className="shrink-0 rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40 disabled:opacity-60"
                >
                  {connectBusy ? "Opening" : "Open Stripe"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={connectBusy}
                  onClick={connect}
                  className="glow-cta shrink-0 rounded-full bg-cyan-glow px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
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
        </>
      )}
    </>
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
  const cls = `inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
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

/**
 * Setup mode: the three steps between claiming a handle and taking the
 * first order, in the dashboard First-steps idiom. State-derived like
 * that one — the product state IS the checklist, and the marketplace
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
  payoutCountry,
  onPayoutCountry,
}: {
  handle: string;
  offeringDone: boolean;
  payoutsDone: boolean;
  payoutsStarted: boolean;
  published: boolean;
  connectBusy: boolean;
  connectNote: string | null;
  onConnect: () => void;
  payoutCountry: string;
  onPayoutCountry: (code: string) => void;
}) {
  // Each step carries a line saying what it actually involves. A checklist
  // is the one place a subtitle earns its keep: the label is the verb, and
  // a coach setting this up for the first time has no way to know that
  // payouts means handing Stripe an ID and a bank account.
  const items: {
    label: string;
    hint: string;
    done: boolean;
    href?: string;
    onClick?: () => void;
  }[] = [
    {
      label: "Create an offering",
      hint: "What you review, what it costs, and how long you take.",
      done: offeringDone,
      href: "/coaching/offerings",
    },
    {
      label:
        payoutsStarted && !payoutsDone
          ? "Finish payouts setup"
          : "Set up payouts",
      hint:
        payoutsStarted && !payoutsDone
          ? "Stripe still needs a few details before it can pay you."
          : "Stripe confirms who you are and connects your bank account.",
      done: payoutsDone,
      onClick: onConnect,
    },
    {
      label: "Publish your page",
      hint: "Makes your page visible to anyone you send the link to.",
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
          // Done steps lose their hint. Once it is ticked the sentence is
          // advice nobody needs, and three struck-through rows with a line
          // under each is a wall of grey.
          const text = item.done ? (
            <span className="text-sm text-zinc-500 line-through decoration-zinc-700">
              {item.label}
            </span>
          ) : (
            <span className="min-w-0">
              <span className="block text-sm text-zinc-200">{item.label}</span>
              <span className="mt-0.5 block text-xs leading-snug text-zinc-500">
                {item.hint}
              </span>
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
      {!payoutsStarted && (
        <div className="mt-4 border-t border-edge/60 pt-4">
          <label
            htmlFor="payout-country-setup"
            className="text-xs font-medium text-zinc-300"
          >
            Where are you paid?
          </label>
          <p className="mt-0.5 text-xs text-zinc-500">
            Stripe cannot change this later, so it has to be the country of
            your bank account.
          </p>
          <select
            id="payout-country-setup"
            value={payoutCountry}
            onChange={(e) => onPayoutCountry(e.target.value)}
            className="mt-2 rounded-full border border-edge bg-surface-2 px-4 py-2 text-sm text-zinc-200 focus:border-cyan-glow/50 focus:outline-none"
          >
            <option value="">Choose a country</option>
            {PAYOUT_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {connectNote && (
        <p className="mt-3 text-xs text-amber-400">{connectNote}</p>
      )}
      <p className="mt-3 border-t border-edge/60 pt-3 text-xs text-zinc-500">
        Your page will be at ponglens.com/coach/{handle}.
      </p>
    </section>
  );
}
