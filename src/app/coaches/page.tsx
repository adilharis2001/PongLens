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
const chapters: Chapter[] = [
  {
    shots: ["coach-offering"],
    title: "What you offer",
    caption: (
      <>
        You decide what a review includes,{" "}
        {glow("what it costs, and how long you need")}. While you type, you
        see the card your students will see.
      </>
    ),
  },
  {
    shots: ["coach-page"],
    title: "Your page",
    caption: (
      <>
        Your reviews are all on one page, at{" "}
        {glow("ponglens.com/coach/yourname")}. Send that link to your
        students, or add it to your club page and your social media.
      </>
    ),
  },
  {
    shots: ["coach-order"],
    title: "A new order",
    caption: (
      <>
        A student pays, picks one of their matches, and answers your
        questions. You read the answers first, then{" "}
        {glow("accept or decline")}. Nothing starts until you accept.
      </>
    ),
  },
  {
    shots: ["coach-points"],
    title: "The points",
    caption: (
      <>
        The match arrives already cut into points, so you never search the
        video for a rally. Write what you see, then{" "}
        {glow("attach the points that show it")}.
      </>
    ),
  },
  {
    shots: ["coach-writeup"],
    title: "Your write-up",
    caption: (
      <>
        Type your review, or {glow("speak it and it becomes text")}. The
        sections come from the template you chose. Your draft saves while you
        work.
      </>
    ),
  },
  {
    shots: ["coach-review"],
    title: "What they get",
    caption: (
      <>
        Your student gets what you wrote and{" "}
        {glow("a clip for every point you chose")}. It stays in their
        account, and they can ask you a question after they watch it.
      </>
    ),
  },
  {
    shots: ["coach-hub", "coach-queue"],
    title: "Getting paid",
    caption: (
      <>
        Your orders are sorted into the ones waiting for you and the ones
        waiting for your student. When a review is finished,{" "}
        {glow("Stripe sends the money to your bank")}.
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
                <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-6xl lg:text-7xl">
                  Get paid for the review,{" "}
                  <span className="text-cyan-glow text-glow">
                    not just the lesson.
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
              {/* The page a coach gets, on the phone their student opens it
                  on. The width is inline: it has to be one definite number
                  for the 9:16 shot to size off, and this is the one place
                  on the page that needs a value the scale does not have. */}
              <div className="hidden shrink-0 xl:block" style={{ width: 264 }}>
                <PhoneFrame>
                  <Image
                    src="/showcase/coach-offers-m.jpg"
                    alt="A coach page on a phone, showing two reviews for sale with their prices"
                    width={390}
                    height={844}
                    priority
                    className="block w-full"
                  />
                </PhoneFrame>
              </div>
            </div>
          </div>
        </section>

        {/* WALKTHROUGH — the coach side of the product, chapter by chapter */}
        <section id="how" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              How a review works
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
