import Link from "next/link";
import { Logo } from "@/components/Logo";
import {
  MarketingAccessSection,
  type MarketingAccount,
} from "./MarketingAccessSection";
import type { MarketingSpace } from "./marketingDashboardModel";

/**
 * The marketing hub. One card per space, laid out like the research
 * dashboard so the two private workspaces read as the same kind of place.
 * `accounts` is null for anyone who is not the owner, which is what keeps
 * the access card off their page.
 */
export function MarketingDashboard({
  spaces,
  accounts,
}: {
  spaces: readonly MarketingSpace[];
  accounts: MarketingAccount[] | null;
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
          Marketing
        </h1>

        <section
          aria-label="Marketing spaces"
          className="mt-10 grid gap-4 md:grid-cols-2"
        >
          {spaces.map((space, index) => (
            <SpaceCard key={space.href} space={space} index={index} />
          ))}
        </section>

        {accounts !== null && <MarketingAccessSection accounts={accounts} />}
      </main>
    </div>
  );
}

/**
 * A live space is one large keyboard-focusable link. A planned one is the
 * same card with nothing to press, so the grid still says what is coming
 * without offering a door that opens on nothing.
 */
function SpaceCard({
  space,
  index,
}: {
  space: MarketingSpace;
  index: number;
}) {
  const cyan = space.accent === "cyan";
  const planned = space.status === "planned";

  const body = (
    <>
      <div
        aria-hidden="true"
        className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent ${
          cyan ? "via-cyan-glow/70" : "via-magenta-glow/70"
        } to-transparent ${planned ? "opacity-30" : "opacity-70"}`}
      />
      <div className="flex items-start justify-between gap-6">
        <div>
          <p
            className={`font-mono text-[11px] font-medium uppercase tracking-[0.2em] ${
              cyan ? "text-cyan-glow" : "text-magenta-soft"
            }`}
          >
            {space.category}
          </p>
          <h2 className="mt-4 text-xl font-semibold tracking-tight text-white sm:text-2xl">
            {space.title}
          </h2>
        </div>
        <span className="font-mono text-xs text-zinc-600">
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      <p className="mt-5 max-w-md text-sm leading-6 text-zinc-400 sm:text-base">
        {space.description}
      </p>
      {planned ? (
        <span className="absolute bottom-6 right-6 text-sm text-zinc-600">
          Not built yet
        </span>
      ) : (
        <span
          aria-hidden="true"
          className={`absolute bottom-6 right-6 text-xl transition-transform duration-200 group-hover/card:translate-x-1 ${
            cyan ? "text-cyan-glow" : "text-magenta-soft"
          }`}
        >
          →
        </span>
      )}
    </>
  );

  if (planned) {
    return (
      <div className="relative min-h-56 overflow-hidden rounded-2xl border border-edge/60 bg-surface/40 p-6 sm:p-7">
        {body}
      </div>
    );
  }

  return (
    <Link
      href={space.href}
      aria-label={`Open ${space.title}`}
      className="group/card relative min-h-56 overflow-hidden rounded-2xl border border-edge bg-surface/80 p-6 transition duration-200 hover:-translate-y-0.5 hover:border-zinc-600 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-cyan-glow sm:p-7"
    >
      {body}
    </Link>
  );
}
