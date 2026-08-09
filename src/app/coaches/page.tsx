import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { NeonBallHero } from "@/components/anim/NeonBallHero";
import { AttachFile } from "@/components/anim/coach/AttachFile";
import { DictateWave } from "@/components/anim/coach/DictateWave";
import { FindingPoints } from "@/components/anim/coach/FindingPoints";
import { PayoutRail } from "@/components/anim/coach/PayoutRail";
import { TemplateStack } from "@/components/anim/coach/TemplateStack";
import { TermsDial } from "@/components/anim/coach/TermsDial";
import {
  COACH_CUTS,
  LandingVideo,
} from "@/components/marketing/LandingVideo";
import { PhoneFrame } from "@/components/marketing/PhoneFrame";
import {
  WalkthroughBand,
  type Chapter,
} from "@/components/marketing/WalkthroughBand";

export const metadata: Metadata = {
  title: "PongLens for coaches",
  description:
    "Offer paid match reviews on footage that is already cut into points. You set the price, the scope and the turnaround.",
  alternates: { canonical: "/coaches" },
  openGraph: {
    type: "website",
    url: "https://www.ponglens.com/coaches",
    siteName: "PongLens",
    title: "PongLens for coaches",
    description:
      "Offer paid match reviews on footage that is already cut into points. You set the price, the scope and the turnaround.",
    images: [
      {
        url: "/img/og.jpg",
        width: 1200,
        height: 630,
        alt: "PongLens. Match analysis for table tennis players.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PongLens for coaches",
    description:
      "Offer paid match reviews on footage that is already cut into points. You set the price, the scope and the turnaround.",
    images: ["/img/og.jpg"],
  },
};

/**
 * The coach-facing landing page. Built to the home page's measurements on
 * purpose: same max-w-6xl column, same section rhythm, same type scale,
 * same accordion and closing band. The screenshots are real captures of
 * the coach side of the product (scripts/demos/shots.mjs, `coach-*`).
 */

const glow = (text: string) => (
  <span className="text-cyan-glow" key={text}>
    {text}
  </span>
);

// The walkthrough band, in the order a coach actually meets the product:
// set it up, get an order, do the work, get paid.
//
// Plain words on purpose. A lot of table tennis coaches read English as a
// second language, and the first draft of these captions was built out of
// idiom: "starts the clock", "whose move it is", "watch the words land".
// Every one of those is a sentence you have to already know English to
// parse. Short sentences, ordinary verbs, and say the thing itself.
// Titles are what the coach DOES at that step, in the plainest words the
// step allows. "The points" and "What they get" were shorter and told a
// coach who has never seen the product nothing at all.
const chapters: Chapter[] = [
  {
    shots: ["coach-offering"],
    title: "Decide what you offer",
    caption: (
      <>
        You decide what a review includes,{" "}
        {glow("what it costs, and how many days you need")}. Start from a
        serve review, a receive review or a full match review, and change any
        part of it.
      </>
    ),
  },
  {
    shots: ["coach-page"],
    title: "Build your page",
    caption: (
      <>
        Your reviews sit on one page at {glow("ponglens.com/coach/yourname")},
        along with your background and what past students said about you.
        Send that link to your students, or put it on your club page and your
        social media.
      </>
    ),
  },
  {
    shots: ["coach-setup"],
    title: "Set up your payouts",
    caption: (
      <>
        PongLens pays coaches through Stripe, so{" "}
        {glow("you connect a Stripe account once")}. Stripe confirms who you
        are and takes your bank details. You do not have to touch it again
        after that.
      </>
    ),
  },
  {
    shots: ["coach-order"],
    title: "Receive a new order",
    caption: (
      <>
        A student buys one of your reviews, picks one of their matches, and
        answers your questions. You read their answers before you decide,
        then {glow("accept or decline")}. Nothing starts until you accept.
      </>
    ),
  },
  {
    shots: ["coach-points"],
    title: "Review the match",
    caption: (
      <>
        The match reaches you {glow("already split into single points")}, so
        you never scroll a video looking for a rally. Watch the points you
        care about, and attach the ones your student should watch too.
      </>
    ),
  },
  {
    shots: ["coach-writeup"],
    title: "Prepare the write-up",
    caption: (
      <>
        Type your review, or {glow("speak it and your words become text")}.
        The sections come from the template you picked, and your draft saves
        while you work.
      </>
    ),
  },
  {
    shots: ["coach-review"],
    title: "Send the finished review",
    caption: (
      <>
        Your student gets what you wrote,{" "}
        {glow("a clip for every point you picked")}, and any files you
        attached. It stays in their account, and they can ask you a follow-up
        question after watching it.
      </>
    ),
  },
  {
    shots: ["coach-hub", "coach-queue"],
    title: "Get paid",
    caption: (
      <>
        When your student marks the review done, or a week passes,{" "}
        {glow("Stripe sends your share to your bank")}. Your orders list
        always shows which ones are waiting on you and which are waiting on
        them.
      </>
    ),
  },
];

const features = [
  {
    title: "You set the terms",
    copy: "You choose the price, what the review covers, and how many days you need. When you are busy, pause new orders or limit how many you take at once.",
    anim: <TermsDial />,
  },
  {
    title: "Linked to the real points",
    copy: "Anything you write can point at the rallies that show it. Your student taps a point and watches what you mean.",
    anim: <FindingPoints />,
  },
  {
    title: "Speak or draw it",
    copy: "Speak instead of typing and your words become text, with the recording kept next to them. You can also draw on any frame of the video.",
    anim: <DictateWave />,
  },
  {
    title: "Templates to start from",
    copy: "A serve review, a receive review, a full match review. Pick one, change every word, or start from a blank page.",
    anim: <TemplateStack />,
  },
  {
    title: "Bring your materials",
    copy: "Attach a practice plan, a drill sheet, or anything else you prepare, up to 50 MB per file.",
    anim: <AttachFile />,
  },
  {
    title: "Stripe handles the money",
    copy: "Checkout, cards, Apple Pay, and payouts to your bank. Students pay you, and PongLens keeps a small platform fee.",
    anim: <PayoutRail />,
  },
];

const faqs = [
  {
    q: "What does it cost?",
    a: "Nothing up front. A small platform fee comes off each order, shown before you publish. Card processing is included in it.",
  },
  {
    q: "What do I need before I can take my first order?",
    a: "Three things, and the app lists them for you: one review to sell, a Stripe account so the money can reach you, and your page published. Stripe asks for your ID and your bank account, the same way it does for anyone taking payments online.",
  },
  {
    q: "Do my students need PongLens already?",
    a: "No. Buying a review brings them in. They upload their match and PongLens cuts it into points for you.",
  },
  {
    q: "When do I get paid?",
    a: "When the order completes: your student marks it done, or it closes on its own a week after delivery. Stripe then pays out to your bank.",
  },
  {
    q: "How long does a review actually take?",
    a: "Around an hour for a full match. You do not have to search the video for anything: the dead time is already cut out, every point is a separate clip, and the score is shown on screen.",
  },
  {
    q: "What if I do not want an order?",
    a: "Decline it with a short note and your student gets a full refund. Nothing starts until you accept, so you are never committed by someone else buying.",
  },
  {
    q: "Do I have to use a template?",
    a: "No. The templates are starting points and every word in them is yours to change. You can also start from a blank page and write your own sections.",
  },
  {
    q: "Can my students see each other?",
    a: "No. An order is between the two of you. Their match, their brief and your review stay private to that order unless they agree to let you show it as a sample on your page.",
  },
  {
    q: "What about the free sharing my students use now?",
    a: "It stays free. Watching shared matches and leaving notes never costs anything. Paid reviews are for the structured work with a defined scope and a finish line.",
  },
];

// Machine-readable facts about the coach side, the way the home page does
// it for the product as a whole.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": "https://www.ponglens.com/coaches#page",
      url: "https://www.ponglens.com/coaches",
      name: "PongLens for coaches",
      description:
        "Table tennis coaches offer paid match reviews on PongLens. The footage arrives cut into points, findings link to the rallies that show them, and Stripe handles checkout and payouts.",
      isPartOf: { "@id": "https://www.ponglens.com/#website" },
      about: { "@id": "https://www.ponglens.com/coaches#service" },
    },
    {
      "@type": "Service",
      "@id": "https://www.ponglens.com/coaches#service",
      name: "Paid match reviews for table tennis coaches",
      serviceType: "Online coaching marketplace",
      provider: { "@id": "https://www.ponglens.com/#organization" },
      audience: {
        "@type": "Audience",
        audienceType: "Table tennis coaches",
      },
      areaServed: "Worldwide",
      description:
        "Coaches publish a page of review offerings with their own price, scope and turnaround. Students buy a review and send a match, which reaches the coach already cut into individual points.",
    },
    {
      // Declared so the walkthrough can be indexed as a video rather than
      // as an opaque <video> tag: Google will not read duration, thumbnail
      // or subject off the element, and an answer engine has nothing to
      // quote without them. contentUrl is the file itself, which is what
      // makes it eligible for a video result at all.
      "@type": "VideoObject",
      "@id": "https://www.ponglens.com/coaches#video",
      name: "How coaching works on PongLens",
      description:
        "A walkthrough of the coach side of PongLens: setting what you offer, your page, connecting Stripe, accepting an order, reviewing a match point by point, building patterns from the points they happened on, the write-up tools, and getting paid.",
      thumbnailUrl: ["https://www.ponglens.com/demo/coach-desktop.jpg"],
      contentUrl: "https://www.ponglens.com/demo/coach-desktop.mp4",
      embedUrl: "https://www.ponglens.com/coaches#video",
      duration: "PT2M11S",
      uploadDate: "2026-08-08",
      isFamilyFriendly: true,
      publisher: { "@id": "https://www.ponglens.com/#organization" },
      inLanguage: "en",
    },
    {
      "@type": "FAQPage",
      "@id": "https://www.ponglens.com/coaches#faq",
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
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
      <SiteHeader />
      <main className="flex-1">
        {/* HERO — the home page's treatment: full-bleed animation, scrims
            that keep the copy legible, and the storefront itself standing
            beside it once there is room for it. */}
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
            {/* The phone joins at xl, not lg: below that the copy needs the
                whole 768px the home page gives it, or a 7xl heading breaks
                into four lines. */}
            <div className="xl:flex xl:items-center xl:gap-16">
              <div className="mx-auto max-w-3xl lg:mx-0 xl:flex-1">
                {/* What the STUDENT gets, not what the coach is paid.
                    The money is still on the page: the line under this one
                    says PongLens handles the order and the payment, and
                    there is a whole section on payouts. But a coach who is
                    quietly unsure about charging their own players should
                    not have to read "get paid" before anything else. */}
                <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-6xl lg:text-7xl">
                  Show your students{" "}
                  <span className="text-cyan-glow text-glow">
                    exactly what to work on.
                  </span>
                </h1>
                <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-zinc-300 sm:text-xl lg:mx-0">
                  Your students already send you match videos. PongLens cuts
                  them into points, gives you the tools to review them
                  properly, and handles the order and the payment.
                </p>
                <div className="mt-10 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
                  <Link
                    href="/coaching/start"
                    className="glow-cta rounded-full bg-cyan-glow px-8 py-3.5 text-base font-semibold text-ink sm:text-lg"
                  >
                    Set up your page
                  </Link>
                  <Link
                    href="#how"
                    className="rounded-full px-5 py-3.5 text-base font-medium text-zinc-300 transition-colors hover:text-white sm:text-lg"
                  >
                    See how it works ↓
                  </Link>
                </div>
              </div>
              {/* What a coach actually does, and what they sell, in one
                  object. The old hero was the offerings page mid-scroll:
                  its top card cut in half, which made the picture a price
                  list rather than a thing being sold.

                  Width is the constraint here, not height. A landscape
                  tablet is 1.44:1, so at 430px it is only 300 tall, where
                  the old phone was 571 — that spare height is what lets
                  the phone hang off the corner. But the copy needs 768px
                  for a 7xl heading to stay on three lines, and the column
                  is 1104 wide, so the phone has to live INSIDE the
                  tablet's width rather than beside it. */}
              <div
                className="relative hidden shrink-0 xl:block"
                style={{ width: 430, height: 615 }}
              >
                {/* The phone is in FRONT. Behind the tablet it was the
                    bigger object with its best half covered: the order
                    amounts and the earnings row sat under the tablet, and
                    what showed was the navigation list. In front, the
                    money is all visible and what it covers is the brief
                    and the write-up, which are text. */}
                <div
                  className="absolute z-10"
                  style={{ width: 236, right: -76, top: 104 }}
                >
                  <PhoneFrame glow={false}>
                    <Image
                      src="/showcase/coach-payout-m.jpg"
                      alt="A coach's earnings in PongLens, with payouts ready to their bank"
                      width={390}
                      height={844}
                      className="block w-full"
                    />
                  </PhoneFrame>
                </div>
                {/* The tablet behind, still the subject: it is wider, it
                    holds the rally, and the phone only reaches its right
                    hand column. */}
                <div className="relative z-0">
                  <PhoneFrame device="tablet">
                    <Image
                      src="/showcase/coach-work-t.jpg"
                      alt="A coach reviewing a student's match: the rally on one side, their brief and the write-up on the other"
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

        {/* WHAT YOU WORK WITH — the same card grid as the home page */}
        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              What you work with
            </h2>
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

        {/* THE VIDEO — straight after the cards, because the cards say
            what the tools are and this shows them being used, which is
            the same order the home page puts them in. The hero's "See how
            it works" link lands here, on the section with those words on
            it.

            The treatment is the home page's, deliberately.
            Section wrapper, widths, gutters and the component are all the
            home page's: the play control above the picture, the poster as
            the title card, no border on the box, flat ink on both sides so
            the video has no seam. Those took several passes there and none
            of them is re-derived here. */}
        <section
          id="how"
          className="relative scroll-mt-20 overflow-hidden py-14 sm:py-28"
        >
          {/* Wider than the rest of the page, and narrower gutters on a
              phone. Everything else here is a column of text at max-w-6xl;
              this is a picture. */}
          <div className="relative mx-auto max-w-[1500px] px-4 sm:px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              See how it works
            </h2>
            <div className="mt-8 sm:mt-12">
              <LandingVideo cuts={COACH_CUTS} length="2:11" />
            </div>
          </div>
        </section>

        {/* GETTING STARTED — the same eight chapters, now read as the
            order you do them in rather than as a tour. It follows the
            video on purpose: the video shows the whole thing once, and
            this is the part someone comes back to when they are actually
            setting up. */}
        <section id="steps" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              How to get started
            </h2>
            <div className="mt-14">
              {/* Three times the default 3200ms. These captions average
                  twenty-six words, which is about eight seconds of
                  reading on its own, and the screenshot beside them has
                  its own text to take in before the chapter turns. */}
              <WalkthroughBand chapters={chapters} subMs={9500} />
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
              Your first offering takes{" "}
              <span className="text-magenta-soft">ten minutes</span>.
            </h2>
            <p className="max-w-xl text-zinc-400">
              Set a price, publish the page, and send it to one student.
            </p>
            <Link
              href="/coaching/start"
              className="glow-cta rounded-full bg-cyan-glow px-8 py-3 text-base font-semibold text-ink"
            >
              Set up your page
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
