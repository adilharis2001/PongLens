import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { NeonBallHero } from "@/components/anim/NeonBallHero";
import { TimelineDissolve } from "@/components/anim/TimelineDissolve";
import { HeatmapPulse } from "@/components/anim/HeatmapPulse";
import { CoachShare } from "@/components/anim/CoachShare";
import { PointClips } from "@/components/anim/PointClips";
import { ScorecardLive } from "@/components/anim/ScorecardLive";
import { JournalFeed } from "@/components/anim/JournalFeed";
import { LandingVideo } from "@/components/marketing/LandingVideo";
import {
  WalkthroughBand,
  type Chapter,
} from "@/components/marketing/WalkthroughBand";
import { getSupportEmail } from "@/lib/config";
import { WALKTHROUGH, WALKTHROUGH_TRANSCRIPT } from "@/lib/walkthrough";

// The "Who it's for" columns are gone, along with the LiveCards fragments
// that were their tiles. Three personas describing the product back to you
// is what a page says when it has nothing to show; this one now shows the
// thing itself, twice over.

const glow = (text: string) => (
  <span className="text-cyan-glow" key={text}>
    {text}
  </span>
);

// What you do — the walkthrough band, but pointed at the one question the
// rest of this page does not answer.
//
// The video shows what comes back and the feature cards say what the parts
// are, so a third pass at "here is what it can do" would be the same
// answer told a third way. The question someone actually has when the video
// stops is what is being asked of THEM: do I need a tripod, do I score
// every point by hand, how long is this going to cost me. Four steps, and
// the fourth exists to say that there is no fifth.
//
// The /coaches band is the model here: a sequence of things a person has to
// do, each one naming a decision, an effort or a promise, rather than a
// feature with a step number in front of it.
const chapters: Chapter[] = [
  {
    shots: ["record"],
    title: "Record the match",
    caption: (
      <>
        Put your phone diagonally behind you and raised a little, in
        landscape, with {glow("the whole table in frame")}. The PongLens
        mobile app shows you where to put it, and starts the upload while
        you play.
      </>
    ),
  },
  {
    shots: ["upload"],
    title: "Upload it",
    caption: (
      <>
        Upload the file, or paste a YouTube link if the match is already
        online. {glow("You get an email when it is ready")}.
      </>
    ),
  },
  {
    shots: ["score"],
    title: "Score the points",
    caption: (
      <>
        The points play back one after another and you say who won each one.{" "}
        {glow("A full match takes about ten minutes")}.
      </>
    ),
  },
  {
    shots: ["stats", "placement", "share"],
    title: "Everything else is automatic",
    caption: (
      <>
        Your stats, pressure points and placement maps are built from the
        scoring. From there you can{" "}
        {glow("share the match with your coach")} or export a point to post
        on social media.
      </>
    ),
  },
];

const features = [
  {
    title: "Pure play cut",
    copy: "Upload a match and get back just the play. A 20 minute recording becomes the 5 minutes that matter.",
    anim: <TimelineDissolve />,
  },
  {
    title: "Every point, clipped",
    copy: "Each point becomes its own clip. See who served and who won. Add a note to any point you want to revisit.",
    anim: <PointClips />,
  },
  {
    title: "Placement maps",
    copy: "Where every ball lands: serves, receives, and the path of the rally. Find the corners you win and the ones you keep feeding.",
    anim: <HeatmapPulse />,
  },
  {
    title: "Live scorecard",
    copy: "Score the match point by point and share it live with friends. Export the match with the score baked in when it's done.",
    anim: <ScorecardLive />,
  },
  {
    title: "Bring your coach",
    copy: "Share a link with your coach. They see your matches and leave notes on the points that need work.",
    anim: <CoachShare />,
  },
  {
    title: "The journal",
    copy: "Match notes, coaching lessons broken into takeaways, practice entries, and the cues you're working on. Everything you write lands in one place.",
    anim: <JournalFeed />,
  },
];

