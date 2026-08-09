"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The product walkthrough on the landing page.
 *
 * Two cuts of the same script, shot at two viewports (scripts/demos/landing),
 * and the shape of the screen decides which one plays: a phone gets the phone
 * cut. Serving the desktop cut to a phone would letterbox a 16:9 recording
 * into a column about a third of its height, which is a video of a video.
 *
 * ONE element, chosen at runtime — not two with one hidden. Both branches of
 * a responsive layout render, so the hidden one would still be a <video> in
 * the document, and a <video> in the document is a thing that can end up
 * playing sound nobody can see.
 */

interface Cut {
  src: string;
  poster: string;
  ratio: string;
  width: string;
}

const CUTS: Record<"desktop" | "mobile", Cut> = {
  desktop: {
    src: "/demo/walkthrough-desktop.mp4",
    poster: "/demo/walkthrough-desktop.jpg",
    ratio: "16 / 9",
    // Width, not height: an explicit height alongside a max-width defeats
    // aspect-ratio and letterboxes the picture inside a correctly clamped
    // box of the wrong shape. This is the one definite dimension, and it
    // already accounts for the other limit.
    width: "min(100%, calc(82dvh * 16 / 9))",
  },
  mobile: {
    src: "/demo/walkthrough-mobile.mp4",
    poster: "/demo/walkthrough-mobile.jpg",
    ratio: "9 / 16",
    // High enough that the COLUMN is what limits this on a phone, not the
    // height cap: a 9:16 cut needs 1.78 pixels of height for every pixel of
    // width, so a stingier cap shows a phone-shaped video narrower than its
    // own heading. The cap still earns its place on a landscape phone,
    // where the height is the short side.
    width: "min(100%, calc(98dvh * 9 / 16))",
  },
};

/**
 * The coach walkthrough, same treatment. Both pages render THIS component
 * rather than a copy of it: the play control's position, the missing
 * border, the poster-as-title-card and the centre-on-play all took several
 * passes to get right, and a second copy is a second thing to get wrong.
 */
export const COACH_CUTS: Record<"desktop" | "mobile", Cut> = {
  desktop: {
    src: "/demo/coach-desktop.mp4",
    poster: "/demo/coach-desktop.jpg",
    ratio: CUTS.desktop.ratio,
    width: CUTS.desktop.width,
  },
  mobile: {
    src: "/demo/coach-mobile.mp4",
    poster: "/demo/coach-mobile.jpg",
    ratio: CUTS.mobile.ratio,
    width: CUTS.mobile.width,
  },
};

/** Runtime, from voice/<script>.json. Printed so nobody has to guess. */
const LENGTH = "1:54";

export function LandingVideo({
  cuts = CUTS,
  length = LENGTH,
}: {
  cuts?: Record<"desktop" | "mobile", Cut>;
  length?: string;
} = {}) {
  // Desktop until proven otherwise: the server cannot know the viewport, and
  // preload="none" means guessing wrong costs a poster, not a download.
  const [cut, setCut] = useState<keyof typeof CUTS>("desktop");
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const pick = () => setCut(mq.matches ? "mobile" : "desktop");
    pick();
    mq.addEventListener("change", pick);
    return () => mq.removeEventListener("change", pick);
  }, []);

  // A video taken out of the document keeps playing, with sound. Crossing the
  // breakpoint mid-playback remounts this one, so the cleanup is not
  // theoretical.
  useEffect(() => {
    const el = ref.current;
    return () => el?.pause();
  }, [cut]);

  const start = useCallback(() => {
    setPlaying(true);
    void ref.current?.play().catch(() => setPlaying(false));
  }, []);

  // Centre the video in the viewport once it is running.
  //
  // The phone cut is 642px tall in a 660px viewport, so whatever you were
  // looking at when you pressed play, the video was running off an edge —
  // having to scroll to fix your own framing was the first thing anyone
  // noticed about this section. AFTER the render, not inside the click:
  // pressing play removes the button, the layout shifts up by its height,
  // and a scroll measured before that lands 72px out.
  useEffect(() => {
    if (!playing) return;
    const id = requestAnimationFrame(() =>
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    );
    return () => cancelAnimationFrame(id);
  }, [playing]);

  const c = cuts[cut];

  return (
    <div className="mx-auto" style={{ width: c.width }}>
      {/* The control lives HERE, in the page's own flow, ABOVE the video.
          Two reasons, in order.
          Not over the picture: the poster is the video's title card — a
          logo above a wordmark, centred — so a centred button lands on the
          name, and anywhere else reads as a stray disc floating off to one
          side. In the layout it is centred by the layout, it says what it
          is and how long it takes, and the picture stays uncovered.
          And not BELOW the picture, which is where it went first: the video
          is nearly a viewport tall by design, so anything after it starts
          off screen. Arriving at this section showed a title card and no
          way to tell it was a video at all. */}
      {!playing && (
        <div
          // Inline, because `mb-6` on this element computed to 0px. Not the
          // first Tailwind utility in this repo to quietly not exist; the
          // rule here is that a gap the layout depends on gets a number.
          style={{ marginBottom: 24 }}
          className="flex justify-center"
        >
          <button
            type="button"
            onClick={start}
            className="glow-cta group flex items-center gap-2.5 rounded-full bg-cyan-glow py-2.5 pl-4 pr-5 text-sm font-semibold text-ink transition-transform hover:scale-[1.03] sm:gap-3 sm:py-3 sm:pl-5 sm:pr-6 sm:text-base"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
              <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.3-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
            </svg>
            Watch the walkthrough
            <span className="font-medium text-ink/60">{length}</span>
          </button>
        </div>
      )}
      {/* The box is sized here, on a div. A media element has no intrinsic
          size until its metadata arrives, so sizing the <video> itself starts
          it at the spec's 300x150 and makes it jump when the file answers. */}
      {/* No border, no shadow, no rounding. The composition already paints
          its backdrop in --color-ink, the same value this page is painted
          in, so with nothing drawn around it the video has no edge at all:
          the device and its caption look like part of the page rather than
          a card sitting on it. Anything here — even a hairline — puts the
          seam back. */}
      <div className="relative overflow-hidden bg-ink" style={{ aspectRatio: c.ratio }}>
        <video
          key={cut}
          ref={ref}
          src={c.src}
          poster={c.poster}
          preload="none"
          playsInline
          // Native controls only once it is running. Idle, the browser paints
          // its own play button, a scrubber and (on iOS) an expand icon
          // across the picture, which is three things nobody designed.
          controls={playing}
          onPlay={() => setPlaying(true)}
          onEnded={() => setPlaying(false)}
          className="absolute inset-0 h-full w-full"
        />
        {/* Nothing is DRAWN over the poster, but all of it is still the
            control: reaching for the picture is what people do, and a poster
            that ignores the tap is a poster that looks broken. */}
        {!playing && (
          <button
            type="button"
            onClick={start}
            aria-label="Play the walkthrough"
            tabIndex={-1}
            className="absolute inset-0 cursor-pointer"
          />
        )}
      </div>

    </div>
  );
}
