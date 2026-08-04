import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "PongLens for coaches",
  description:
    "Offer paid match reviews on footage that is already cut into points. You set the price, the scope and the turnaround.",
};

/**
 * The coach-facing landing page. Same voice as the home page: plain
 * sentences, no sales framing, the product explains itself.
 */

const steps = [
  {
    title: "Share your link",
    copy: "Your page lists what you offer and what each review costs. Send it to your students, or put it wherever they already find you.",
  },
  {
    title: "A student sends a match",
    copy: "They pay, pick a match, and answer your questions. PongLens has already cut the footage into points by the time it reaches you.",
  },
  {
    title: "Deliver your review",
    copy: "Work point by point, then send a structured review they keep forever. Your payout releases when the order completes.",
  },
];

const details = [
  {
    title: "You set the terms",
    copy: "Your price, your scope, your turnaround. Pause new orders or cap how many you take at once whenever life fills up.",
  },
  {
    title: "Findings on real points",
    copy: "Every observation links to the rallies that show it. Your student taps a point and watches exactly what you mean.",
  },
  {
    title: "Speak or draw it",
    copy: "Dictate your thoughts and the words land as text with the recording attached. Draw on any frame when a picture says it faster.",
  },
  {
    title: "Templates to start from",
    copy: "A serve review, a receive review, a full match review. Pick one, change every word, or start from a blank page.",
  },
  {
    title: "Bring your materials",
    copy: "Attach a practice plan, a drill sheet, or anything else you prepare, up to 50 MB per file.",
  },
  {
    title: "Stripe handles the money",
    copy: "Checkout, cards, Apple Pay, and payouts to your bank. Students pay you, and PongLens keeps a small platform fee.",
  },
];

const faqs = [
  {
    q: "What does it cost?",
    a: "Nothing up front. A small platform fee comes off each order, shown before you publish, and card processing comes out of your side like any payment service.",
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
    q: "What about the free sharing my students use now?",
    a: "It stays free. Watching shared matches and leaving notes never costs anything. Paid reviews are for the structured work with a defined scope and a finish line.",
  },
];

export default function CoachesPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-arena">
      <SiteHeader />
      <main className="flex-1">
        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Get paid for the review,
              <br />
              <span className="text-cyan-glow">not just the lesson.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-zinc-300">
              Your students already send you match videos. PongLens cuts them
              into points, gives you the tools to review them properly, and
              handles the order and the payment.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/coaching"
                className="glow-cta rounded-full bg-cyan-glow px-8 py-3.5 text-base font-semibold text-ink"
              >
                Set up your page
              </Link>
              <Link
                href="#how"
                className="rounded-full px-5 py-3.5 text-base font-medium text-zinc-300 transition-colors hover:text-white"
              >
                How it works ↓
              </Link>
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-20 py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight">
              How it works
            </h2>
            <ol className="mt-12 grid gap-8 md:grid-cols-3">
              {steps.map((s, i) => (
                <li key={s.title}>
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-cyan-glow/50 text-sm font-semibold text-cyan-glow">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                    {s.copy}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {details.map((d) => (
                <article
                  key={d.title}
                  className="rounded-2xl border border-edge bg-surface p-6 transition-colors hover:border-cyan-glow/40"
                >
                  <h3 className="text-base font-semibold">{d.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                    {d.copy}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-2xl px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight">
              Questions
            </h2>
            <dl className="mt-10 space-y-8">
              {faqs.map((f) => (
                <div key={f.q}>
                  <dt className="text-base font-semibold text-zinc-100">
                    {f.q}
                  </dt>
                  <dd className="mt-2 text-sm leading-relaxed text-zinc-400">
                    {f.a}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="py-16 sm:py-24">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <h2 className="text-3xl font-bold tracking-tight">
              Your first offering takes ten minutes.
            </h2>
            <Link
              href="/coaching"
              className="glow-cta mt-8 inline-block rounded-full bg-cyan-glow px-8 py-3.5 text-base font-semibold text-ink"
            >
              Set up your page
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
