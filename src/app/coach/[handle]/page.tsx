import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import Link from "next/link";

import { getCoachReviewsEnabled } from "@/lib/config";
import { MEDIA_BUCKET, presignGet } from "@/lib/r2";
import { formatUsd } from "@/lib/reviews/money";
import type { CoachPage } from "@/lib/reviews/types";
import { stockImageUrl } from "@/lib/reviews/types";
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
    title: page ? page.display_name : "Coach",
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

  // coach_page only returns a photo_path under the owner's avatar prefix,
  // so presigning it sight unseen is safe. One hour matches page caching.
  let photoUrl: string | null = null;
  const photoKey = page.photo_path?.match(/^r2:\/\/ponglens-media\/(.+)$/);
  if (photoKey) {
    try {
      photoUrl = await presignGet(MEDIA_BUCKET, photoKey[1], {
        expiresSeconds: 3600,
      });
    } catch (e) {
      console.error("coach page photo presign:", e);
    }
  }

  // Coach-uploaded offering art (coach_page only returns owner-prefixed
  // paths, so these are safe to presign sight unseen).
  const uploadedArt = new Map<string, string>();
  for (const o of page.offerings) {
    const key = o.image?.match(/^r2:\/\/ponglens-media\/(.+)$/);
    if (!key) continue;
    try {
      uploadedArt.set(
        o.id,
        await presignGet(MEDIA_BUCKET, key[1], { expiresSeconds: 3600 }),
      );
    } catch (e) {
      console.error("offering art presign:", e);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-arena">
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pb-24 pt-10 sm:px-6 md:pt-16">
        <div className="flex items-center gap-4">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt=""
              className="h-14 w-14 rounded-full border border-edge object-cover"
            />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-edge bg-surface-2 text-xl font-semibold text-zinc-200">
              {initial}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {page.display_name || page.handle}
            </h1>
            {page.headline && (
              <p className="mt-1 text-sm text-zinc-400">{page.headline}</p>
            )}
            {page.completed_count > 0 && (
              <p className="mt-1 text-xs text-zinc-500">
                {page.completed_count}{" "}
                {page.completed_count === 1
                  ? "review delivered"
                  : "reviews delivered"}
              </p>
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

        {page.samples.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              See them play
            </h2>
            <div className="flex flex-wrap gap-2">
              {page.samples.map((s) => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-edge bg-surface px-4 py-2 text-sm text-zinc-200 transition-colors hover:border-cyan-glow/40"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5 text-cyan-glow"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  {s.label || "Watch"}
                </a>
              ))}
            </div>
          </div>
        )}

        <h2 className="mt-10 text-xs font-semibold uppercase tracking-wider text-zinc-500">Reviews</h2>
        {page.has_sample_review && (
          <p className="mt-2 text-sm text-zinc-400">
            <Link
              href={`/coach/${page.handle}/sample`}
              className="text-cyan-glow hover:underline"
            >
              Read a real review
            </Link>{" "}
            {page.display_name || "this coach"} delivered, shared with the
            player&apos;s permission.
          </p>
        )}
        {!open && (
          <p className="mt-2 text-sm text-zinc-500">
            Not taking new orders right now.
          </p>
        )}
        <div className="mt-4 space-y-4">
          {page.offerings.length === 0 && (
            <p className="text-sm text-zinc-500">No reviews listed yet.</p>
          )}
          {page.offerings.map((o) => {
            const art = stockImageUrl(o.image) ?? uploadedArt.get(o.id);
            return (
            <section
              key={o.id}
              className="overflow-hidden rounded-2xl border border-edge bg-surface"
            >
              {art && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={art}
                  alt=""
                  className="aspect-[3/1.2] w-full object-cover"
                />
              )}
              <div className="p-5">
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
              <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
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
              </div>
            </section>
            );
          })}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
