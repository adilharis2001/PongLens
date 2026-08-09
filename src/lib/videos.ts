import { COACH_CUTS, CUTS, type Cut } from "./videoCuts";
import { WALKTHROUGH } from "./walkthrough";

/**
 * The videos, for sending someone a link to one.
 *
 * /videos and /videos/<slug> exist so a single cut can be shared on its own,
 * without the marketing page wrapped around it. An investor gets a URL that
 * opens on the video and nothing else.
 *
 * UNLISTED, NOT PRIVATE. Anyone with the link can watch — there is no login
 * on these pages and there should not be, since the whole point is sending
 * the link to someone who does not have an account. What they are is
 * undiscoverable: `noindex` on both pages, absent from the sitemap, and
 * linked from nowhere on the site.
 *
 * Deliberately NOT added to robots.txt. Disallowing a path stops a crawler
 * fetching the page, which means it never reads the `noindex` — and a URL
 * that leaks some other way can then still be indexed, title only, with no
 * way to suppress it. Letting crawlers in to be told "do not index" is the
 * arrangement that actually keeps it out.
 */
export interface ShareVideo {
  slug: string;
  /** Shown as the page's heading and its link title. */
  title: string;
  /** One line under it on the index. Not on the video page itself. */
  blurb: string;
  /** Human readable runtime, for the play button. */
  length: string;
  cuts: Record<"desktop" | "mobile", Cut>;
}

export const SHARE_VIDEOS: ShareVideo[] = [
  {
    slug: "coaches",
    title: "PongLens for coaches",
    blurb:
      "Setting up what you sell, taking an order, reviewing a match point by point, and getting paid.",
    length: "2:11",
    cuts: COACH_CUTS,
  },
  {
    slug: "product",
    title: "PongLens",
    blurb:
      "The whole product in order: upload a match, get every point back, score it, and read what it says about your game.",
    length: WALKTHROUGH.length,
    cuts: CUTS,
  },
];

export const shareVideo = (slug: string) =>
  SHARE_VIDEOS.find((v) => v.slug === slug);
