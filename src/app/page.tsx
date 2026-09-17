import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { NeonBallHero } from "@/components/anim/NeonBallHero";
import { BrowserFrame } from "@/components/marketing/BrowserFrame";
import { CTA_CLASS, Feature, Phone } from "@/components/marketing/Feature";
import { IosBetaSignup } from "@/components/marketing/IosBetaSignup";
import { LandingVideo } from "@/components/marketing/LandingVideo";
import { PhoneFrame } from "@/components/marketing/PhoneFrame";
import { TrackedLink } from "@/components/marketing/TrackedLink";
import { getSupportEmail } from "@/lib/config";
import { BETA_ALLOWANCE } from "@/lib/marketing/beta";
import { WALKTHROUGH_CHAPTERS } from "@/lib/videoCuts";
import { WALKTHROUGH, WALKTHROUGH_TRANSCRIPT } from "@/lib/walkthrough";

/**
 * The landing page.
 *
 * Every picture on it is the real product. The phone and laptop shots come
 * from scripts/demos/shots.mjs against the staged demo account, or from
 * Adil's own matches against Anton (the only footage cleared for the
 * site); the analysis cards are element captures of one of those matches.
 * Nothing here is a drawing of a feature, and nothing claims a number the
 * product did not produce: "52 points and seven minutes of play" is match
 * 28a0bc1e as processed.
 *
 * One section per feature that matters, one heading and a sentence or two
 * each, in the order a first visit needs them: what comes back, what is
 * asked of you, what you get from that, who else can use it, what it
 * costs. The walkthrough video sits second, with chapter buttons, so a
 * visitor who only wants to see one thing can jump straight to it.
 */

// Real match, real numbers: 28a0bc1e, Adil v Anton at Pingpod, 7 Sep 2026.
// 10.2 minutes of recording, 52 points, 6.8 minutes of point clips.
const EXAMPLE = { recordingMinutes: 10, points: 52, playMinutesWord: "seven" };

const cards = [
  { src: "/showcase/card-overview.jpg", alt: "Overview card: point differential over the match, best run, serve and receive win rates, results at 9 or more, and games won" },
  { src: "/showcase/card-serve-landings.jpg", alt: "Serve landings card: where each serve landed on the table, for both players" },
  { src: "/showcase/card-point-length.jpg", alt: "Point length card: rally length in seconds split by whose serve, with the share of those points won" },
  { src: "/showcase/card-serve-speed.jpg", alt: "Serve speed card: serves grouped as slow, medium and fast, with the share of those points won" },
  { src: "/showcase/card-heat-map.jpg", alt: "Heat map card: points won and played from each zone of the table" },
  { src: "/showcase/card-where-ended.jpg", alt: "Where points ended card: the last bounce before each point was scored" },
];

const faqs = [
  {
    q: "What does PongLens do?",
    a: "You film a table tennis match and upload it. PongLens removes the time between points and cuts the match into individual clips. You score the points, and it builds your stats, serve maps and highlights from there. Your coach can watch the match and leave notes on any point.",
  },
  {
    q: "What do I need to record a match?",
    a: "A phone on a tripod, placed diagonally behind you and raised a little, with the whole table in frame. The app shows you where to put it before your first recording.",
  },
  {
    q: "What do I get for free?",
    a: `Enough for ${BETA_ALLOWANCE.matchesWord} matches. Every account gets ${BETA_ALLOWANCE.processingMinutes} processing minutes and ${BETA_ALLOWANCE.storageGb} GB of storage during beta, and a match uses its recording length in minutes. When you run out, you can request more for free.`,
  },
  {
    q: "How long does processing take?",
    a: "About 45 minutes on average, depending on the recording and the queue. The match page shows an estimate, and you get an email when it is ready.",
  },
  {
    q: "Can my coach use it?",
    a: "Yes. Share one match with a link or a QR code, or invite your coach to all of them. Coaches get their own workspace for students, lesson notes and match feedback, and the same account can be both a player and a coach.",
  },
  {
    q: "What happens to my videos? Are they private?",
    a: "Your videos stay private, in storage only your account and the people you share with can reach. Your original upload and cut video stay in your library until you delete the match, and your point clips stay while your account is active. Nothing is sold or shared with advertisers.",
  },
  {
    q: "What can I upload?",
    a: "MP4 or MOV files up to 45 minutes long, from your phone or camera. Trim a longer recording before processing. Televised or professionally produced matches are turned away, because the camera cuts between points.",
  },
  {
    q: "Is there an app?",
    a: "PongLens runs in the browser on any phone or computer. The iPhone app is in beta on TestFlight, and Android is on the roadmap.",
  },
];

