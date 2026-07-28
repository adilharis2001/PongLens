import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { TimelineDissolve } from "@/components/anim/TimelineDissolve";

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
 *
 * Every step has a desktop and a mobile capture; each viewport sees its
 * own form factor (mobile shots without a desktop twin show everywhere).
 * On md+ all images share one height so rows line up.
 */

const glow = (text: string) => (
  <span className="text-cyan-glow" key={text}>
    {text}
  </span>
);

interface Shot {
  src: string;
  kind: "m" | "d";
  alt: string;
  /** Repeats the step's desktop shot — hidden on md+. */
  mobileOnly?: boolean;
}

interface Step {
  title: string;
  copy: React.ReactNode;
  shots: Shot[];
  /** extra visual under the shots (step 1: the dead-time animation) */
  extra?: "deadspace";
}

const steps: Step[] = [
  {
    title: "Upload a match",
    copy: (
      <>
        Upload a recording from your phone, or import a match straight from
        a {glow("YouTube link")}.
      </>
    ),
    shots: [
      { src: "upload-d", kind: "d", alt: "Upload page on desktop" },
      {
        src: "upload-m",
        kind: "m",
        mobileOnly: true,
        alt: "Upload page on a phone",
      },
    ],
    extra: "deadspace",
  },
  {
    title: "Review every point",
    copy: (
      <>
        Every point becomes its own clip, with the serve, the winner, and{" "}
        {glow("notes that live right on the point")}, including frames you
        draw on.
      </>
    ),
    shots: [
      { src: "viewer-d", kind: "d", alt: "Match viewer on desktop" },
      {
        src: "viewer-m",
        kind: "m",
        mobileOnly: true,
        alt: "A point in the viewer",
      },
      {
        src: "notes-m",
        kind: "m",
        alt: "A point's notes with an annotated frame",
      },
    ],
  },
  {
    title: "Keep score",
    copy: (
      <>
        Tap who won each point while the video plays, and the{" "}
        {glow("scorecard builds itself")} game by game.
      </>
    ),
    shots: [
      { src: "score-d", kind: "d", alt: "Score mode on desktop" },
      { src: "score-m", kind: "m", mobileOnly: true, alt: "The score pad" },
    ],
  },
  {
    title: "Share and export",
    copy: (
      <>
        Share a public link to the match, your starred points, or a tag
        collection, and export videos with the {glow("score burned in")}.
      </>
    ),
    shots: [
      { src: "share-d", kind: "d", alt: "The share sheet on desktop" },
      { src: "share-m", kind: "m", mobileOnly: true, alt: "The share sheet" },
    ],
  },
  {
    title: "Bring your coach",
    copy: (
      <>
        A private invite lets your coach watch every point and{" "}
        {glow("leave notes exactly where they matter")}.
      </>
    ),
    shots: [
      { src: "coach-d", kind: "d", alt: "Coach notes on desktop" },
      {
        src: "coach-m",
        kind: "m",
        mobileOnly: true,
        alt: "Coach notes on a point",
      },
    ],
  },
  {
    title: "Match statistics",
    copy: (
      <>
        Serve and receive win rates, pressure points, and momentum,{" "}
        {glow("built from the points you score")}.
      </>
    ),
    shots: [
      { src: "stats-d", kind: "d", alt: "Match analysis on desktop" },
      {
        src: "stats-m",
        kind: "m",
        mobileOnly: true,
        alt: "Match analysis cards",
      },
    ],
  },
  {
    title: "Placement maps",
    copy: (
      <>
        A map of where your serves, their serves, and rallies{" "}
        {glow("land on the table")}.
      </>
    ),
    shots: [
      { src: "placement-d", kind: "d", alt: "Placement map on desktop" },
      {
        src: "placement-m",
        kind: "m",
        mobileOnly: true,
        alt: "Serve placement map",
      },
    ],
  },
  {
    title: "The journal",
    copy: (
      <>
        Match notes, coaching lessons broken into takeaways, practice
        entries, and the {glow("cues you're working on")}.
      </>
    ),
    shots: [
      { src: "journal-d", kind: "d", alt: "The journal on desktop" },
      {
        src: "journal-m",
        kind: "m",
        mobileOnly: true,
        alt: "The journal on a phone",
      },
    ],
  },
];

const slug = (t: string) => t.toLowerCase().replace(/\s+/g, "-");

function ShotImg({ shot }: { shot: Shot }) {
  // One shared height on md+ keeps mixed rows (wide desktop shot next to
  // a tall phone shot) aligned instead of ragged.
  const size =
    shot.kind === "m"
      ? shot.mobileOnly
        ? "w-64 sm:w-72 md:hidden"
        : "w-64 sm:w-72 md:h-[28rem] md:w-auto"
      : "hidden md:block md:h-[28rem] md:w-auto";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/showcase/${shot.src}.jpg`}
      alt={shot.alt}
      loading="lazy"
      decoding="async"
      className={`rounded-2xl border border-edge shadow-2xl shadow-black/50 ${size}`}
    />
  );
}

export default function ShowcasePage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-6 pb-24 pt-16 sm:pt-24">
          <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            PongLens is a{" "}
            <span className="text-cyan-glow">table tennis app</span> for
            competitive players.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-zinc-400">
            Upload a match video and it comes back with the dead time removed
            and every point cut into its own clip. Score the match, tag the
            patterns, and draw on frames to mark what matters. Your notes,
            coaching lessons, and stats build up in one place as you play.
            It runs in the browser, on your phone or your laptop, and your
            coach can join with a link.
          </p>

          {/* step index — jump anywhere while presenting */}
          <nav className="mt-10 flex flex-wrap gap-x-5 gap-y-2 text-sm">
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
                <div className="mt-8 flex flex-col items-center gap-6 md:flex-row md:items-start md:gap-8">
                  {s.shots.map((shot) => (
                    <ShotImg key={shot.src} shot={shot} />
                  ))}
                </div>
                {s.extra === "deadspace" && (
                  <div className="mt-6 w-full max-w-[44.75rem]">
                    <div className="relative h-28 overflow-hidden rounded-2xl border border-edge sm:h-36">
                      <TimelineDissolve />
                    </div>
                    <p className="mt-2 text-sm text-zinc-500">
                      The dead time between points, removed.
                    </p>
                  </div>
                )}
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
