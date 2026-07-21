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
    copy: "Your opponent's spin fingerprint, decoded from the footage. Know what's coming before it lands.",
    anim: <SpinArrows />,
    soon: true,
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        {/* HERO */}
        <section className="bg-arena">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-16 sm:pt-24 lg:grid-cols-2 lg:gap-16">
            <div>
              <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                Your table tennis matches,{" "}
                <span className="text-cyan-glow text-glow">decoded</span>.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-400">
                Upload a match video and get back a cut of pure play. No
                ball-chasing, no towel breaks. Placement maps, spin
                fingerprints, and full match reports are coming.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  href="/login"
                  className="glow-cta rounded-full bg-cyan-glow px-7 py-3 text-base font-semibold text-ink"
                >
                  Analyze your first match
                </Link>
                <Link
                  href="#features"
                  className="rounded-full px-5 py-3 text-base font-medium text-zinc-400 transition-colors hover:text-white"
                >
                  See what it does →
                </Link>
              </div>
            </div>
            <div className="relative">
              <div className="absolute -inset-6 rounded-[2rem] bg-cyan-glow/10 blur-3xl" />
              <NeonBallHero />
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
              Point your phone at the table, play your match, upload the file.
              PongLens does the rest.
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
              Your table tennis match,{" "}
              <span className="text-magenta-soft">decoded</span>.
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
