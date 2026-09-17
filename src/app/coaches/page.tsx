import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { NeonBallHero } from "@/components/anim/NeonBallHero";
import { BrowserFrame } from "@/components/marketing/BrowserFrame";
import { CTA_CLASS, Feature, Phone } from "@/components/marketing/Feature";
import { IosBetaSignup } from "@/components/marketing/IosBetaSignup";
import { LandingVideo } from "@/components/marketing/LandingVideo";
import { TrackedLink } from "@/components/marketing/TrackedLink";
import { COACH_TRANSCRIPT, COACH_WALKTHROUGH } from "@/lib/coachWalkthrough";
import { COACH_CHAPTERS, COACH_CUTS } from "@/lib/videoCuts";
import { COACH_LENGTH } from "@/lib/videos";

/**
 * The coaches page, built the same way as the player page and in the same
 * order: what it is, the walkthrough with chapters, one real screen per
 * feature, the questions, the close.
 *
 * Every picture is the product. The screens come from the staged demo
 * coach (scripts/demos/shots.mjs), so the students, entries and orders on
 * them are the demo account's, and nothing here is a drawing of a feature.
 */

const description =
  "Manage your table tennis students, share match feedback and turn recorded lessons into coaching notes and video recaps with PongLens.";

export const metadata: Metadata = {
  title: "PongLens for coaches",
  description,
  alternates: { canonical: "/coaches" },
  // No images here: the page's opengraph-image.tsx draws its own card, and
  // an explicit list in this object silently wins over that file. It did,
  // and a shared link to this page previewed with the generic site card.
  openGraph: {
    type: "website",
    url: "https://www.ponglens.com/coaches",
    siteName: "PongLens",
    title: "PongLens for coaches",
    description,
  },
  twitter: {
    card: "summary_large_image",
    title: "PongLens for coaches",
    description,
  },
};

const faqs = [
  {
    q: "What can I use PongLens for as a coach?",
    a: "Keep your students, their lesson notes and the matches they share with you in one place. Leave feedback on the points of a match, record a lesson on iPhone and share the notes, prepare video recaps, and offer paid match reviews from your own page.",
  },
  {
    q: "Do my students need a PongLens account?",
    a: "Not for you to add them and keep notes about their lessons. You can send any entry as a link. When a student connects their account, the entries you share appear in their journal and the matches they share appear on their student page.",
  },
  {
    q: "What can I see from a student’s account?",
    a: "The matches and journal entries they choose to share with you. Their other entries and their account details stay private.",
  },
  {
    q: "How does lesson recording work?",
    a: "Record the lesson’s audio in the iPhone app. PongLens turns it into a transcript and a set of coaching notes, which you check, edit and share with your student.",
  },
  {
    q: "Can I upload a lesson video?",
    a: "Yes. Upload a recorded lesson and PongLens prepares a recap split into chapters. You review it before you share it.",
  },
  {
    q: "Can I edit an entry after sharing it?",
    a: "Yes. A shared entry is live, so your student sees the updated version in their journal. You can stop sharing it at any time.",
  },
  {
    q: "Does it work on iPhone and the web?",
    a: "Students, shared notes, matches and video recaps work on iPhone and the web. Recording a lesson is on iPhone. Paid review orders are managed on the web.",
    link: { href: "#ios-beta", label: "Get the iPhone beta" },
  },
  {
    q: "What does it cost?",
    a: "Nothing during beta. Students, lesson notes and match feedback are free, and lesson recordings and video recaps use the same free processing and storage allowance as every account. A platform fee applies to paid match reviews.",
  },
  {
    q: "How do paid match reviews work?",
    a: "You set the price, what the review covers and how many days you need. A player sends a match and their questions, and nothing starts until you accept. You deliver the review through PongLens and are paid through Stripe.",
  },
  {
    q: "Can my students see each other?",
    a: "No. Each student sees only what you share with them. Their matches, entries and account details are not visible to your other students.",
  },
];