const faqs = [
  {
    q: "What does PongLens do?",
    a: "You upload a table tennis match video. PongLens removes the dead time and cuts the match into individual points, so you can review each one, add notes, and share the match with your coach.",
  },
  {
    q: "What do I need to record a match?",
    a: "Just a phone. Set it on a tripod or prop it up with a side view of the table, record your match, and upload the file.",
  },
  {
    q: "How long does processing take?",
    a: "Usually under 30 minutes, though it can take longer depending on the length of the recording.",
  },
  {
    q: "Is PongLens free?",
    a: "PongLens is currently free for players during early access.",
  },
  {
    q: "What happens to my videos? Are they private?",
    a: "Your videos stay private. They're kept in private storage that only your account (and anyone you share with) can access. Original uploads are deleted 30 days after upload. Cut videos are deleted after 30 days, and your point clips stay while your account is active. Nothing is sold or shared with advertisers.",
  },
  {
    q: "What video formats can I upload?",
    a: "MP4 or MOV files up to 2 GB. A normal phone recording of a full match fits comfortably. You can also import a match straight from a YouTube link.",
  },
  {
    q: "Does it work on my phone?",
    a: "Yes. PongLens runs in the browser, so you can record on your phone and upload from it directly. No app to install.",
  },
  {
    q: "How does the AI work?",
    a: "PongLens uses computer vision to tell live play from downtime and to split your match into points. It only analyzes the footage you upload. It never alters your video or generates synthetic footage.",
  },
];

// Structured data (JSON-LD) so search engines and AI/LLM crawlers can read
// what PongLens is as machine-readable facts, not just prose.
const jsonLd = (supportEmail: string) => ({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://www.ponglens.com/#organization",
      name: "PongLens",
      url: "https://www.ponglens.com",
      logo: "https://www.ponglens.com/img/icon-512.png",
      email: supportEmail,
    },
    {
      "@type": "WebSite",
      "@id": "https://www.ponglens.com/#website",
      url: "https://www.ponglens.com",
      name: "PongLens",
      description:
        "PongLens turns table tennis match videos into something you can study. Upload a match and get pure play, every point clipped, and a place for you and your coach to work on it.",
      publisher: { "@id": "https://www.ponglens.com/#organization" },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://www.ponglens.com/#app",
      name: "PongLens",
      url: "https://www.ponglens.com",
      applicationCategory: "SportsApplication",
      operatingSystem: "Web",
      description:
        "A performance hub for competitive table tennis. Upload a match video and PongLens removes the dead time, cuts the match into individual points, and gives you a place to add notes and share with your coach.",
      featureList: [
        "Automatic removal of dead time between points",
        "Per-point clips with server detection and placement view",
        "Placement maps of serves, receives, and rally paths",
        "Live scorecard with shareable match exports",
        "Notes on any point",
        "Coach sharing with coach notes",
      ],
      publisher: { "@id": "https://www.ponglens.com/#organization" },
    },
    {
      // The walkthrough, described as data. A video's words are invisible to
      // search and to answer engines unless something on the page says what
      // is in it — this, plus the transcript below the player, is that
      // something. `transcript` is the property Google reads for the words
      // themselves; contentUrl is what makes the file eligible for a video
      // result rather than just a mention.
      "@type": "VideoObject",
      "@id": "https://www.ponglens.com/#walkthrough",
      name: "How PongLens works",
      description:
        "A walkthrough of PongLens: upload a table tennis match from your phone or YouTube, get it back with the dead time between points removed, score it in about ten minutes, and read what the match says about your game.",
      thumbnailUrl: ["https://www.ponglens.com/demo/walkthrough-desktop.jpg"],
      uploadDate: WALKTHROUGH.uploaded,
      duration: WALKTHROUGH.duration,
      contentUrl: "https://www.ponglens.com/demo/walkthrough-desktop.mp4",
      embedUrl: "https://www.ponglens.com/#walkthrough",
      transcript: WALKTHROUGH_TRANSCRIPT,
      isFamilyFriendly: true,
      publisher: { "@id": "https://www.ponglens.com/#organization" },
    },
    {
      "@type": "FAQPage",
      "@id": "https://www.ponglens.com/#faq",
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
});

