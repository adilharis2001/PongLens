"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { landingVideoPresentation } from "@/lib/landingVideoState";
import { CUTS, PLAY_DEFAULT, type Cut } from "@/lib/videoCuts";
import { WALKTHROUGH } from "@/lib/walkthrough";

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

/** Runtime, generated from voice/landing.json (captions.mjs) rather than
 *  typed in. It has been wrong on the page twice already: every re-render
 *  changes it by a second or two and a hand-kept number does not notice. */
const LENGTH = WALKTHROUGH.length;

export function LandingVideo({
  cuts = CUTS,
  length = LENGTH,
  chapters,
  posterIdle = false,
}: {
  cuts?: Record<"desktop" | "mobile", Cut>;
  length?: string;
  /**
   * Where each part of the video starts. Rendered as a row of buttons under
   * the player: pressing one seeks there and starts playback, so someone
   * who only wants to see the analysis gets it in one tap instead of
   * scrubbing a three-minute file for it. The lit button follows playback.
   */
  chapters?: readonly { label: string; at: number }[];
  /** Show the poster while idle. On by default only where the poster is a
   *  frame of the product rather than a title card. */
  posterIdle?: boolean;
} = {}) {
  // Desktop until proven otherwise: the server cannot know the viewport, and
  // preload="none" means guessing wrong costs a poster, not a download.
  const [cut, setCut] = useState<keyof typeof CUTS>("desktop");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  // The poster is attached only once the cut is settled. Attached at
  // render, a phone downloaded the desktop poster, switched cut, then
  // downloaded its own: the single largest wasted request on the page.
  const [settled, setSettled] = useState(false);
  const ref = useRef<HTMLVideoElement | null>(null);

  const jump = useCallback((at: number) => {
    const el = ref.current;
    if (!el) return;
    setPlaying(true);
    const seek = () => {
      el.currentTime = at;
      void el.play().catch(() => setPlaying(false));
    };
    // With preload="none" the first press has no metadata to seek in yet.
    if (el.readyState >= 1) seek();
    else {
      el.addEventListener("loadedmetadata", seek, { once: true });
      el.load();
    }
  }, []);

  const active = chapters
    ? chapters.reduce((best, c, i) => (time >= c.at ? i : best), -1)
    : -1;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const pick = () => setCut(mq.matches ? "mobile" : "desktop");
    pick();
    setSettled(true);
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
  const play = c.play ?? PLAY_DEFAULT;
  const presentation = landingVideoPresentation(playing, { posterIdle });

  return (
    <div className="mx-auto" style={{ width: c.width }}>
      {/* Idle is deliberately unbranded: a black field with one universally
          recognisable play control. The logo belongs to the opening motion,
          where its ring and wordmark can be one correctly spaced lockup
          instead of being pulled apart to make room for this button. */}
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
          poster={settled ? c.poster : undefined}
          preload="none"
          playsInline
          // Native controls only once it is running. Idle, the browser paints
          // its own play button, a scrubber and (on iOS) an expand icon
          // across the picture, which is three things nobody designed.
          controls={presentation.showNativeControls}
          onPlay={() => setPlaying(true)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            if (chapters) setTime(e.currentTarget.currentTime);
          }}
          className="absolute inset-0 h-full w-full"
          style={{ opacity: presentation.videoOpacity }}
        >
          {c.captions && (
            <track
              kind="captions"
              srcLang="en"
              label="English"
              src={c.captions}
            />
          )}
        </video>
        {presentation.showIdleCover && (
          <div aria-hidden className="absolute inset-0 bg-ink" />
        )}
        {presentation.showIdleScrim && (
          <div aria-hidden className="absolute inset-0 bg-ink/35" />
        )}
        {/* The whole poster is a tap target too. Reaching for the picture is
            what people do, and a poster that ignores the tap is a poster
            that looks broken. Not focusable — the disc below is the real
            control and two tab stops for one action is one too many. */}
        {presentation.showPlayControl && (
          <button
            type="button"
            onClick={start}
            aria-hidden
            tabIndex={-1}
            className="absolute inset-0 cursor-pointer"
          />
        )}

        {/* With the poster hidden, the disc belongs at the true centre. */}
        {presentation.showPlayControl && (
          <button
            type="button"
            onClick={start}
            aria-label={`Play the walkthrough, ${length}`}
            className="glow-cta group absolute left-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-cyan-glow text-ink transition-transform duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-glow/40 active:scale-100"
            style={{
              top: presentation.playTop,
              width: play.size,
              aspectRatio: "1 / 1",
              // A floor, so the button is still a real target on a narrow
              // phone, and a ceiling so it does not become a dinner plate
              // on a wide desktop.
              minWidth: 72,
              maxWidth: 168,
            }}
          >
            <svg
              viewBox="0 0 24 24"
              // A triangle centred by its bounding box looks left of centre,
              // because its mass is on the left. The nudge is optical.
              className="w-[34%] translate-x-[6%]"
              fill="currentColor"
              aria-hidden
            >
              <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.3-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
            </svg>
          </button>
        )}
      </div>

      {chapters && chapters.length > 0 && (
        // A scrolling row on a phone rather than a wrapped block: seven
        // pills wrapped under a phone-shaped video is a second screen of
        // buttons before the page continues.
        <div
          role="group"
          aria-label="Jump to a part of the walkthrough"
          className="-mx-4 mt-5 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:justify-center sm:px-0"
        >
          {chapters.map((c, i) => (
            <button
              key={c.label}
              type="button"
              onClick={() => jump(c.at)}
              aria-current={i === active ? "true" : undefined}
              className={`shrink-0 snap-start whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                i === active
                  ? "border-cyan-glow/60 bg-cyan-glow/10 text-cyan-glow"
                  : "border-edge text-zinc-300 hover:border-cyan-glow/50 hover:text-white"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
