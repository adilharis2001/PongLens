import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { PublicShell } from "../PublicShell";
import {
  guideBySlugForPlatform,
  legacyGuideRedirect,
  visibleGuides,
  visibleRelatedGuides,
} from "../catalog";
import type { Guide, GuideImage, GuideSection } from "../catalogTypes";

/**
 * One guide, rendered from its data in guides.ts. Screenshots follow the
 * showcase's viewport rule: a phone capture marked phoneTwin repeats what
 * the desktop capture shows, so it renders only where the desktop one is
 * hidden — each form factor sees its own screens.
 *
 * Public. A visitor gets the marketing chrome, a signed-in person the
 * app's. The page is indexable and carries HowTo markup for the guides
 * that open with steps, because "how do I record a table tennis match"
 * is a question search engines get and this is the answer.
 */

export function generateStaticParams() {
  return (["player", "coach"] as const).flatMap((audience) =>
    visibleGuides(audience, "web").map((guide) => ({ slug: guide.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = guideBySlugForPlatform(slug, "web");
  if (!guide) return { title: "Learn", robots: { index: false, follow: false } };
  return {
    title: guide.title,
    description: guide.summary,
    alternates: { canonical: `/learn/${guide.slug}` },
    robots: { index: true, follow: true },
    openGraph: {
      title: guide.title,
      description: guide.summary,
      url: `/learn/${guide.slug}`,
      siteName: "PongLens",
      type: "article",
    },
  };
}

function guideJsonLd(guide: Guide) {
  const steps = guide.sections.find((s) => s.steps && s.steps.length > 0)?.steps;
  const url = `https://www.ponglens.com/learn/${guide.slug}`;
  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "PongLens", item: "https://www.ponglens.com/" },
      { "@type": "ListItem", position: 2, name: "Learn", item: "https://www.ponglens.com/learn" },
      { "@type": "ListItem", position: 3, name: guide.title, item: url },
    ],
  };
  const article = steps
    ? {
        "@type": "HowTo",
        name: guide.title,
        description: guide.summary,
        url,
        step: steps.map((text, i) => ({
          "@type": "HowToStep",
          position: i + 1,
          text,
        })),
      }
    : {
        "@type": "TechArticle",
        headline: guide.title,
        description: guide.summary,
        url,
      };
  return {
    "@context": "https://schema.org",
    "@graph": [
      { ...article, publisher: { "@id": "https://www.ponglens.com/#organization" } },
      breadcrumb,
    ],
  };
}

function ShotImg({ image }: { image: GuideImage }) {
  const size =
    image.kind === "m"
      ? image.phoneTwin
        ? "w-60 sm:w-64 md:hidden"
        : "w-60 sm:w-64"
      : "hidden w-full max-w-2xl md:block";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.src}
      alt={image.alt}
      loading="lazy"
      decoding="async"
      className={`rounded-2xl border border-edge shadow-2xl shadow-black/50 ${size}`}
    />
  );
}

function Section({ section }: { section: GuideSection }) {
  return (
    <section className="mt-10">
      {section.heading && (
        <h2 className="text-lg font-semibold tracking-tight text-zinc-100">
          {section.heading}
        </h2>
      )}
      {section.steps && (
        <ol className="mt-4 max-w-2xl space-y-3">
          {section.steps.map((step, index) => (
            <li key={step.slice(0, 40)} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-glow/15 text-xs font-semibold text-cyan-glow">
                {index + 1}
              </span>
              <span className="pt-0.5 text-[15px] leading-relaxed text-zinc-300">
                {step}
              </span>
            </li>
          ))}
        </ol>
      )}
      {section.paragraphs?.map((p) => (
        <p
          key={p.slice(0, 40)}
          className="mt-3 max-w-2xl text-[15px] leading-relaxed text-zinc-400"
        >
          {p}
        </p>
      ))}
      {section.bullets && (
        <ul className="mt-3 max-w-2xl space-y-2">
          {section.bullets.map((b) => (
            <li key={b.slice(0, 40)} className="flex gap-3">
              <span
                className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-cyan-glow"
                aria-hidden="true"
              />
              <span className="text-[15px] leading-relaxed text-zinc-400">
                {b}
              </span>
            </li>
          ))}
        </ul>
      )}
      {section.images && section.images.length > 0 && (
        <div className="mt-6 flex flex-col items-center gap-6 md:flex-row md:items-start">
          {section.images.map((img) => (
            <ShotImg key={img.src} image={img} />
          ))}
        </div>
      )}
      {section.tip && (
        <div className="mt-5 max-w-2xl rounded-2xl border border-edge bg-surface p-4">
          <p className="text-[13px] leading-relaxed text-zinc-400">
            <span className="font-semibold text-zinc-200">Good to know </span>
            {section.tip}
          </p>
        </div>
      )}
    </section>
  );
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const redirectSlug = legacyGuideRedirect(slug);
  if (redirectSlug) {
    redirect(
      slug === "for-coaches"
        ? `/learn/${redirectSlug}?audience=coach`
        : `/learn/${redirectSlug}`,
    );
  }
  const guide = guideBySlugForPlatform(slug, "web");
  if (!guide) notFound();
  const audience = guide.visibility.audiences[0];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const avatarUrl =
    (user?.user_metadata?.avatar_url as string | undefined) ??
    (user?.user_metadata?.picture as string | undefined) ??
    null;

  const related = visibleRelatedGuides(guide, audience, "web");

  const body = (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(guideJsonLd(guide)) }}
      />
      <Link
        href={`/learn?audience=${audience}`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-cyan-glow"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
        </svg>
        Learn
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
        {guide.title}
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-400">
        {guide.summary}
      </p>

      {guide.sections.map((s, i) => (
        <Section key={s.heading ?? i} section={s} />
      ))}

      {related.length > 0 && (
        <div className="mt-14 border-t border-edge pt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Keep going
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {related.map((r) => (
              <Link
                key={r.slug}
                href={`/learn/${r.slug}?audience=${audience}`}
                className="block rounded-2xl border border-edge bg-surface p-4 transition-colors hover:border-cyan-glow/40 hover:bg-surface-2"
              >
                <h3 className="text-sm font-semibold text-zinc-100">
                  {r.title}
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
                  {r.summary}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!user && (
        <div className="mt-14 rounded-2xl border border-edge bg-surface p-6 text-center sm:p-8">
          <p className="text-lg font-semibold text-zinc-100">
            Try it on your next match.
          </p>
          <p className="mt-2 text-sm text-zinc-400">
            Free during beta: 250 processing minutes and 25 GB of storage.
          </p>
          <Link
            href="/login"
            className="glow-cta mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-cyan-glow px-6 text-base font-semibold text-ink"
          >
            Upload your first match
          </Link>
        </div>
      )}
    </>
  );

  if (!user) {
    return <PublicShell audience={audience}>{body}</PublicShell>;
  }
  return <AppShell avatarUrl={avatarUrl}>{body}</AppShell>;
}
