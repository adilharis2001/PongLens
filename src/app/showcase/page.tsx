import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Showcase",
  robots: { index: false, follow: false },
};

/**
 * /showcase — the unlisted walking tour: the whole product in order, as
 * real screenshots (public/showcase/*, captured by scripts/demos/
 * shots.mjs against the staged demo account). Built to be scrolled
 * through while showing someone the app: one step, one idea, one screen.
 * Not linked from anywhere and noindexed on purpose.
 */

interface Shot {
  src: string;
  kind: "m" | "d";
  alt: string;
}

interface Step {
  title: string;
  copy: string;
  shots: Shot[];
}

const steps: Step[] = [
  {
    title: "Upload a match",
    copy: "From the phone that recorded it, or straight from a YouTube link. Processing removes the dead time and cuts the match into points.",
    shots: [
      { src: "upload-d", kind: "d", alt: "Upload page on desktop" },
      { src: "upload-m", kind: "m", alt: "Upload page on a phone" },
    ],
  },
  {
    title: "Review every point",
    copy: "A match viewer built for table tennis: each point is its own clip with serve, winner, and how it ended. Notes live on the exact point, and a drawn-on frame can travel with them.",
    shots: [
      { src: "viewer-d", kind: "d", alt: "Match viewer on desktop" },
      { src: "viewer-m", kind: "m", alt: "A point in the viewer" },
      {
        src: "notes-m",
        kind: "m",
        alt: "A point's notes with an annotated frame",
      },
    ],
  },
  {
    title: "Keep score",
    copy: "The interactive score pad follows the video. Two taps per point; skips, splits, and corrections included.",
    shots: [{ src: "score-m", kind: "m", alt: "The score pad" }],
  },
  {
    title: "Share and export",
    copy: "Public links for the match, the starred set, or any tag collection. Exports render with the title card and the score burned in.",
    shots: [{ src: "share-m", kind: "m", alt: "The share sheet" }],
  },
  {
    title: "Bring your coach",
    copy: "A private invite lets a coach watch every point and leave notes exactly where they matter.",
    shots: [{ src: "coach-m", kind: "m", alt: "Coach notes on a point" }],
  },
  {
    title: "Match statistics",
    copy: "Serve and receive win rates, pressure points, momentum. Built only from the points you score, so every number is earned.",
    shots: [
      { src: "stats-d", kind: "d", alt: "Match analysis on desktop" },
      { src: "stats-m", kind: "m", alt: "Match analysis cards" },
    ],
  },
  {
    title: "Placement maps",
    copy: "Where serves and rallies actually land, mapped from the footage.",
    shots: [{ src: "placement-m", kind: "m", alt: "Serve placement map" }],
  },
  {
    title: "The journal",
    copy: "Match notes, coaching lessons distilled into takeaways, practice entries, tags, and the cues being worked on. One place, across every match.",
    shots: [
      { src: "journal-d", kind: "d", alt: "The journal on desktop" },
      { src: "journal-m", kind: "m", alt: "The journal on a phone" },
    ],
  },
];

const slug = (t: string) => t.toLowerCase().replace(/\s+/g, "-");

function ShotImg({ shot }: { shot: Shot }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/showcase/${shot.src}.jpg`}
      alt={shot.alt}
      loading="lazy"
      decoding="async"
      className={`rounded-2xl border border-edge shadow-2xl shadow-black/50 ${
        shot.kind === "m"
          ? "w-64 sm:w-72"
          : "w-full min-w-0 flex-1 self-start"
      }`}
    />
  );
}

export default function ShowcasePage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-6 pb-24 pt-16 sm:pt-24">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            PongLens, step by step.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-zinc-400">
            The whole product in order. Every screen below is real.
          </p>

          {/* step index — jump anywhere while presenting */}
          <nav className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {steps.map((s, i) => (
              <a
                key={s.title}
                href={`#${slug(s.title)}`}
                className="text-zinc-500 transition-colors hover:text-cyan-glow"
              >
                <span className="mr-1.5 tabular-nums text-zinc-600">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {s.title}
              </a>
            ))}
          </nav>

          <div className="mt-20 space-y-28">
            {steps.map((s, i) => (
              <section
                key={s.title}
                id={slug(s.title)}
                className="scroll-mt-24"
              >
                <div className="flex items-baseline gap-4">
                  <span className="text-5xl font-bold tabular-nums text-zinc-800 sm:text-6xl">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                      {s.title}
                    </h2>
                    <p className="mt-2 max-w-xl leading-relaxed text-zinc-400">
                      {s.copy}
                    </p>
                  </div>
                </div>
                <div className="mt-8 flex flex-col items-center gap-6 lg:flex-row lg:items-start lg:gap-8">
                  {s.shots.map((shot) => (
                    <ShotImg key={shot.src} shot={shot} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="mt-28 border-t border-edge pt-12 text-center">
            <p className="text-zinc-400">That&apos;s the tour.</p>
            <Link
              href="/login"
              className="glow-cta mt-6 inline-block rounded-full bg-cyan-glow px-8 py-3 text-base font-semibold text-ink"
            >
              Try it on a match
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
