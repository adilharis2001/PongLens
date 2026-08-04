import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { getCoachReviewsEnabled } from "@/lib/config";
import { formatUsd } from "@/lib/reviews/money";
import type { CoachPage } from "@/lib/reviews/types";
import { createClient } from "@/lib/supabase/server";
import { BuyButton } from "./BuyButton";

/**
 * The coach's storefront. Unlisted: reachable by URL, linked from nowhere,
 * works logged out (coach_page() is anon-callable and returns only what
 * this page shows). Coaches share this link with their own students —
 * distribution is theirs by design.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const page = await loadCoachPage((await params).handle);
  return {
    title: page ? `${page.display_name} · PongLens` : "Coach",
    robots: { index: false, follow: false },
  };
}

async function loadCoachPage(handle: string): Promise<CoachPage | null> {
  if (!/^[a-z0-9][a-z0-9-]{2,29}$/i.test(handle)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("coach_page", {
    p_handle: handle.toLowerCase(),
  });
  if (error) {
    console.error("coach_page error:", error);
    return null;
  }
  return (data as CoachPage | null) ?? null;
}

export default async function CoachStorefront({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const [page, purchasesOn] = await Promise.all([
    loadCoachPage((await params).handle),
    getCoachReviewsEnabled(),
  ]);
  if (!page) notFound();

  const open = purchasesOn && page.available;
  const initial = (page.display_name || page.handle).slice(0, 1).toUpperCase();

  return (
    <div className="flex min-h-dvh flex-col bg-arena">
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pb-24 pt-10 sm:px-6 md:pt-16">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-edge bg-surface-2 text-xl font-semibold text-zinc-200">
            {initial}
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {page.display_name || page.handle}
            </h1>
            {page.headline && (
              <p className="mt-1 text-sm text-zinc-400">{page.headline}</p>
            )}
          </div>
        </div>

        {page.credentials.length > 0 && (
          <ul className="mt-5 flex flex-wrap gap-2">
            {page.credentials.map((c) => (
              <li
                key={c}
                className="rounded-full border border-edge bg-surface px-3 py-1 text-xs text-zinc-300"
              >
                {c}
              </li>
            ))}
          </ul>
        )}

        {page.bio && (
          <p className="mt-6 whitespace-pre-line text-[15px] leading-relaxed text-zinc-300">
            {page.bio}
          </p>
        )}

        <h2 className="mt-10 text-lg font-semibold tracking-tight">Reviews</h2>
        {!open && (
          <p className="mt-2 text-sm text-zinc-500">
            Not taking new orders right now.
          </p>
        )}
        <div className="mt-4 space-y-4">
          {page.offerings.length === 0 && (
            <p className="text-sm text-zinc-500">No reviews listed yet.</p>
          )}
          {page.offerings.map((o) => (
            <section
              key={o.id}
              className="rounded-2xl border border-edge bg-surface p-5"
            >
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="text-base font-semibold">{o.title}</h3>
                <span className="text-lg font-semibold tabular-nums text-cyan-glow">
                  {formatUsd(o.price_cents)}
                </span>
              </div>
              {o.description && (
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  {o.description}
                </p>
              )}
              {o.includes.length > 0 && (
                <ul className="mt-4 space-y-1.5">
                  {o.includes.map((line) => (
                    <li
                      key={line}
                      className="flex gap-2.5 text-sm text-zinc-300"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-glow/70"
                      />
                      {line}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-5 flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500">
                  Delivered within {o.turnaround_days}{" "}
                  {o.turnaround_days === 1 ? "day" : "days"} of your match
                  reaching {page.display_name || "the coach"}
                  {o.followup_rounds > 0 &&
                    `, with ${
                      o.followup_rounds === 1
                        ? "a follow-up question"
                        : `${o.followup_rounds} follow-up questions`
                    } included`}
                  .
                </p>
                {open && (
                  <BuyButton
                    offeringId={o.id}
                    handle={page.handle}
                    price={formatUsd(o.price_cents)}
                  />
                )}
              </div>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
