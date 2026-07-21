import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

const features = [
  {
    title: "Dead time, deleted",
    copy: "A 20-minute recording becomes the 5 minutes that matter — every rally, none of the ball-chasing.",
    image: "/img/feature-cut.jpg",
    alt: "Video timeline with dead segments dissolving away",
    soon: false,
  },
  {
    title: "See where every ball lands",
    copy: "A placement heatmap of your match — find the corners you win and the ones you keep feeding.",
    image: "/img/feature-map.jpg",
    alt: "Top-down table with glowing bounce-point heatmap",
    soon: true,
  },
  {
    title: "Read the spin",
    copy: "Your opponent's spin fingerprint, decoded from the footage — know what's coming before it lands.",
    image: "/img/feature-spin.jpg",
    alt: "Glowing ball with spin-arrow trails",
    soon: true,
  },
];

const pricingBullets = [
  "Unlimited uploads while we're in early access",
  "Processing typically finishes in under 30 minutes",
  "Results are yours to download and keep",
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
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-glow/30 bg-cyan-glow/5 px-3 py-1 text-xs font-medium tracking-wide text-cyan-glow">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-glow pulse-cyan" />
                Early access — free
              </p>
              <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                Your table tennis matches,{" "}
                <span className="text-cyan-glow text-glow">decoded</span>.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-400">
                Upload a match video and get back a cut of pure play — no
                ball-chasing, no towel breaks. Placement maps, spin
                fingerprints, and full match reports are coming.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  href="/login"
                  className="glow-cta rounded-full bg-cyan-glow px-7 py-3 text-base font-semibold text-ink"
                >
                  Analyze your first match — free
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
              <Image
                src="/img/hero.jpg"
                alt="A table tennis ball tracing a glowing arc over a table at night"
                width={1536}
                height={1024}
                priority
                className="relative rounded-2xl border border-edge object-cover shadow-2xl"
              />
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
                    <Image
                      src={f.image}
                      alt={f.alt}
                      fill
                      sizes="(min-width: 768px) 33vw, 100vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
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

        {/* PRICING */}
        <section id="pricing" className="scroll-mt-20 pb-20 sm:pb-28">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              Pricing
            </h2>
            <div className="mx-auto mt-12 max-w-md">
              <div className="relative rounded-2xl border border-cyan-glow/40 bg-surface p-8 glow-ring">
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-cyan-glow px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-ink">
                  Early access
                </span>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-xl font-semibold">Free</h3>
                  <p className="text-4xl font-bold">
                    $0
                    <span className="text-base font-normal text-zinc-500">
                      /mo
                    </span>
                  </p>
                </div>
                <ul className="mt-6 space-y-3">
                  {pricingBullets.map((b) => (
                    <li
                      key={b}
                      className="flex items-start gap-3 text-sm text-zinc-300"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        className="mt-0.5 h-4 w-4 shrink-0 text-cyan-glow"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M6.4 12 2.7 8.3l1.2-1.2 2.5 2.5 5.7-5.7 1.2 1.2L6.4 12z" />
                      </svg>
                      {b}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/login"
                  className="glow-cta mt-8 block rounded-full bg-cyan-glow py-3 text-center font-semibold text-ink"
                >
                  Get started
                </Link>
                <p className="mt-4 text-center text-xs text-zinc-500">
                  Paid plans will come later — early users keep a generous free
                  tier.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA BAND */}
        <section className="bg-band border-y border-edge">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-16 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Stop scrubbing footage.{" "}
              <span className="text-magenta-soft">Start studying play.</span>
            </h2>
            <p className="max-w-xl text-zinc-400">
              Your next match deserves a second look. Upload one video and see
              the difference.
            </p>
            <Link
              href="/login"
              className="glow-cta rounded-full bg-cyan-glow px-8 py-3 text-base font-semibold text-ink"
            >
              Analyze your first match — free
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
