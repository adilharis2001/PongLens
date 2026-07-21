import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { NeonBallHero } from "@/components/anim/NeonBallHero";
import { TimelineDissolve } from "@/components/anim/TimelineDissolve";
import { HeatmapPulse } from "@/components/anim/HeatmapPulse";
import { SpinArrows } from "@/components/anim/SpinArrows";

const features = [
  {
    title: "Dead time, deleted",
    copy: "A 20 minute recording becomes the 5 minutes that matter. Every rally, none of the ball chasing.",
    anim: <TimelineDissolve />,
    soon: false,
  },
  {
    title: "See where every ball lands",
    copy: "A placement heatmap of your match. Find the corners you win and the ones you keep feeding.",
    anim: <HeatmapPulse />,
    soon: true,
  },
  {
    title: "Read the spin",
    copy: "Your opponent's spin patterns, read from the footage. Know what's coming before it lands.",
    anim: <SpinArrows />,
    soon: true,
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        {/* HERO — full-bleed animated arena backdrop with floating copy */}
        <section className="relative flex min-h-[calc(100vh-4rem)] items-center overflow-hidden">
          {/* animation layer: dimmed below lg where text sits on top of it */}
          <div className="absolute inset-0 opacity-50 lg:opacity-100">
            <NeonBallHero background />
          </div>
          {/* desktop scrim: strongest at the left and bottom so copy stays legible */}
          <div
            className="pointer-events-none absolute inset-0 hidden lg:block"
            aria-hidden
            style={{
              background:
                "linear-gradient(to right, rgba(10,10,18,.92) 0%, rgba(10,10,18,.55) 45%, rgba(10,10,18,.15) 75%, rgba(10,10,18,0) 100%)",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 hidden lg:block"
            aria-hidden
            style={{
              background:
                "linear-gradient(to top, rgba(10,10,18,.85) 0%, rgba(10,10,18,.25) 35%, rgba(10,10,18,0) 60%)",
            }}
          />
          {/* mobile/tablet scrim: lighter — the animation layer is already dimmed */}
          <div
            className="pointer-events-none absolute inset-0 lg:hidden"
            aria-hidden
            style={{
              background:
                "linear-gradient(to top, rgba(10,10,18,.5) 0%, rgba(10,10,18,.1) 30%, rgba(10,10,18,0) 55%)",
            }}
          />
          <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-24 pt-16 text-center sm:pt-24 lg:text-left">
            <div className="mx-auto max-w-3xl lg:mx-0">
              <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-6xl lg:text-7xl">
                Match analysis for{" "}
                <span className="text-cyan-glow text-glow">
                  table tennis players.
                </span>
              </h1>
              <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-zinc-300 sm:text-xl lg:mx-0">
                Upload a match video. See the play without the downtime, where
                your shots land, and how each point was won.
              </p>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
                <Link
                  href="/login"
                  className="glow-cta rounded-full bg-cyan-glow px-8 py-3.5 text-base font-semibold text-ink sm:text-lg"
                >
                  Analyze your first match
                </Link>
                <Link
                  href="#features"
                  className="rounded-full px-5 py-3.5 text-base font-medium text-zinc-300 transition-colors hover:text-white sm:text-lg"
                >
                  See what it does →
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              A lens on every rally
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-zinc-400">
              PongLens is a web app that turns your table tennis match videos
              into something you can study. Point your phone at the table, play
              your match, upload the file — PongLens does the rest.
            </p>
            <div className="mt-14 grid gap-8 md:grid-cols-3">
              {features.map((f) => (
                <article
                  key={f.title}
                  className="group overflow-hidden rounded-2xl border border-edge bg-surface transition-colors hover:border-cyan-glow/40"
                >
                  <div className="relative aspect-[3/2] overflow-hidden">
                    {f.anim}
                    {f.soon && (
                      <span className="absolute right-3 top-3 rounded-full border border-magenta-glow/50 bg-ink/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-magenta-soft backdrop-blur">
                        Coming soon
                      </span>
                    )}
                  </div>
                  <div className="p-6">
                    <h3 className="text-lg font-semibold">{f.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                      {f.copy}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* CTA BAND */}
        <section className="bg-band border-y border-edge">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-16 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Try it on your{" "}
              <span className="text-magenta-soft">next match</span>.
            </h2>
            <p className="max-w-xl text-zinc-400">
              Upload one video and see the difference.
            </p>
            <Link
              href="/login"
              className="glow-cta rounded-full bg-cyan-glow px-8 py-3 text-base font-semibold text-ink"
            >
              Analyze your first match
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
