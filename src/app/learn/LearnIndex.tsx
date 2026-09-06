"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  guideSearchText,
  guideSnippet,
  visibleGroups,
  visibleGuides,
  type Guide,
  type LearnAudience,
  type LearnPlatform,
} from "./guides";
import { LearnAudienceSwitch } from "./LearnAudienceSwitch";

/**
 * The Learn hub's index: a search box over every guide's full text, and
 * the guides grouped by theme when the box is empty.
 *
 * Search is a plain includes() walk over the guide text (see
 * guideSearchText) — a dozen guides need nothing smarter, and the result
 * list shows the sentence that matched so the hit explains itself.
 */

function GuideCard({
  guide,
  href,
  snippet,
}: {
  guide: Guide;
  href: string;
  snippet?: string | null;
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-edge bg-surface p-4 transition-colors hover:border-cyan-glow/40 hover:bg-surface-2"
    >
      <h3 className="text-sm font-semibold text-zinc-100">{guide.title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
        {snippet ?? guide.summary}
      </p>
    </Link>
  );
}

export function LearnIndex({
  audience,
  platform,
  activeWorkspace,
  canSwitch,
  /** Rendered directly under the search box, above the guides. */
  afterSearch,
}: {
  audience: LearnAudience;
  platform: LearnPlatform;
  activeWorkspace: LearnAudience;
  canSwitch: boolean;
  afterSearch?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const availableGuides = useMemo(
    () => visibleGuides(audience, platform),
    [audience, platform],
  );
  const groups = useMemo(
    () => visibleGroups(audience, platform),
    [audience, platform],
  );
  const guideHref = (slug: string) =>
    audience === activeWorkspace
      ? `/learn/${slug}`
      : `/learn/${slug}?audience=${audience}`;

  const results = useMemo(() => {
    if (!q) return null;
    // Title hits first, then everything else — the title is the strongest
    // signal of "this is the guide I meant".
    const titleHits = availableGuides.filter((g) => g.title.toLowerCase().includes(q));
    const bodyHits = availableGuides.filter(
      (g) => !titleHits.includes(g) && guideSearchText(g).includes(q)
    );
    return [...titleHits, ...bodyHits];
  }, [availableGuides, q]);

  return (
    <div>
      <div className="relative mt-6">
        <svg
          viewBox="0 0 24 24"
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path strokeLinecap="round" d="m20 20-3.2-3.2" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the guides"
          aria-label="Search the guides"
          className="w-full rounded-2xl border border-edge bg-surface py-3 pl-11 pr-4 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-glow/50 focus:outline-none"
        />
      </div>

      <LearnAudienceSwitch
        audience={audience}
        activeWorkspace={activeWorkspace}
        canSwitch={canSwitch}
      />

      {afterSearch}

      {results !== null ? (
        results.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-edge bg-surface p-6 text-center">
            <p className="text-sm text-zinc-300">Nothing found for that.</p>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-zinc-500">
              Try another word, or browse the guides below. Missing a guide
              you needed? Tell us through Send feedback on the Account page.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {results.map((g) => (
              <GuideCard
                key={g.slug}
                guide={g}
                href={guideHref(g.slug)}
                snippet={guideSnippet(g, q)}
              />
            ))}
          </div>
        )
      ) : (
        <div className="mt-8 space-y-8">
          {groups.map((group) => {
            const inGroup = availableGuides.filter((g) => g.group === group);
            if (inGroup.length === 0) return null;
            return (
              <section key={group}>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  {group}
                </h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {inGroup.map((g) => (
                    <GuideCard key={g.slug} guide={g} href={guideHref(g.slug)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