// Structured data (JSON-LD): the same facts the page shows, as facts a
// search engine or an answer engine can read without parsing prose. The
// video's chapters let a result jump to "Lesson recording" rather than
// 0:00, and the transcript gives the video words.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": "https://www.ponglens.com/coaches#page",
      url: "https://www.ponglens.com/coaches",
      name: "PongLens for coaches",
      description,
      isPartOf: { "@id": "https://www.ponglens.com/#website" },
      about: { "@id": "https://www.ponglens.com/coaches#service" },
    },
    {
      "@type": "Service",
      "@id": "https://www.ponglens.com/coaches#service",
      name: "PongLens for table tennis coaches",
      serviceType: "Table tennis coaching workspace",
      provider: { "@id": "https://www.ponglens.com/#organization" },
      audience: { "@type": "Audience", audienceType: "Table tennis coaches" },
      areaServed: "Worldwide",
      description:
        "A coaching workspace for table tennis: a page per student with lesson notes and shared matches, feedback on individual points, lesson recording on iPhone with notes prepared for the coach, lesson video recaps split into chapters, and paid match reviews with payment handled by PongLens.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description:
          "Free for coaches during beta. A platform fee applies to paid match reviews.",
      },
    },
    {
      "@type": "VideoObject",
      "@id": "https://www.ponglens.com/coaches#walkthrough",
      name: "How coaching works on PongLens",
      description:
        "A walkthrough of the PongLens coaching workspace: a coach profile, a page per student, lesson recording, shared journals, review orders, delivery and payouts.",
      thumbnailUrl: ["https://www.ponglens.com/demo/coach-desktop.jpg"],
      contentUrl: "https://www.ponglens.com/demo/coach-desktop.mp4",
      embedUrl: "https://www.ponglens.com/coaches#walkthrough",
      duration: COACH_WALKTHROUGH.duration,
      uploadDate: COACH_WALKTHROUGH.uploaded,
      transcript: COACH_TRANSCRIPT,
      isFamilyFriendly: true,
      publisher: { "@id": "https://www.ponglens.com/#organization" },
      inLanguage: "en",
      hasPart: COACH_CHAPTERS.map((c, i, all) => ({
        "@type": "Clip",
        name: c.label,
        startOffset: c.at,
        endOffset: all[i + 1]?.at ?? COACH_WALKTHROUGH.durationSeconds,
        url: `https://www.ponglens.com/coaches#walkthrough&t=${c.at}`,
      })),
    },
    {
      "@type": "FAQPage",
      "@id": "https://www.ponglens.com/coaches#faq",
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.q,
        acceptedAnswer: { "@type": "Answer", text: faq.a },
      })),
    },
  ],
};

