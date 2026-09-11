import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { NeonBallHero } from "@/components/anim/NeonBallHero";
import { FindingPoints } from "@/components/anim/coach/FindingPoints";
import { LessonRecap } from "@/components/anim/coach/LessonRecap";
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
  "Manage your table tennis students, share match feedback and turn recorded lessons into coaching notes and video recaps with PongLens.";

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
    shots: ["coach-students", "coach-student-current"],
    title: "Manage your students",
    caption: (
      <>
        Keep each student&apos;s lessons, notes and shared matches together.
        See {glow("what you worked on last time")} before the next session.
      </>
    ),
  },
  {
    shots: ["coach-shared-match", "coach-points"],
    title: "Review shared matches",
    caption: (
      <>
        Review the matches your students share. Connect your feedback to
        {" "}{glow("specific points")} and bring those observations into training.
      </>
    ),
  },
  {
    shots: ["coach-record", "coach-summary-current"],
    title: "Record a lesson",
    caption: (
      <>
        Record the lesson&apos;s audio on iPhone. PongLens prepares
        {" "}{glow("a transcript and coaching notes")} for you to review.
      </>
    ),
  },
  {
    shots: ["coach-summary-current", "coach-entry-shared", "coach-student-current"],
    title: "Share lesson notes",
    caption: (
      <>
        Share your coaching notes and read the reflections your students share.
        Keep both sides of the lesson together to {glow("revisit between sessions")}.
      </>
    ),
  },
  {
    shots: ["coach-recap-current", "coach-recap-chapters-current"],
    title: "Revisit a lesson on video",
    caption: (
      <>
        Turn a recorded lesson into {glow("a recap organised into chapters")}.
        Review it and share the explanations and demonstrations with your student.
      </>
    ),
  },
  {
    shots: ["coach-page", "coach-offering", "coach-order"],
    title: "Offer paid match reviews",
    caption: (
      <>
        Offer professional reviews through your coach profile. Set your price,
        receive requests and {glow("get paid through PongLens")}.
      </>
    ),
  },
];

const features = [
  {
    title: "Your students",
    copy: (
      <>
        Keep each student&apos;s lessons, notes and shared matches together.
        See {glow("what you worked on last time")} before the next session.
      </>
    ),
    anim: <StudentRoster />,
  },
  {
    title: "Shared matches and feedback",
    copy: (
      <>
        Review the matches your students share. Write, draw or leave a voice
        note on {glow("individual points")} to explain what needs work.
      </>
    ),
    anim: <FindingPoints />,
  },
  {
    title: "Lesson recordings and summaries",
    copy: (
      <>
        Record a lesson on your iPhone. PongLens prepares a transcript and
        {" "}{glow("coaching notes")} for you to review and share.
      </>
    ),
    anim: <LessonRecording />,
  },
  {
    title: "A shared coaching journal",
    copy: (
      <>
        Share lesson notes and read the entries your student shares with you.
        Keep {glow("your advice and their reflections")} together between sessions.
      </>
    ),
    anim: <StudentJournal />,
  },
  {
    title: "Lesson video recaps",
    copy: (
      <>
        Upload a lesson video and get {glow("a recap organised into chapters")}.
        Revisit a particular explanation or demonstration without watching the
        whole recording.
      </>
    ),
    anim: <LessonRecap />,
  },
  {
    title: "Paid match reviews",
    copy: (
      <>
        Offer professional match reviews through your coach profile. Set your
        price and manage {glow("requests, feedback and payments")} in PongLens.
      </>
    ),
    anim: <TermsDial />,
  },
];

const faqs = [
  {
    q: "What can I use PongLens for as a coach?",
    a: "Manage your students, review shared matches and keep lesson notes together. Record lessons on iPhone, share summaries and prepare video recaps. You can also offer paid match reviews.",
  },
  {
    q: "Do my students need a PongLens account?",
    a: "Not for you to add them or keep private entries about their lessons. You can send an individual entry as a link, or invite them to connect their account. Once connected, shared entries appear in their journal and the matches they share appear on their student page.",
  },
  {
    q: "What can I see from a student’s account?",
    a: "You can see the matches and lesson entries they choose to share with you. Their other journal entries and account information remain private.",
  },
  {
    q: "How does lesson recording work?",
    a: "Record the lesson’s audio in the iPhone app. PongLens prepares a transcript and coaching notes that you can review, edit and share with your student.",
  },
  {
    q: "Can I upload a lesson video?",
    a: "Yes. Upload a recorded lesson and PongLens prepares a recap organised into chapters. Review it before sharing it with your student.",
  },
  {
    q: "Can I edit an entry after sharing it?",
    a: "Yes. Shared entries are live. Your student sees the updated version in their journal, and you can stop sharing whenever you need to.",
  },
  {
    q: "Does it work on iPhone and the web?",
    a: "Student records, shared notes, matches and video recaps are available on iPhone and the web. Audio lesson recording is on iPhone. Paid review orders are managed on the web.",
    link: { href: "/#ios-beta", label: "Join the iPhone beta" },
  },
  {
    q: "What does it cost?",
    a: "Managing students, sharing lesson entries and reviewing shared matches is free. Video storage and processing use your account’s allowances. A platform fee applies to paid match reviews.",
  },
  {
    q: "Can I offer paid match reviews?",
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
      name: "PongLens for table tennis coaches",
      serviceType: "Table tennis coaching",
      provider: { "@id": "https://www.ponglens.com/#organization" },
      audience: { "@type": "Audience", audienceType: "Table tennis coaches" },
      areaServed: "Worldwide",
      description:
        "Manage students, share match feedback and lesson notes, and prepare lesson summaries and video recaps. Coaches can also offer paid match reviews.",
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
                  A coaching hub for{" "}
                  <span className="text-cyan-glow text-glow">table tennis</span>, built
                  around every student.
                </h1>
                <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-zinc-300 sm:text-xl lg:mx-0">
                  Keep each student&apos;s matches, lesson notes and recordings
                  together. Share feedback, prepare lesson summaries and give
                  students video recaps they can revisit between sessions.
                </p>
                <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row sm:flex-wrap lg:justify-start">
                  <Link
                    href="/coaching/start"
                    className="glow-cta inline-flex min-h-11 w-full items-center justify-center rounded-full bg-cyan-glow px-8 py-3.5 text-base font-semibold text-ink sm:w-auto sm:text-lg"
                  >
                    Start coaching
                  </Link>
                  <Link
                    href="#how"
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-edge px-5 py-3.5 text-base font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white sm:w-auto sm:text-lg"
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
                      src="/showcase/coach-student-current-t.jpg"
                      alt="A student's lesson notes, shared matches and video recaps in PongLens"
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
              Coaching on PongLens
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
                    {faq.link && (
                      <Link href={faq.link.href} className="mt-4 flex min-h-11 w-full items-center justify-center rounded-full border border-edge px-5 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white sm:w-fit">
                        {faq.link.label}
                      </Link>
                    )}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-band border-y border-edge">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-16 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Bring your students and{" "}
              <span className="text-magenta-soft">lessons together</span>.
            </h2>
            <Link
              href="/coaching/start"
              className="glow-cta inline-flex min-h-11 w-full items-center justify-center rounded-full bg-cyan-glow px-8 py-3 text-base font-semibold text-ink sm:w-auto"
            >
              Start coaching
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter audience="coaches" />
    </>
  );
}
