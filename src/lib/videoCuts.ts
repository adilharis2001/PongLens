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
}

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
