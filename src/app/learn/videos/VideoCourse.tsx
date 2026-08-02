"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CHAPTERS, TOTAL_SECONDS, type Chapter } from "./chapters";

/**
 * The tutorial course: nine chapters, in order.
 *
 * Two layouts, because a 9:16 video wants opposite things on each:
 *
 *  - MOBILE is a horizontal snap deck. One chapter fills the screen, you
 *    swipe to the next, and the numbered rail underneath both shows where
 *    you are and jumps you around. Swiping is how you already move through
 *    points in this app, so the gesture is not a new thing to learn.
 *  - DESKTOP puts the chapter list on the left and one player on the right.
 *    A phone-shaped video centred in a wide window wastes most of the
 *    screen and gives the eye nowhere to go; beside a list it reads as a
 *    course with a table of contents.
 *
 * Only the visible chapter's <video> gets a src, so opening the page pulls
 * one file rather than nine. Links are signed in a single batch up front
 * (see /api/tutorial-url) and last six hours, comfortably longer than
 * anyone sits here.
 */

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function ChapterVideo({
  chapter,
  src,
  active,
  maxHeight,
  onPlay,
}: {
  chapter: Chapter;
  src?: string;
  active: boolean;
  onPlay: () => void;
  /** Height cap as a CSS length. A prop rather than a class because the two
   *  layouts want different caps, and Tailwind only generates classes it can
   *  read literally in the source — a template like max-h-[${x}] produces
   *  nothing. */
  maxHeight: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  // Moving away from a chapter pauses it. Two chapters talking at once is
  // the one thing a swipe deck of videos can do that nothing else can.
  useEffect(() => {
    if (!active) ref.current?.pause();
  }, [active]);

  return (
    <video
      ref={ref}
      src={active || src ? src : undefined}
      controls
      playsInline
      preload={active ? "metadata" : "none"}
      onPlay={onPlay}
      style={{ maxHeight, width: "auto", margin: "0 auto" }}
      className="rounded-2xl border border-edge bg-black"
      aria-label={`Chapter ${chapter.n}: ${chapter.title}`}
    />
  );
}

export function VideoCourse() {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState(0);
  const [failed, setFailed] = useState(false);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<HTMLDivElement[]>([]);
  const pillRefs = useRef<HTMLButtonElement[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tutorial-url", { method: "POST" });
        const data = res.ok ? await res.json() : null;
        if (!cancelled && data?.urls) setUrls(data.urls);
        else if (!cancelled) setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Which card the deck has settled on.
   *
   * Watched rather than computed from scrollLeft: a scroll handler has to
   * divide by clientWidth and guess where a momentum swipe will land, and
   * it silently stops matching the moment the card geometry changes. The
   * observer asks the card itself whether it is the one on screen, so the
   * rail cannot drift out of step with the deck.
   */
  useEffect(() => {
    const root = deckRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || e.intersectionRatio < 0.6) continue;
          const i = cardRefs.current.indexOf(e.target as HTMLDivElement);
          if (i >= 0) setCurrent(i);
        }
      },
      { root, threshold: [0.6] }
    );
    for (const el of cardRefs.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, []);

  /**
   * Tick the first-steps checklist the first time a chapter actually plays.
   * On play rather than on open, because a checked box someone did not earn
   * is worse than an unchecked one. Fire-and-forget and once per mount: if
   * the write fails the page carries on, and the checklist simply asks again
   * next time.
   */
  const played = useRef(false);
  const markStarted = useCallback(() => {
    if (played.current) return;
    played.current = true;
    void createClient()
      .auth.updateUser({ data: { tutorial_started: true } })
      .catch(() => {});
  }, []);

  const goTo = useCallback((i: number) => {
    setCurrent(i);
    cardRefs.current[i]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "start",
    });
  }, []);

  // The deck and the desktop list are two controls over one piece of state,
  // and only one of them is mounted at a time. Choose chapter 5 on a wide
  // window, narrow it, and the deck is still sitting on chapter 1 under a
  // rail reading 5 — so re-seat it when it comes back into play. Only on
  // resize: doing it on every `current` change would yank a swipe that the
  // observer has already reported but the finger has not finished.
  useEffect(() => {
    const sync = () => {
      const deck = deckRef.current;
      const card = cardRefs.current[current];
      if (!deck || !card || card.offsetParent === null) return;
      deck.scrollTo({ left: card.offsetLeft - deck.offsetLeft, behavior: "auto" });
    };
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [current]);

  // Nine pills do not fit across a phone, so the last few sit off the right
  // edge. Swiping to chapter 9 with its pill out of sight makes the rail look
  // like it has lost track of you; drag it along instead.
  useEffect(() => {
    pillRefs.current[current]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [current]);

  const chapter = CHAPTERS[current];

  return (
    <div className="mt-6">
      {failed && (
        <p className="mb-4 rounded-xl border border-edge bg-surface p-3 text-sm text-zinc-400">
          The videos could not be loaded just now. Refreshing usually sorts it.
        </p>
      )}

      {/* ---------------------------------------------------- mobile deck */}
      <div className="lg:hidden">
        <div
          ref={deckRef}
          className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {CHAPTERS.map((c, i) => (
            // No peek at the next card: each card is a video AND its text,
            // so a sliver of the neighbour showed a column of cut-off words
            // beside the current video. The numbered rail below already says
            // there are more.
            <div
              key={c.slug}
              ref={(el) => {
                if (el) cardRefs.current[i] = el;
              }}
              className="w-full shrink-0 snap-start"
            >
              {/* Capped by height, not width: these are 9:16, so a full-width
                  phone video is ~600px tall and pushes the title and the
                  chapter rail clean off the screen. */}
              <ChapterVideo
                chapter={c}
                src={urls[c.slug]}
                active={i === current}
                maxHeight="38vh"
                onPlay={markStarted}
              />
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-cyan-glow">
                  Chapter {c.n} · {mmss(c.seconds)}
                </p>
                <h2 className="mt-1 text-lg font-bold tracking-tight">{c.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-zinc-400">{c.blurb}</p>
                {c.guide && (
                  <Link
                    href={`/learn/${c.guide}`}
                    className="mt-2 inline-block text-sm text-cyan-glow underline underline-offset-4"
                  >
                    Read this one instead
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* numbered rail: where you are, and a way to jump */}
        <div className="-mx-5 mt-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CHAPTERS.map((c, i) => (
            <button
              key={c.slug}
              ref={(el) => {
                if (el) pillRefs.current[i] = el;
              }}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Chapter ${c.n}: ${c.title}`}
              aria-current={i === current ? "true" : undefined}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors ${
                i === current
                  ? "border-cyan-glow bg-cyan-glow/15 text-cyan-glow"
                  : "border-edge bg-surface text-zinc-500"
              }`}
            >
              {c.n}
            </button>
          ))}
        </div>
      </div>

      {/* -------------------------------------------------- desktop layout */}
      {/* Flex rather than lg:grid-cols-[minmax(0,1fr)_320px]: Tailwind does
          not generate that class at all (the comma inside minmax defeats it),
          and the failure is silent — the grid falls back to one column and
          the list drops below the video looking merely unlucky. */}
      <div className="hidden gap-8 lg:flex lg:items-start">
        <div className="min-w-0 flex-1">
          <ChapterVideo
            chapter={chapter}
            src={urls[chapter.slug]}
            active
            maxHeight="58vh"
            onPlay={markStarted}
          />
          {/* One line, not the mobile card: the list to the right already
              carries the number, the blurb and the running time, and a
              taller caption pushes itself under the fold on a laptop. */}
          <div className="mt-3 flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-bold tracking-tight">{chapter.title}</h2>
            <p className="text-xs font-semibold uppercase tracking-widest text-cyan-glow">
              Chapter {chapter.n} · {mmss(chapter.seconds)}
            </p>
            {chapter.guide && (
              <Link
                href={`/learn/${chapter.guide}`}
                className="text-sm text-cyan-glow underline underline-offset-4"
              >
                Read this one instead
              </Link>
            )}
          </div>
        </div>

        <ol className="w-80 shrink-0 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
          {CHAPTERS.map((c, i) => (
            <li key={c.slug}>
              <button
                type="button"
                onClick={() => goTo(i)}
                aria-current={i === current ? "true" : undefined}
                className={`flex w-full items-center gap-3 p-3 text-left transition-colors ${
                  i === current ? "bg-cyan-glow/10" : "hover:bg-surface-2"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    i === current
                      ? "bg-cyan-glow text-ink"
                      : "border border-edge text-zinc-500"
                  }`}
                >
                  {c.n}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-sm font-semibold ${
                      i === current ? "text-white" : "text-zinc-300"
                    }`}
                  >
                    {c.title}
                  </span>
                  <span className="block truncate text-xs text-zinc-500">{c.blurb}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-zinc-600">
                  {mmss(c.seconds)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <p className="mt-8 text-center text-xs text-zinc-600">
        {CHAPTERS.length} chapters · {Math.round(TOTAL_SECONDS / 60)} minutes in total
      </p>
    </div>
  );
}
