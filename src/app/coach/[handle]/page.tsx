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
import { createAdminClient } from "@/lib/supabase/admin";
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
  const title = page ? page.display_name : "Coach";
  // The line a student reads in the link preview before deciding to tap.
  // Headline first (it is written to be exactly this), bio as fallback.
  const description =
    page?.headline?.trim() ||
    page?.bio?.trim().slice(0, 160) ||
    "Match review by a real coach on PongLens.";
  return {
    title,
    description,
    // Without these, messengers show the root layout's generic PongLens
    // card. The og image itself is the opengraph-image.tsx beside this
    // file — Next wires the file into og:image per route.
    openGraph: {
      title: `${title} · PongLens`,
      description,
      type: "profile",
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} · PongLens`,
      description,
    },
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

  // Count the open unless the coach is looking at their own page.
  // Best-effort: a lost count must never cost a page view.
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const admin = createAdminClient();
    const { data: cp } = await admin
      .from("coach_profiles")
      .select("user_id")
      .eq("handle", page.handle)
      .maybeSingle();
    if (cp && cp.user_id !== user?.id) {
      await admin
        .from("coach_page_views")
        .insert({ coach_id: cp.user_id });
    }
  } catch (e) {
    console.error("coach page view count:", e);
  }

  // 092: which economy is this page in for this viewer? A QA coach's page
  // only renders for test-mode viewers (coach_page hides it otherwise), so
  // a purchase here is simulated. The reverse — a test-mode viewer on a
  // real coach's page — must not offer a Buy button that the purchase RPC
  // would refuse anyway.
  let testStore = false;
  let testViewerLiveCoach = false;
  try {
    const supabase = await createClient();
    const { data: mode } = await supabase.rpc("current_billing_mode");
    if (mode === "test") {
      const admin = createAdminClient();
      const { data: cp } = await admin
        .from("coach_profiles")
        .select("user_id")
        .eq("handle", page.handle)
        .maybeSingle();
      const { data: qaRow } = cp
        ? await admin
            .from("app_roles")
            .select("user_id")
            .eq("user_id", cp.user_id)
            .eq("role", "qa")
            .maybeSingle()
        : { data: null };
      if (qaRow) testStore = true;
      else testViewerLiveCoach = true;
    }
  } catch (e) {
    console.error("coach page billing mode:", e);
  }

  const open = purchasesOn && page.available && !testViewerLiveCoach;
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
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pb-24 pt-10 sm:px-6 md:pt-16 lg:max-w-5xl">
        {/* One DOM for both layouts. Below lg the two wrappers are
            display: contents and the order-* classes keep the phone's
            single-column sequence. At lg they become a sticky identity
            rail and the content column. */}
        <div className="flex flex-col lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-x-12">
        <div className="contents lg:sticky lg:top-20 lg:block lg:self-start">
        <div className="order-1 flex items-center gap-4 lg:block">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt=""
              className="h-14 w-14 rounded-full border border-edge object-cover lg:h-32 lg:w-32"
            />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-edge bg-surface-2 text-xl font-semibold text-zinc-200 lg:h-32 lg:w-32 lg:text-4xl">
              {initial}
            </span>
          )}
          <div className="min-w-0 lg:mt-5">
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
          <ul className="order-2 mt-5 flex flex-wrap gap-2">
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

        {page.samples.length > 0 && (
          <div className="order-5 mt-6">
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
        </div>

        <div className="contents lg:block lg:min-w-0 lg:[&>:first-child]:mt-0">
        {page.bio && (
          <p className="order-3 mt-6 whitespace-pre-line text-[15px] leading-relaxed text-zinc-300">
            {page.bio}
          </p>
        )}

        {/* Blocks the coach wrote themselves, right after the bio: they
            are more of the same voice, so they read as more of the page
            rather than a new region of it. */}
        {(page.sections ?? []).length > 0 && (
          <div className="order-4 mt-8 space-y-6">
            {page.sections.map((s, i) => (
              <div key={`${s.title}-${i}`}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  {s.title}
                </h2>
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-zinc-300">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        )}

        {page.testimonials.length > 0 && (
          <div className="order-6 mt-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              From their players
            </h2>
            <div className="space-y-3">
              {page.testimonials.map((t) => (
                <figure
                  key={t.at}
                  className="rounded-2xl border border-edge bg-surface p-4"
                >
                  <blockquote className="text-sm leading-relaxed text-zinc-300">
                    {t.body}
                  </blockquote>
                  <figcaption className="mt-2 text-xs text-zinc-500">
                    {t.name}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}

        <div className="order-7 mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Reviews</h2>
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
        {testStore && (
          <p className="mt-2 text-sm text-zinc-500">
            Test payments. Checkout is simulated and nothing is charged.
          </p>
        )}
        {testViewerLiveCoach && (
          <p className="mt-2 text-sm text-zinc-500">
            Your account uses test payments, so buying from real coaches is
            off.
          </p>
        )}
        {!open && !testViewerLiveCoach && (
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
              className="overflow-hidden rounded-2xl border border-edge bg-surface lg:flex"
            >
              {art && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={art}
                  alt=""
                  className="aspect-[3/1.2] w-full object-cover lg:aspect-auto lg:w-44 lg:shrink-0"
                />
              )}
              <div className="min-w-0 flex-1 p-5">
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
        </div>
        </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
