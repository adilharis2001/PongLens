import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { SectionHeading } from "@/components/SectionHeading";
import { STATUS_META, type BugStatus } from "@/lib/qa/bugs";
import { testCases } from "@/lib/qa/testLibrary";
import { requireTesting } from "./requireTesting";

export const metadata: Metadata = {
  title: "Testing",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * /testing — the tester's workspace. Three doors: what to test, a place to
 * write up what broke, and the queue both of us work from.
 *
 * The line under each card is live state, the same rule the admin hub
 * follows: the title says what the page is, the line says whether it wants
 * attention today.
 */
export default async function TestingPage() {
  const { supabase, isAdmin, avatarUrl } = await requireTesting("/testing");
  const { data } = await supabase.rpc("qa_bug_counts");
  const counts = (data ?? {}) as Partial<Record<BugStatus, number>>;

  const n = (s: BugStatus) => counts[s] ?? 0;
  // Whatever is sitting on the person looking at the page.
  const yours = isAdmin
    ? n("open") + n("triaged") + n("verified")
    : n("fixed");
  const smoke = testCases.filter((c) => c.depth === "smoke").length;

  const cards = [
    {
      href: "/testing/library",
      title: "Test library",
      detail: `${testCases.length} cases, ${smoke} to run every release`,
      attention: false,
    },
    {
      href: "/testing/report",
      title: "Report a bug",
      detail: "Screenshots by paste or drag",
      attention: false,
    },
    {
      href: "/testing/bugs",
      title: "Bugs",
      detail: yours
        ? `${yours} waiting on you`
        : `${n("open") + n("triaged") + n("fixed") + n("verified")} open`,
      attention: yours > 0,
    },
    {
      href: "/testing/import",
      title: "Import",
      detail: "Fill in the template, drop it back",
      attention: false,
    },
  ];

  return (
    <AppShell avatarUrl={avatarUrl} wide>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Testing</h1>

      <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <li key={card.href}>
            <Link
              href={card.href}
              className="group flex h-full flex-col justify-between gap-6 rounded-2xl border border-edge bg-surface p-5 transition-colors hover:border-cyan-glow/40"
            >
              <span className="block text-base font-semibold text-zinc-100">
                {card.title}
              </span>
              <span
                className={`block text-sm ${
                  card.attention ? "text-cyan-glow" : "text-zinc-500"
                }`}
              >
                {card.detail}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="mt-10">
        <SectionHeading>Where things stand</SectionHeading>
        <ul className="mt-4 flex flex-wrap gap-2">
          {(Object.keys(STATUS_META) as BugStatus[])
            .filter((s) => n(s) > 0)
            .map((s) => (
              <li
                key={s}
                className="rounded-full border border-edge bg-surface px-3.5 py-1.5 text-sm text-zinc-300"
              >
                {STATUS_META[s].label}{" "}
                <span className="font-semibold tabular-nums text-zinc-100">
                  {n(s)}
                </span>
              </li>
            ))}
          {Object.values(counts).every((v) => !v) && (
            <li className="text-sm text-zinc-500">No bugs filed yet.</li>
          )}
        </ul>
      </section>

      <section className="mt-10">
        <SectionHeading>Working here</SectionHeading>
        <div className="mt-4 space-y-3 rounded-2xl border border-edge bg-surface p-5 text-sm leading-relaxed text-zinc-400">
          <p>
            Start from the library. Each case says what to do, what should
            happen, and why that is the right answer, so you do not need to
            know table tennis to run one.
          </p>
          <p>
            When something breaks, report it from the case you were running
            and the case id comes with it. Anything about a video needs the
            match and the second it happened at, otherwise it cannot be
            looked into.
          </p>
          <p>
            A bug marked ready to verify is back with you. Check it on the
            device you first saw it on and either verify it or reopen it.
          </p>
        </div>
      </section>
    </AppShell>
  );
}
