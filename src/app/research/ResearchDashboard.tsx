import Link from "next/link";
import { Logo } from "@/components/Logo";
import type { ResearchPage } from "./researchDashboardModel";

export function ResearchDashboard({
  pages,
}: {
  pages: readonly ResearchPage[];
}) {
  return (
    <div className="bg-arena relative min-h-screen overflow-hidden">
      <header className="relative mx-auto flex max-w-5xl items-center px-6 py-6 sm:px-8">
        <Logo href="/dashboard" />
      </header>

      <main className="relative mx-auto max-w-5xl px-6 pb-16 pt-10 sm:px-8 sm:pb-24 sm:pt-16">
        <p className="font-mono text-xs font-medium uppercase tracking-[0.24em] text-cyan-glow">
          Private workspace
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Research
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
          Active PongLens studies, experiments, and review tools in one place.
        </p>

        <section
          aria-label="Research pages"
          className="mt-10 grid gap-4 md:grid-cols-2"
        >
          {pages.map((page, index) => {
            const cyan = page.accent === "cyan";
            return (
              <Link
                key={page.href}
                href={page.href}
                aria-label={`Open ${page.title}`}
                className="group/card relative min-h-56 overflow-hidden rounded-2xl border border-edge bg-surface/80 p-6 transition duration-200 hover:-translate-y-0.5 hover:border-zinc-600 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-cyan-glow sm:p-7"
              >
                <div
                  aria-hidden="true"
                  className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent ${
                    cyan ? "via-cyan-glow/70" : "via-magenta-glow/70"
                  } to-transparent opacity-70`}
                />
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <p
                      className={`font-mono text-[11px] font-medium uppercase tracking-[0.2em] ${
                        cyan ? "text-cyan-glow" : "text-magenta-soft"
                      }`}
                    >
                      {page.category}
                    </p>
                    <h2 className="mt-4 text-xl font-semibold tracking-tight text-white sm:text-2xl">
                      {page.title}
                    </h2>
                  </div>
                  <span className="font-mono text-xs text-zinc-600">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <p className="mt-5 max-w-md text-sm leading-6 text-zinc-400 sm:text-base">
                  {page.description}
                </p>
                <span
                  aria-hidden="true"
                  className={`absolute bottom-6 right-6 text-xl transition-transform duration-200 group-hover/card:translate-x-1 ${
                    cyan ? "text-cyan-glow" : "text-magenta-soft"
                  }`}
                >
                  →
                </span>
              </Link>
            );
          })}
        </section>

        <p className="mt-8 text-xs leading-5 text-zinc-600">
          Access is limited to approved PongLens research reviewers.
        </p>
      </main>
    </div>
  );
}
