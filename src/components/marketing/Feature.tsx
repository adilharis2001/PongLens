import Image from "next/image";

import { PhoneFrame } from "@/components/marketing/PhoneFrame";

/**
 * One feature on a landing page: a real screen on one side, a heading and
 * a sentence or two on the other. Sides alternate down the page so the eye
 * moves. On a phone the text comes first and the screen sits under it,
 * whichever side it takes on a laptop: a heading is what tells you what
 * you are looking at, so it cannot come after the picture.
 *
 * Shared by the player and coach pages so the two read as one site: the
 * same grid, the same type, the same spacing. A change to the rhythm of
 * one page is a change to both.
 */
export function Feature({
  id,
  title,
  children,
  media,
  flip = false,
  after,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  media: React.ReactNode;
  flip?: boolean;
  after?: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 py-14 sm:py-20">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-2 lg:gap-16">
        <div className={flip ? "lg:order-2" : ""}>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {title}
          </h2>
          <p className="mt-4 max-w-lg text-lg leading-relaxed text-zinc-400">
            {children}
          </p>
          {after && <div className="mt-6">{after}</div>}
        </div>
        <div className={`flex justify-center ${flip ? "lg:order-1" : ""}`}>
          {media}
        </div>
      </div>
    </section>
  );
}

/** A phone capture (390x844 CSS pixels, shot at 2x) in the phone bezel. */
export function Phone({
  src,
  alt,
  priority = false,
  className = "w-[min(100%,260px)] sm:w-[280px]",
}: {
  src: string;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <PhoneFrame className={className}>
      <Image
        src={src}
        alt={alt}
        width={390}
        height={844}
        priority={priority}
        sizes="(min-width: 640px) 280px, 260px"
        className="block w-full"
      />
    </PhoneFrame>
  );
}

/** The primary call to action, the same pill on both pages. */
export const CTA_CLASS =
  "glow-cta inline-flex min-h-11 w-full max-w-80 items-center justify-center rounded-full bg-cyan-glow px-6 text-base font-semibold text-ink sm:w-auto sm:max-w-none sm:px-8";
