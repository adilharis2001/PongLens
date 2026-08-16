/**
 * Which file plays, and how the box is sized.
 *
 * Server-safe on purpose. These used to live in LandingVideo.tsx, which is
 * a `"use client"` module — so a server component that imported them got a
 * client reference rather than the object, and reading `.desktop.poster`
 * during prerender was `undefined`. /coaches never noticed because it only
 * passed the table straight through as a prop; /videos reads it to build a
 * link list, and the build failed the first time it tried.
 */

export interface Cut {
  src: string;
  poster: string;
  ratio: string;
  width: string;
  /** WebVTT captions, if the cut has them. The picture already carries the
   *  spoken line burned in, which is right for a video watched muted and
   *  reaches nothing else: a screen reader cannot read pixels, and neither
   *  can a crawler. Not `default` — turning both on at once would show the
   *  same sentence twice. */
  captions?: string;
  /**
   * Where to put the play button on the poster.
   *
   * The poster is the video's title card: the lens ring above the wordmark,
   * the pair centred as a column. So the ring does NOT sit at the middle of
   * the frame, it sits above it by half the height of the wordmark and its
   * gap — and the button has to land on the ring, not on the frame's centre,
   * or it reads as a sticker somebody dropped on top.
   *
   * `rise` is that offset as a share of the box height; `size` is the button
   * diameter as a share of the box width. Both are proportions because the
   * box is fluid, and both differ per cut because the composition scales the
   * lockup 1.15x in landscape.
   */
  play?: { rise: string; size: string };
}

/** A safe middle for any cut that has not measured its own. */
export const PLAY_DEFAULT = { rise: "4%", size: "13%" } as const;

export const CUTS: Record<"desktop" | "mobile", Cut> = {
  desktop: {
    src: "/demo/walkthrough-desktop.mp4",
    poster: "/demo/walkthrough-desktop.jpg",
    ratio: "16 / 9",
    // Width, not height: an explicit height alongside a max-width defeats
    // aspect-ratio and letterboxes the picture inside a correctly clamped
    // box of the wrong shape. This is the one definite dimension, and it
    // already accounts for the other limit.
    width: "min(100%, calc(82dvh * 16 / 9))",
    captions: "/demo/walkthrough.vtt",
    // The ring is 150px on a 1920x1080 canvas, sitting 6.4% of the height
    // above the middle. The button is bigger than the ring on purpose: it
    // has to cover it, not sit inside it.
    // 12%, not more. The wordmark sits 30 canvas-pixels under the ring, so
    // a disc much wider than this stops covering the ring and starts
    // covering the "L" in PongLens, which reads as a collision rather than
    // as a composition. Going bigger means shrinking the lockup in the
    // poster, which is a re-render.
    play: { rise: "6.4%", size: "12%" },
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
    // The same track serves both cuts: one script, one set of timings.
    captions: "/demo/walkthrough.vtt",
    // 130px ring on 1080x1920, 3.1% above the middle. Bigger share of the
    // width than the desktop cut because a phone is held further from the
    // eye than a laptop is, and because this is the cut nobody noticed.
    play: { rise: "3.1%", size: "20%" },
  },
};

/**
 * "Introduction to PongLens" — the whole product, both halves, for someone
 * who has never heard of it. It is the only cut that is not aimed at a
 * buyer: the player video sells the player side and the coach video sells
 * the coach side, and this one just explains what the thing is.
 *
 * It lives on /videos and nowhere else. It is three minutes, where the
 * landing page has about ten seconds to say what PongLens does.
 */
export const INTRO_CUTS: Record<"desktop" | "mobile", Cut> = {
  desktop: {
    src: "/demo/intro-desktop.mp4",
    poster: "/demo/intro-desktop.jpg",
    ratio: CUTS.desktop.ratio,
    width: CUTS.desktop.width,
    captions: "/demo/intro.vtt",
    play: CUTS.desktop.play,
  },
  mobile: {
    src: "/demo/intro-mobile.mp4",
    poster: "/demo/intro-mobile.jpg",
    ratio: CUTS.mobile.ratio,
    width: CUTS.mobile.width,
    // One script, one set of timings, so the same track serves both cuts.
    captions: "/demo/intro.vtt",
    play: CUTS.mobile.play,
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
    play: CUTS.desktop.play,
  },
  mobile: {
    src: "/demo/coach-mobile.mp4",
    poster: "/demo/coach-mobile.jpg",
    ratio: CUTS.mobile.ratio,
    width: CUTS.mobile.width,
    play: CUTS.mobile.play,
  },
};
