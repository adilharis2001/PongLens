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

const CUTS = {
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
} as const;

export function LandingVideo() {
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

  const c = CUTS[cut];

  return (
    <div className="mx-auto" style={{ width: c.width }}>
      {/* The box is sized here, on a div. A media element has no intrinsic
          size until its metadata arrives, so sizing the <video> itself starts
          it at the spec's 300x150 and makes it jump when the file answers. */}
      <div
        className="relative overflow-hidden rounded-2xl border border-edge bg-ink shadow-2xl shadow-black/60"
        style={{ aspectRatio: c.ratio }}
      >
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
        {!playing && (
          <button
            type="button"
            onClick={start}
            aria-label="Play the walkthrough"
            className="group absolute inset-0 grid place-items-center bg-ink/20 transition-colors hover:bg-ink/10"
          >
            <span className="glow-cta grid h-16 w-16 place-items-center rounded-full bg-cyan-glow text-ink transition-transform group-hover:scale-105 sm:h-20 sm:w-20">
              <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7 sm:h-8 sm:w-8" fill="currentColor" aria-hidden>
                <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.3-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
              </svg>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
