import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import {
  guideBySlug,
  guides,
  type GuideImage,
  type GuideSection,
} from "../guides";

/**
 * One guide, rendered from its data in guides.ts. Screenshots follow the
 * showcase's viewport rule: a phone capture marked phoneTwin repeats what
 * the desktop capture shows, so it renders only where the desktop one is
 * hidden — each form factor sees its own screens.
 */

export function generateStaticParams() {
  return guides.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  return {
    title: guide ? guide.title : "Learn",
    robots: { index: false, follow: false },
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
  const guide = guideBySlug(slug);
  if (!guide) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  const related = (guide.related ?? [])
    .map((s) => guideBySlug(s))
    .filter((g): g is NonNullable<typeof g> => Boolean(g));

  return (
    <AppShell avatarUrl={avatarUrl}>
      <Link
        href="/learn"
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
                href={`/learn/${r.slug}`}
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
    </AppShell>
  );
}