export default async function Home() {
  const supportEmail = await getSupportEmail();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(supportEmail)) }}
      />
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
                A performance hub for{" "}
                <span className="text-cyan-glow text-glow">
                  competitive table tennis.
                </span>
              </h1>
              <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-zinc-300 sm:text-xl lg:mx-0">
                Upload a match video. PongLens removes the dead time
                between points, so every point comes back as its own clip.
                Score them as you watch, and your stats, your notes and
                your coach all live on the same match.
              </p>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
                <Link
                  href="/login"
                  className="glow-cta rounded-full bg-cyan-glow px-8 py-3.5 text-base font-semibold text-ink sm:text-lg"
                >
                  Analyze your first match
                </Link>
                <Link
                  href="#walkthrough"
                  className="rounded-full px-5 py-3.5 text-base font-medium text-zinc-300 transition-colors hover:text-white sm:text-lg"
                >
                  See it work ↓
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* FEATURES — the full list, the original animations */}
        <section id="features" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              A lens on every rally
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-zinc-400">
              Upload a match. Get pure play, every point clipped, and a place
              for you and your coach to work on it.
            </p>
            {/* mobile: swipeable snap carousel with next-card peek;
                md+: 3-column grid */}
            <div className="-mx-6 mt-14 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:grid md:grid-cols-3 md:gap-8 md:overflow-visible md:p-0">
              {features.map((f) => (
                <article
                  key={f.title}
                  className="group w-[80%] shrink-0 snap-center overflow-hidden rounded-2xl border border-edge bg-surface transition-colors hover:border-cyan-glow/40 md:w-auto md:shrink"
                >
                  <div className="relative aspect-[3/2] overflow-hidden">
                    {f.anim}
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

        {/* THE WALKTHROUGH — the whole product, moving and narrated.
            The hero's "See it work" link lands here. */}
        <section
          id="walkthrough"
          className="relative scroll-mt-20 overflow-hidden py-14 sm:py-28"
        >
          {/* Nothing painted behind this section, and that is the point.
              The composition used to carry a cyan wash, which inside a
              rectangle on a flat page IS the rectangle. Moving that wash
              here does not help: the video is opaque, so it punches a flat
              hole in the gradient and you get the same box inverted. Flat
              ink on both sides is the only arrangement with no seam at all. */}
          {/* Wider than the rest of the page, and narrower gutters on a
              phone. Everything else here is a column of text at max-w-6xl;
              this is a picture, and at that width it sat in the middle of the
              screen with a third of the viewport empty on either side. */}
          <div className="relative mx-auto max-w-[1500px] px-4 sm:px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              See PongLens in action
            </h2>
            <div className="mt-8 sm:mt-12">
              <LandingVideo />
            </div>
            {/* The narration as text, folded away.
                Closed by default because nobody came here to read a script,
                and present because the words are otherwise nowhere: they are
                burned into the picture, which a screen reader cannot reach
                and a crawler cannot index. A <details> ships its contents in
                the HTML either way. */}
            <details className="mx-auto mt-10 max-w-3xl">
              <summary className="cursor-pointer list-none text-center text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200">
                Read it instead
              </summary>
              <div className="mt-5 space-y-3 text-[15px] leading-relaxed text-zinc-400">
                {WALKTHROUGH.lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </details>
          </div>
        </section>

        {/* WHAT YOU DO — after the video, and deliberately not a second
            telling of it. That one answers what the product does; this one
            answers what it asks of you, which is the question someone has
            the moment a demo stops. The heading carries the handover on its
            own: no line of prose under it explaining that this is the
            written version. */}
        <section id="how-it-works" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              From recording to analysis
            </h2>
            <div className="mt-14">
              {/* Twice the default 3200ms. These captions run to about
                  twenty-five words, which is seven seconds of reading before
                  you even look at the screenshot beside them. */}
              <WalkthroughBand chapters={chapters} subMs={6500} />
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              Questions
            </h2>
            <div className="mt-12 divide-y divide-edge border-y border-edge">
              {faqs.map((f) => (
                <details key={f.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-lg font-medium text-zinc-100 transition-colors hover:text-white">
                    {f.q}
                    <span
                      aria-hidden
                      className="shrink-0 text-cyan-glow transition-transform duration-200 group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 max-w-2xl leading-relaxed text-zinc-400">
                    {f.a}
                  </p>
                </details>
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

            {/* Where it runs: the web today, the phones next. */}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
              <span className="flex items-center gap-2 rounded-full border border-cyan-glow/30 bg-surface/60 px-4 py-2">
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  className="h-4 w-4 text-cyan-glow"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3c2.5 2.6 3.75 5.7 3.75 9S14.5 18.4 12 21c-2.5-2.6-3.75-5.7-3.75-9S9.5 5.6 12 3z" />
                </svg>
                <span className="text-sm font-medium text-zinc-100">Web</span>
                <span className="text-xs text-zinc-500">available now</span>
              </span>
              <span className="flex items-center gap-2 rounded-full border border-edge bg-surface/60 px-4 py-2">
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-4 w-4 text-zinc-300"
                >
                  <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                </svg>
                <span className="text-sm font-medium text-zinc-300">iOS</span>
                <span className="text-xs text-zinc-500">coming soon</span>
              </span>
              <span className="flex items-center gap-2 rounded-full border border-edge bg-surface/60 px-4 py-2">
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-4 w-4 text-zinc-300"
                >
                  <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24a11.46 11.46 0 0 0-8.94 0L5.65 5.67c-.19-.29-.58-.38-.87-.2-.28.18-.37.54-.22.83L6.4 9.48A10.81 10.81 0 0 0 1 18h22a10.81 10.81 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z" />
                </svg>
                <span className="text-sm font-medium text-zinc-300">Android</span>
                <span className="text-xs text-zinc-500">coming soon</span>
              </span>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