export default function CoachesPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteHeader audience="coaches" />
      <main className="flex-1">
        {/* HERO: the same full-bleed arena as the player page, with the
            copy floating over it. Real screens belong in the sections
            below, on flat ink; over the arena they read as pasted on. */}
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
                PongLens for table tennis coaches, built around{" "}
                <span className="text-cyan-glow text-glow">every student.</span>
              </h1>
              <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-zinc-300 sm:text-xl lg:mx-0">
                Keep each student&apos;s lessons, notes and matches in one
                place. Leave feedback on the points that matter, share lesson
                notes they can go back to, and offer paid match reviews from
                your own page.
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4 lg:justify-start">
                <TrackedLink
                  href="/coaching/start"
                  event="cta_coaching"
                  section="hero"
                  className={`${CTA_CLASS} h-14 sm:text-lg`}
                >
                  Start coaching
                </TrackedLink>
                <Link
                  href="#walkthrough"
                  className="inline-flex h-14 w-full max-w-80 items-center justify-center rounded-full border border-edge px-6 text-base font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white sm:w-auto sm:max-w-none sm:text-lg"
                >
                  See it in action ↓
                </Link>
              </div>
              <p className="mt-5 text-sm text-zinc-400">
                Free for coaches during beta.
              </p>
            </div>
          </div>
        </section>

        {/* THE WALKTHROUGH, second, with chapters, like the player page. */}
        <section
          id="walkthrough"
          className="relative scroll-mt-20 overflow-hidden py-14 sm:py-24"
        >
          <div className="relative mx-auto max-w-[1500px] px-4 sm:px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              See coaching on PongLens
            </h2>
            <div className="mt-8 sm:mt-12">
              <LandingVideo
                cuts={COACH_CUTS}
                length={COACH_LENGTH}
                chapters={COACH_CHAPTERS}
                posterIdle
              />
            </div>
            <details className="mx-auto mt-8 max-w-3xl">
              <summary className="cursor-pointer list-none text-center text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200">
                Read it instead
              </summary>
              <div className="mt-5 space-y-3 text-[15px] leading-relaxed text-zinc-400">
                {COACH_WALKTHROUGH.lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </details>
          </div>
        </section>

        {/* FEATURES, one screen each, in the order a coach meets them. */}
        <div id="features" className="scroll-mt-20">
          <Feature
            id="students"
            title="Your students"
            media={
              <BrowserFrame className="w-full max-w-2xl">
                <Image
                  src="/showcase/coach-student-current-t.jpg"
                  alt="A student's page in PongLens: the lesson notes shared with them, their own journal entry, a shared match and a lesson video"
                  width={1180}
                  height={820}
                  sizes="(min-width: 1024px) 560px, 100vw"
                  className="block w-full"
                />
              </BrowserFrame>
            }
          >
            Every student has a page with the notes you shared, the entries
            they shared back, the matches they sent you and their lesson
            videos. Open it before a session and you can see what you worked
            on last time.
          </Feature>

          <Feature
            id="feedback"
            title="Feedback on their matches"
            flip
            media={
              <Phone
                src="/showcase/coach-points-m.jpg"
                alt="A student's match on a phone: the point playing, and the coach's notes attached to points 16, 44 and 53"
              />
            }
          >
            A student shares a match and you watch it point by point. Write a
            note, draw on the frame or leave a voice note on the exact point,
            and it shows up in their match with a link back to the rally.
          </Feature>

          <Feature
            id="record"
            title="Record a lesson"
            media={
              <div className="flex items-start justify-center gap-4 sm:gap-6">
                <Phone
                  src="/showcase/coach-record-m.jpg"
                  alt="Recording a lesson in the PongLens iPhone app"
                  className="w-[46%] max-w-[240px]"
                />
                <Phone
                  src="/showcase/coach-summary-current-m.jpg"
                  alt="The lesson back as notes: what was worked on and what comes next, with the transcript underneath"
                  className="mt-10 w-[46%] max-w-[240px]"
                />
              </div>
            }
            after={<IosBetaSignup placement="hero" />}
          >
            Put your iPhone near the table and record the lesson. It comes
            back as a transcript and a set of notes, split into what you
            worked on and what comes next, for you to check and share.
          </Feature>

          <Feature
            id="journal"
            title="Notes they can go back to"
            flip
            media={
              <Phone
                src="/showcase/coach-entry-shared-m.jpg"
                alt="A lesson entry shared with a student, with the option to stop sharing, edit it or copy a link"
              />
            }
          >
            Share an entry and it appears in your student&apos;s journal.
            Edit it later and they see the new version. What they write about
            the lesson comes back to you on their page, so both sides stay
            together.
          </Feature>

          <Feature
            id="recaps"
            title="Lesson recaps on video"
            media={
              <Phone
                src="/showcase/coach-recap-current-m.jpg"
                alt="A lesson video recap on a phone, four minutes long and split into three chapters"
              />
            }
          >
            Upload a recorded lesson and it comes back as a short recap split
            into chapters. A student can go straight to the explanation or
            the demonstration they need instead of scrubbing through the
            whole recording.
          </Feature>

          <Feature
            id="reviews"
            title="Paid match reviews"
            flip
            media={
              <BrowserFrame className="w-full max-w-2xl">
                <Image
                  src="/showcase/coach-page-d.jpg"
                  alt="A coach's public page in PongLens: their experience, a quote from a player, and a full match review offered for fifty dollars"
                  width={1440}
                  height={900}
                  sizes="(min-width: 1024px) 560px, 100vw"
                  className="block w-full"
                />
              </BrowserFrame>
            }
          >
            Set up a page with your experience and what a review covers, and
            choose your price. A player sends a match and their questions,
            you accept the order, review the points and deliver it through
            PongLens. Payment and payouts are handled for you.
          </Feature>
        </div>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 py-16 sm:py-24">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              Questions
            </h2>
            <div className="mt-12 divide-y divide-edge border-y border-edge">
              {faqs.map((faq) => (
                <details key={faq.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-lg font-medium text-zinc-100 transition-colors hover:text-white">
                    {faq.q}
                    <span
                      aria-hidden
                      className="shrink-0 text-cyan-glow transition-transform duration-200 group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 max-w-2xl leading-relaxed text-zinc-400">
                    {faq.a}
                  </p>
                  {faq.link && (
                    <Link
                      href={faq.link.href}
                      className="mt-4 flex min-h-11 w-full items-center justify-center rounded-full border border-edge px-5 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white sm:w-fit"
                    >
                      {faq.link.label}
                    </Link>
                  )}
                </details>
              ))}
            </div>
            <p className="mt-8 text-center text-sm text-zinc-400">
              <Link
                href="/learn?audience=coach"
                className="text-zinc-300 underline decoration-zinc-600 underline-offset-4 transition-colors hover:text-white"
              >
                More in the coaching guides
              </Link>
            </p>
          </div>
        </section>

        {/* CLOSE */}
        <section className="border-t border-edge bg-band">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-16 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Bring your students and{" "}
              <span className="text-magenta-soft">lessons together</span>.
            </h2>
            <p className="max-w-xl text-zinc-400">
              Free for coaches during beta.
            </p>
            <TrackedLink
              href="/coaching/start"
              event="cta_coaching"
              section="close"
              className={CTA_CLASS}
            >
              Start coaching
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
      <SiteFooter audience="coaches" />
    </>
  );
}