const features = [
  "Removes the dead time between points",
  "Cuts the match into one clip per point, with who served and who won",
  "Score the match by tapping who won each point",
  "Call out the score while recording on iPhone",
  "Match analysis: momentum, serve and receive win rates, pressure points",
  "Serve placement maps and heat maps for both players",
  "Rally length and serve speed by whose serve",
  "Automatic highlights video",
  "Export clips and full matches with the score on the picture",
  "Post a rally to Instagram from the iPhone app",
  "Share a match with a link or a QR code",
  "Invite a coach to leave written, spoken or drawn notes on any point",
  "Coach workspace with students, lesson notes and video recaps",
  "Record a lesson on iPhone and get it back as takeaways",
  "A journal you can dictate to, photograph pages into and ask questions of",
  "Stats across every scored match",
];

// Structured data (JSON-LD) so search engines and answer engines can read
// what PongLens is as machine-readable facts, not just prose. The offer,
// feature list and FAQ are the same words the page shows; the video's
// chapters let a result jump to a part of it.
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
        "A performance hub for competitive table tennis. Film a match, upload it, and get every point as a clip with analysis, highlights and a place for you and your coach to work on it.",
      publisher: { "@id": "https://www.ponglens.com/#organization" },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://www.ponglens.com/#app",
      name: "PongLens",
      url: "https://www.ponglens.com",
      applicationCategory: "SportsApplication",
      operatingSystem: "Web, iOS",
      description:
        "A performance hub for competitive table tennis. Upload a match video and PongLens removes the dead time, cuts the match into individual points, builds your match analysis and highlights, and gives you and your coach a place to work on it.",
      featureList: features,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description:
          `Free during beta: ${BETA_ALLOWANCE.processingMinutes} processing minutes and ${BETA_ALLOWANCE.storageGb} GB of storage for every account.`,
      },
      publisher: { "@id": "https://www.ponglens.com/#organization" },
    },
    {
      "@type": "VideoObject",
      "@id": "https://www.ponglens.com/#walkthrough",
      name: "How PongLens works",
      description:
        "A walkthrough of PongLens: upload a table tennis match from your phone, get it back with the dead time between points removed, score it in about ten minutes, and read what the match says about your game.",
      thumbnailUrl: ["https://www.ponglens.com/demo/walkthrough-desktop.jpg"],
      uploadDate: WALKTHROUGH.uploaded,
      duration: WALKTHROUGH.duration,
      contentUrl: "https://www.ponglens.com/demo/walkthrough-desktop.mp4",
      embedUrl: "https://www.ponglens.com/#walkthrough",
      transcript: WALKTHROUGH_TRANSCRIPT,
      isFamilyFriendly: true,
      publisher: { "@id": "https://www.ponglens.com/#organization" },
      hasPart: WALKTHROUGH_CHAPTERS.map((c, i, all) => ({
        "@type": "Clip",
        name: c.label,
        startOffset: c.at,
        endOffset: all[i + 1]?.at ?? WALKTHROUGH.durationSeconds,
        url: `https://www.ponglens.com/#walkthrough&t=${c.at}`,
      })),
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
        {/* HERO: full-bleed animated arena with the copy floating over it,
            as it was. Real screens belong in the sections below, where they
            sit on flat ink; over the arena they read as pasted on. */}
        <section className="relative flex min-h-[calc(100vh-4rem)] items-center overflow-hidden">
          <div className="absolute inset-0 opacity-50 lg:opacity-100">
            <NeonBallHero background />
          </div>
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
          <div
            className="pointer-events-none absolute inset-0 lg:hidden"
            aria-hidden
            style={{
              background:
                "linear-gradient(to top, rgba(10,10,18,.5) 0%, rgba(10,10,18,.1) 30%, rgba(10,10,18,0) 55%)",
            }}
          />
          <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-44 pt-16 text-center sm:pb-24 sm:pt-24 lg:text-left">
            <div className="mx-auto max-w-3xl lg:mx-0">
              <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-6xl lg:text-7xl">
                A performance hub for{" "}
                <span className="text-cyan-glow text-glow">
                  competitive table tennis.
                </span>
              </h1>
              <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-zinc-300 sm:text-xl lg:mx-0">
                Upload a match video. PongLens removes the time between
                points, then gives you every point as a clip to score, review
                and share with your coach.
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4 lg:justify-start">
                <TrackedLink
                  href="/login"
                  event="cta_upload"
                  section="hero"
                  className={`${CTA_CLASS} h-14 sm:text-lg`}
                >
                  Upload your first match
                </TrackedLink>
                <IosBetaSignup placement="hero" />
              </div>
              <p className="mt-5 text-sm text-zinc-400">
                Analyze four matches for free during beta.
              </p>
            </div>
          </div>
        </section>

        {/* THE WALKTHROUGH, second, with chapters. Someone who lands here
            wants to see the thing; the sections after it are the parts. */}
        <section
          id="walkthrough"
          className="relative scroll-mt-20 overflow-hidden py-14 sm:py-24"
        >
          {/* Nothing painted behind this section, on purpose: the video is
              opaque ink, so a wash here would show as a box around it. */}
          <div className="relative mx-auto max-w-[1500px] px-4 sm:px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              See PongLens in action
            </h2>
            <div className="mt-8 sm:mt-12">
              <LandingVideo chapters={WALKTHROUGH_CHAPTERS} posterIdle />
            </div>
            {/* The narration as text, folded away: a crawler and a screen
                reader cannot read pixels, and a <details> ships its
                contents in the HTML either way. */}
            <details className="mx-auto mt-8 max-w-3xl">
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

        {/* FEATURES, one screen each. */}
        <div id="features" className="scroll-mt-20">
          <Feature
            id="just-the-play"
            title="Just the play"
            media={
              <BrowserFrame className="w-full max-w-2xl">
                <Image
                  src="/showcase/anton-points-d.jpg"
                  alt="A processed match in PongLens: the cut video with the running score, and the list of points under it"
                  width={1440}
                  height={876}
                  sizes="(min-width: 1024px) 560px, 100vw"
                  className="block w-full"
                />
              </BrowserFrame>
            }
          >
            A {EXAMPLE.recordingMinutes}-minute recording became {EXAMPLE.points}{" "}
            points and about {EXAMPLE.playMinutesWord} minutes of play. Every
            point is its own clip, with who served and who won, and the dead
            time between them is gone.
          </Feature>

          <Feature
            id="score"
            title="Score the match in ten minutes"
            flip
            media={
              <Phone
                src="/showcase/score-m.jpg"
                alt="Score the Match on a phone: a point plays and you tap who won it"
              />
            }
          >
            Points play one after another and you tap who won. On iPhone you
            can call the score out at the table while you record, and it is
            written down for you.
          </Feature>

          {/* THE DECK, full width: the cards as the app shows them, in a row
              that scrolls sideways on every screen. */}
          <section id="analysis" className="scroll-mt-20 py-14 sm:py-20">
            <div className="mx-auto max-w-6xl px-6">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Match analysis
              </h2>
              <p className="mt-4 max-w-2xl text-lg leading-relaxed text-zinc-400">
                Momentum, serve and receive win rates, what happened at 9-all,
                where serves landed, how long rallies ran and how fast serves
                were. All built from your scoring.
              </p>
            </div>
            <div className="mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-5 lg:px-[max(1.5rem,calc((100vw-72rem)/2+1.5rem))]">
              {cards.map((c) => (
                <div
                  key={c.src}
                  className="w-[82%] shrink-0 snap-center overflow-hidden rounded-2xl border border-edge sm:w-[360px]"
                >
                  <Image
                    src={c.src}
                    alt={c.alt}
                    width={1000}
                    height={962}
                    sizes="(min-width: 640px) 360px, 82vw"
                    className="block w-full"
                  />
                </div>
              ))}
            </div>
          </section>

          <Feature
            id="highlights"
            title="Highlights and export"
            media={
              <Phone
                src="/showcase/anton-highlights-m.jpg"
                alt="A highlights video playing on a phone, with the score in the corner"
              />
            }
          >
            The best rallies are cut into one highlights video. Star a point
            and post it to Instagram, or export the whole match, with the
            running score on the picture.
          </Feature>

          <Feature
            id="coach"
            title="Your coach, on every point"
            flip
            media={
              <Phone
                src="/learn/coach-point-feedback-m.jpg"
                alt="A coach's feedback on one point of a shared match"
              />
            }
            after={
              <TrackedLink
                href="/coaches"
                event="cta_coaches"
                section="coach"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-edge px-5 text-base font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white"
              >
                PongLens for coaches
                <span aria-hidden>→</span>
              </TrackedLink>
            }
          >
            Share a link or a QR code. Your coach watches the points and
            leaves written, spoken or drawn notes, and you get a
            notification.
          </Feature>

          <Feature
            id="journal"
            title="Lessons you can go back to"
            media={
              <div className="flex items-start justify-center gap-4 sm:gap-6">
                <Phone
                  src="/showcase/journal-feed-m.jpg"
                  alt="The journal on a phone: a lesson broken into takeaways beside match notes"
                  className="w-[46%] max-w-[240px]"
                />
                <Phone
                  src="/learn/journal-ask-m.jpg"
                  alt="Asking the journal a question and getting an answer drawn from your own entries"
                  className="mt-10 w-[46%] max-w-[240px]"
                />
              </div>
            }
          >
            Record a lesson on your iPhone and it comes back as takeaways.
            Dictate a note, photograph a handwritten page, and ask your
            journal what your coach said about your backhand.
          </Feature>

          <Feature
            id="iphone"
            title="The iPhone app"
            flip
            media={
              <PhoneFrame className="w-full max-w-xl">
                <Image
                  src="/showcase/ios-record.jpg"
                  alt="Recording a match in the PongLens iPhone app, held sideways, with the table in frame"
                  width={1600}
                  height={736}
                  sizes="(min-width: 1024px) 560px, 100vw"
                  className="block w-full"
                />
              </PhoneFrame>
            }
            after={
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
                <IosBetaSignup placement="hero" />
                <span className="text-sm text-zinc-400">
                  Android is{" "}
                  <Link href="/roadmap" className="underline decoration-zinc-600 underline-offset-4 transition-colors hover:text-white">
                    on the roadmap
                  </Link>
                  .
                </span>
              </div>
            }
          >
            Film in the app with the table lined up on screen, and the upload
            starts while you play. Invites from a coach open straight in the
            app.
          </Feature>
        </div>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 py-16 sm:py-24">
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
            {/* The one place a curious visitor is already reading for
                detail, so the one place the guides get a link on the page. */}
            <p className="mt-8 text-center text-sm text-zinc-400">
              <Link
                href="/learn"
                className="text-zinc-300 underline decoration-zinc-600 underline-offset-4 transition-colors hover:text-white"
              >
                More in the guides
              </Link>
            </p>
          </div>
        </section>

        {/* CLOSE */}
        <section className="border-t border-edge bg-band">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-16 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Try it on your{" "}
              <span className="text-magenta-soft">next match</span>.
            </h2>
            {/* The one place the numbers appear on the page. The hero keeps
                its single sentence; the FAQ has the rest. */}
            <p className="max-w-xl text-zinc-400">
              Free during beta: {BETA_ALLOWANCE.processingMinutes} processing
              minutes and {BETA_ALLOWANCE.storageGb} GB of storage, enough for{" "}
              {BETA_ALLOWANCE.matchesWord} matches.
            </p>
            <TrackedLink
              href="/login"
              event="cta_upload"
              section="close"
              className={CTA_CLASS}
            >
              Upload your first match
            </TrackedLink>

            {/* Where it runs. */}
            <div
              id="ios-beta"
              className="mt-2 flex scroll-mt-24 flex-wrap items-center justify-center gap-3"
            >
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
              <IosBetaSignup placement="platform" />
              <Link
                href="/roadmap"
                className="flex items-center gap-2 rounded-full border border-edge bg-surface/60 px-4 py-2 transition-colors hover:border-zinc-600"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-4 w-4 text-zinc-300"
                >
                  <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24a11.46 11.46 0 0 0-8.94 0L5.65 5.67c-.19-.29-.58-.38-.87-.2-.28.18-.37.54-.22.83L6.4 9.48A10.81 10.81 0 0 0 1 18h22a10.81 10.81 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z" />
                </svg>
                <span className="text-sm font-medium text-zinc-300">Android</span>
                <span className="text-xs text-zinc-500">on the roadmap</span>
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
