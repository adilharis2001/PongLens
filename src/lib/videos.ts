import { COACH_CUTS, CUTS, INTRO_CUTS, type Cut } from "./videoCuts";
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
/**
 * The coach walkthrough's runtime, in one place.
 *
 * It was written out twice — here and on /coaches — and the landing figure
 * has already been wrong on the page twice for exactly that reason, which
 * is why the player cut reads its length out of a generated module instead.
 * This one is still typed by hand because the coach cut has no transcript to
 * generate from, so the least it can do is be typed once. Check it against
 * the file rather than against memory:
 *
 *   ffprobe -v error -show_entries format=duration \
 *     -of default=nw=1:nk=1 public/demo/coach-desktop.mp4
 */
export const COACH_LENGTH = "1:11";

/**
 * The introduction's runtime. Same reasoning as COACH_LENGTH above: typed
 * once, and checked against the file rather than against memory.
 */
export const INTRO_LENGTH = "3:28";

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
  // The introduction first, because it is the one to send someone who does
  // not already know what PongLens is. The other two are aimed at a buyer
  // and assume the category; this one explains it, covers both halves of
  // the product, and is the link to paste before a conversation.
  {
    slug: "intro",
    title: "Introduction to PongLens",
    blurb:
      "What PongLens is, and what both sides of it do: a player uploading and studying a match, and a coach reviewing one and getting paid for it.",
    length: INTRO_LENGTH,
    cuts: INTRO_CUTS,
  },
  // Then the two aimed at each user. Titles are a matched pair so the links
  // read as the same thing pointed at two people.
  {
    slug: "players",
    title: "PongLens for players",
    blurb:
      "The whole product in order: upload a match, get every point back, score it, and read what it says about your game.",
    length: WALKTHROUGH.length,
    cuts: CUTS,
  },
  {
    slug: "coaches",
    title: "PongLens for coaches",
    blurb:
      "Keeping students, lesson entries and shared matches together, with paid match reviews when you want them.",
    length: COACH_LENGTH,
    cuts: COACH_CUTS,
  },
];

export const shareVideo = (slug: string) =>
  SHARE_VIDEOS.find((v) => v.slug === slug);
