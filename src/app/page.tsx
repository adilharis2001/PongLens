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
  CoachGlance,
  MapGlance,
  ShareGlance,
} from "@/components/marketing/LiveCards";
import { getSupportEmail } from "@/lib/config";

// The step-by-step walkthrough band that used to sit on this page is gone:
// the 1:52 video says the same thing better, and in the product's own
// voice. The band itself is still alive on /coaches, and this page's six
// chapters of copy are in git if they are ever wanted back.

// Who it's for — three kinds of PLAYERS, not three feature lists. Each
// column is a live unboxed fragment of the product plus one line of
// copy about the person. Fits a single viewport.
const personas = [
  {
    lead: "The highlight poster.",
    copy: "You play for the moments worth posting. Share a link to the match or your starred points, and export clips with the score burned in.",
    card: <ShareGlance />,
  },
  {
    lead: "The game analyzer.",
    copy: "You rewatch matches to find the patterns. Score, tag, and annotate each one, and your stats and placement maps build up as you play.",
    card: <MapGlance />,
  },
  {
    lead: "The coach and student.",
    copy: "Lessons keep going after the session ends. The coach joins with a link, leaves notes on the exact points, and the takeaways land in the student's journal.",
    card: <CoachGlance />,
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
        "Match analysis for table tennis players. Upload a match video and PongLens removes the dead time, cuts the match into individual points, and gives you a place to add notes and share with your coach.",
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
                Match analysis for{" "}
                <span className="text-cyan-glow text-glow">
                  table tennis players.
                </span>
              </h1>
              <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-zinc-300 sm:text-xl lg:mx-0">
                Upload a match video. Get back just the play: every point
                clipped, mapped, and scored, with a place for your notes,
                your stats, and your coach.
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

        {/* WALKTHROUGH — the whole product, in order, as a video.
            Ahead of the feature cards on purpose: the cards are the detail,
            and the detail reads better once you have seen the thing. */}
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
              See how it works
            </h2>
            <div className="mt-8 sm:mt-12">
              <LandingVideo />
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

        {/* WHO IT'S FOR — three compact columns, no boxes */}
        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              Who it&apos;s for
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-zinc-400">
              Post it, study it, or work through it with a coach.
            </p>
            {/* bento persona cards: visual tile, then headline, then copy,
                one self-contained unit — tight on every viewport */}
            <div className="mx-auto mt-14 grid max-w-sm gap-5 md:max-w-none md:grid-cols-3">
              {personas.map((p) => (
                <article
                  key={p.lead}
                  className="flex flex-col rounded-2xl border border-edge bg-surface/60 p-5 shadow-xl shadow-black/40"
                >
                  {/* The tile is desktop only. On a phone these three cards
                      turn a section that says one short thing into a long
                      scroll, and the copy is what the section is for. */}
                  <div className="hidden md:block">{p.card}</div>
                  <h3 className="text-lg font-bold tracking-tight md:mt-4">
                    <span className="text-cyan-glow">{p.lead}</span>
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                    {p.copy}
                  </p>
                </article>
              ))}
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
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
