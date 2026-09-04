import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { NeonBallHero } from "@/components/anim/NeonBallHero";
import { FindingPoints } from "@/components/anim/coach/FindingPoints";
import { JournalShare } from "@/components/anim/coach/JournalShare";
import { LessonRecording } from "@/components/anim/coach/LessonRecording";
import { StudentJournal } from "@/components/anim/coach/StudentJournal";
import { StudentRoster } from "@/components/anim/coach/StudentRoster";
import { TermsDial } from "@/components/anim/coach/TermsDial";
import { LandingVideo } from "@/components/marketing/LandingVideo";
import { PhoneFrame } from "@/components/marketing/PhoneFrame";
import {
  WalkthroughBand,
  type Chapter,
} from "@/components/marketing/WalkthroughBand";
import { COACH_CUTS } from "@/lib/videoCuts";
import { COACH_LENGTH } from "@/lib/videos";

const description =
  "A complete coaching workspace for table tennis coaches. Build your profile, manage students, share lessons, review matches and run paid reviews.";

export const metadata: Metadata = {
  title: "PongLens for coaches",
  description,
  alternates: { canonical: "/coaches" },
  openGraph: {
    type: "website",
    url: "https://www.ponglens.com/coaches",
    siteName: "PongLens",
    title: "PongLens for coaches",
    description,
    images: [
      {
        url: "/img/og.jpg",
        width: 1200,
        height: 630,
        alt: "PongLens. A performance hub for competitive table tennis.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PongLens for coaches",
    description,
    images: ["/img/og.jpg"],
  },
};

const glow = (text: string) => (
  <span className="text-cyan-glow" key={text}>
    {text}
  </span>
);

const chapters: Chapter[] = [
  {
    shots: ["coach-page"],
    title: "Build your coaching presence",
    caption: (
      <>
        Present your experience, coaching approach and review offerings on
        {" "}{glow("one coach profile")} you can share with players.
      </>
    ),
  },
  {
    shots: ["coach-students", "coach-shared-match"],
    title: "Keep every student in context",
    caption: (
      <>
        Keep each student&apos;s lessons, journal entries, shared materials and
        matches together, so the {glow("full coaching relationship")} stays
        visible.
      </>
    ),
  },
  {
    shots: ["coach-record", "coach-entry-compose"],
    title: "Capture every lesson",
    caption: (
      <>
        Record the session as audio or video, write lesson notes and preserve
        the details students need {glow("after training")}.
      </>
    ),
  },
  {
    shots: ["coach-entry-shared"],
    title: "Share progress between sessions",
    caption: (
      <>
        Give students access to their coaching journal, so feedback, goals and
        lesson history remain {glow("useful over time")}.
      </>
    ),
  },
  {
    shots: ["coach-order", "coach-queue"],
    title: "Receive and manage review orders",
    caption: (
      <>
        Receive a player&apos;s match and questions together, choose which reviews
        to accept and keep {glow("every active order")} visible.
      </>
    ),
  },
  {
    shots: ["coach-review", "coach-payout"],
    title: "Deliver detailed reviews and get paid",
    caption: (
      <>
        Connect feedback to the relevant points, share the completed review
        with the player and receive {glow("payouts through PongLens")}.
      </>
    ),
  },
];

const features = [
  {
    title: "One place for every student",
    copy: (
      <>
        Each student has a complete coaching record, with their lessons,
        recordings, shared materials and {glow("matches kept together")}.
      </>
    ),
    anim: <StudentRoster />,
  },
  {
    title: "A shared coaching journal",
    copy: (
      <>
        Build a lasting record of what you worked on, what changed and what
        comes next. Share the entries each student needs
        {" "}{glow("between sessions")}.
      </>
    ),
    anim: <StudentJournal />,
  },
  {
    title: "Lesson recording",
    copy: (
      <>
        Capture a full lesson as audio, with video recording coming soon.
        PongLens prepares the transcript and {glow("structured notes")} for
        you to review.
      </>
    ),
    anim: <LessonRecording />,
  },
  {
    title: "Shared with students",
    copy: (
      <>
        Share the lesson entries each student needs, so your coaching stays
        with them {glow("when the session ends")}.
      </>
    ),
    anim: <JournalShare />,
  },
  {
    title: "Match feedback in context",
    copy: (
      <>
        Open a student&apos;s matches beside their lesson history. Write, draw
        or leave a voice note on the points that
        {" "}{glow("show exactly what you mean")}.
      </>
    ),
    anim: <FindingPoints />,
  },
  {
    title: "Paid reviews, built in",
    copy: (
      <>
        Offer structured remote match reviews with your own scope, price and
        turnaround. PongLens {glow("handles the order, payment and delivery")}.
      </>
    ),
    anim: <TermsDial />,
  },
];

const faqs = [
  {
    q: "What can I use PongLens for as a coach?",
    a: "PongLens brings your whole coaching practice together. Build a coach profile, manage students, keep and share lesson journals, record sessions, review matches, and receive paid review orders from the same workspace.",
  },
  {
    q: "Do my students need a PongLens account?",
    a: "Not for you to add them or keep private entries about their lessons. You can send an individual entry as a link, or invite them to connect their account. Once connected, shared entries appear in their journal and the matches they share appear on their student page.",
  },
  {
    q: "What can I see from a student’s account?",
    a: "Only the matches they give you access to. When they join, they choose whether to share every match or share them one at a time. You cannot see the rest of their account or their private journal.",
  },
  {
    q: "How does lesson recording work?",
    a: "On iPhone, put your phone near the table and record the lesson. PongLens turns the recording into an editable transcript and prepares the main points for you to review. Video lesson recording is coming soon.",
  },
  {
    q: "Can I edit an entry after sharing it?",
    a: "Yes. Shared entries are live. Your student sees the updated version in their journal, and you can stop sharing whenever you need to.",
  },
  {
    q: "Does the coach workspace work on both iPhone and the web?",
    a: "Student management, lesson entries and shared matches are available on iPhone and the web. Long lesson recording is currently on iPhone. Paid review orders are managed on the web.",
  },
  {
    q: "What does it cost?",
    a: "Managing students, sharing lesson entries and reviewing shared matches is free. If you sell a paid match review, a small platform fee comes off the order. Card processing is included.",
  },
  {
    q: "Can I still offer paid match reviews?",
    a: "Yes. You choose the price, what the review covers and how many days you need. The student sends a match and their questions, and nothing starts until you accept.",
  },
  {
    q: "Can my students see each other?",
    a: "No. Each student sees only the entries you share with them. Their matches, lesson entries and account details are not visible to your other students.",
  },
];

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
      name: "Coaching workspace for table tennis coaches",
      serviceType: "Table tennis coaching workspace",
      provider: { "@id": "https://www.ponglens.com/#organization" },
      audience: { "@type": "Audience", audienceType: "Table tennis coaches" },
      areaServed: "Worldwide",
      description:
        "A complete coaching workspace bringing coach profiles, students, lesson journals, recordings, shared notes, review orders, match feedback and payouts together.",
    },
    {
      "@type": "VideoObject",
      "@id": "https://www.ponglens.com/coaches#video",
      name: "How coaching works on PongLens",
      description:
        "A feature-led look at the PongLens coaching workspace, including a coach profile, student management, lesson recording, shared journals, review orders, delivery and payouts.",
      thumbnailUrl: ["https://www.ponglens.com/demo/coach-desktop.jpg"],
      contentUrl: "https://www.ponglens.com/demo/coach-desktop.mp4",
      embedUrl: "https://www.ponglens.com/coaches#video",
      duration: "PT1M16S",
      uploadDate: "2026-09-04",
      isFamilyFriendly: true,
      publisher: { "@id": "https://www.ponglens.com/#organization" },
      inLanguage: "en",
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
          <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-24 pt-16 text-center sm:pt-24 lg:text-left">
            <div className="xl:flex xl:items-center xl:gap-16">
              <div className="mx-auto max-w-3xl lg:mx-0 xl:flex-1">
                <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-6xl lg:text-7xl">
                  A coaching hub built around{" "}
                  <span className="text-cyan-glow text-glow">every student.</span>
                </h1>
                <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-zinc-300 sm:text-xl lg:mx-0">
                  Keep lesson journals, recordings, shared notes and match
                  feedback together. Your students can carry your coaching into
                  practice, and you can return to every session with the full
                  picture.
                </p>
                <div className="mt-10 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
                  <Link
                    href="/coaching/start"
                    className="glow-cta rounded-full bg-cyan-glow px-8 py-3.5 text-base font-semibold text-ink sm:text-lg"
                  >
                    Create your coaching workspace
                  </Link>
                  <Link
                    href="#how"
                    className="rounded-full px-5 py-3.5 text-base font-medium text-zinc-300 transition-colors hover:text-white sm:text-lg"
                  >
                    See it in action ↓
                  </Link>
                </div>
              </div>
              <div
                className="relative hidden shrink-0 xl:block"
                style={{ width: 430, height: 615 }}
              >
                <div
                  className="absolute z-10"
                  style={{ width: 236, right: -76, top: 104 }}
                >
                  <PhoneFrame glow={false}>
                    <Image
                      src="/showcase/coach-students-m.jpg"
                      alt="A coach's student list in PongLens"
                      width={390}
                      height={844}
                      className="block w-full"
                    />
                  </PhoneFrame>
                </div>
                <div className="relative z-0">
                  <PhoneFrame device="tablet">
                    <Image
                      src="/showcase/coach-student-t.jpg"
                      alt="A student's lesson journal and shared matches in the coach workspace"
                      width={1180}
                      height={820}
                      priority
                      className="block w-full"
                    />
                  </PhoneFrame>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              Everything around the student
            </h2>
            <div className="-mx-6 mt-14 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:grid md:grid-cols-3 md:gap-8 md:overflow-visible md:p-0">
              {features.map((feature) => (
                <article
                  key={feature.title}
                  className="group w-[80%] shrink-0 snap-center overflow-hidden rounded-2xl border border-edge bg-surface transition-colors hover:border-cyan-glow/40 md:w-auto md:shrink"
                >
                  <div className="relative aspect-[3/2] overflow-hidden">
                    {feature.anim}
                  </div>
                  <div className="p-6">
                    <h3 className="text-lg font-semibold">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                      {feature.copy}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          id="how"
          className="relative scroll-mt-20 overflow-hidden py-14 sm:py-28"
        >
          <div className="relative mx-auto max-w-[1500px] px-4 sm:px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              See coaching on PongLens
            </h2>
            <div className="mt-8 sm:mt-12">
              <LandingVideo cuts={COACH_CUTS} length={COACH_LENGTH} />
            </div>
          </div>
        </section>

        <section id="steps" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              A complete coaching workspace
            </h2>
            <div className="mt-14">
              <WalkthroughBand chapters={chapters} subMs={7000} />
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-20 py-20 sm:py-28">
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
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-band border-y border-edge">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-16 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Bring your coaching{" "}
              <span className="text-magenta-soft">into one place</span>.
            </h2>
            <p className="max-w-xl text-zinc-400">
              Keep every student, lesson and match connected in PongLens.
            </p>
            <Link
              href="/coaching/start"
              className="glow-cta rounded-full bg-cyan-glow px-8 py-3 text-base font-semibold text-ink"
            >
              Create your coaching workspace
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter audience="coaches" />
    </>
  );
}
