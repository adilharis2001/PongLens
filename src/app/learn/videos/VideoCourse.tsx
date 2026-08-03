"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { CHAPTERS, type Chapter } from "./chapters";

/**
 * The tutorial course: nine chapters, in order.
 *
 * Two layouts, because a 9:16 video wants opposite things on each:
 *
 *  - MOBILE is a horizontal snap deck with the neighbouring chapters showing
 *    at the edges, dimmed and set back. They are the whole navigation now:
 *    a card you can see is a better invitation to swipe than a row of
 *    numbers was, and swiping is already how you move through points here.
 *  - DESKTOP puts one player beside the chapter list, both the same size.
 *    A phone-shaped video centred in a wide window wastes most of the
 *    screen and gives the eye nowhere to go; beside a list it reads as a
 *    course with a table of contents.
 *
 * Pressing play on either hands the chapter the whole viewport — see the
 * takeover in ChapterVideo, which is CSS rather than the Fullscreen API.
 *
 * Only the visible chapter's <video> gets a src, so opening the page pulls
 * one file rather than nine. Links are signed in a single batch up front
 * (see /api/tutorial-url) and last six hours, comfortably longer than
 * anyone sits here.
 */

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Desktop panel size. The player is 9:16 and height-bound, so its width is
 * not ours to choose — it falls out of the height. Deriving the list's width
 * from the same expression is what keeps the two columns equal at every
 * window size; a fixed w-80 beside it was always a near-miss.
 */
const DESK_H = "calc(100dvh - 12rem)";
const DESK_W = "calc((100dvh - 12rem) * 9 / 16)";

function ChapterVideo({
  chapter,
  src,
  active,
  maxHeight,
  takeover,
  near,
  onPlay,
  onClose,
}: {
  chapter: Chapter;
  src?: string;
  active: boolean;
  /** This chapter currently owns the screen. */
  takeover: boolean;
  /** Next to the current card, so its first frame is worth fetching — it is
   *  the half of it you can see that has to look like a video. */
  near?: boolean;
  onPlay: () => void;
  onClose: () => void;
  /** Height cap as a CSS length. A prop rather than a class because the two
   *  layouts want different caps, and Tailwind only generates classes it can
   *  read literally in the source — a template like max-h-[${x}] produces
   *  nothing. */
  maxHeight: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const posRef = useRef(0);

  // Moving away from a chapter pauses it. Two chapters talking at once is
  // the one thing a swipe deck of videos can do that nothing else can.
  useEffect(() => {
    if (!active) ref.current?.pause();
  }, [active]);

  /**
   * Entering the takeover moves this <video> to a new parent, so React
   * rebuilds the element and the source reloads from zero. Put the playhead
   * back where it was, and resume only on the way in — on the way out,
   * closing should leave it stopped.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const at = posRef.current;
    // Entering always has to press play again — the rebuilt element starts
    // paused, and the tap that opened this was spent on the old one. Leaving
    // only restores the playhead, so closing leaves it stopped.
    if (at <= 0 && !takeover) return;
    const apply = () => {
      if (at > 0) el.currentTime = at;
      if (takeover) void el.play().catch(() => {});
    };
    if (el.readyState >= 1) apply();
    else el.addEventListener("loadedmetadata", apply, { once: true });
  }, [takeover]);

  const body = (
    <div
      // zIndex inline, not a class: the bottom nav and both sticky headers
      // are z-50, and a takeover that loses to the nav is a nav button
      // floating over a full-screen video.
      style={takeover ? { zIndex: 60 } : undefined}
      className={
        takeover
          ? "fixed inset-0 flex items-center justify-center bg-black"
          : "relative mx-auto w-fit"
      }
    >
      <video
        ref={ref}
        src={active || src ? src : undefined}
        controls
        playsInline
        preload={active || near ? "metadata" : "none"}
        onPlay={() => {
          setPlaying(true);
          onPlay();
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => {
          if (ref.current) posRef.current = ref.current.currentTime;
        }}
        // aspect-ratio rather than waiting for metadata: without it the
        // element is 300×150 until the file loads and every card visibly
        // resizes itself a beat after it comes on screen.
        style={
          takeover
            // Fill the viewport and let the picture letterbox inside it.
            // No aspect-ratio here — with an explicit height and a width cap
            // it only fights them, and a video's object-fit is contain
            // already, so the shape is preserved either way.
            ? { height: "100dvh", width: "100vw" }
            : { maxHeight, maxWidth: "100%", width: "auto", aspectRatio: "9 / 16" }
        }
        className={
          takeover ? "bg-black" : "rounded-2xl border border-edge bg-black"
        }
        aria-label={`Chapter ${chapter.n}: ${chapter.title}`}
      />

      {/* Which chapter this is, on the picture rather than under it — the
          video is the whole point of the page and every line of text beneath
          it is height the video does not get. Gone once it is playing, when
          the title is just something in the way. */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 rounded-t-2xl bg-gradient-to-b from-black/85 via-black/45 to-transparent px-4 pb-8 pt-3 transition-opacity duration-300 ${
          playing || takeover ? "opacity-0" : "opacity-100"
        }`}
      >
        {/* No running time here. The player prints the real one two lines
            below, and chapters.ts rounds, so the two disagreed on screen. */}
        <p className="text-[11px] font-semibold uppercase tracking-widest text-cyan-glow">
          Chapter {chapter.n}
        </p>
        <h2 className="mt-0.5 text-lg font-bold tracking-tight text-white">
          {chapter.title}
        </h2>
        {chapter.guide && (
          <Link
            href={`/learn/${chapter.guide}`}
            className="pointer-events-auto mt-1 inline-block text-xs text-zinc-300 underline underline-offset-4"
          >
            Read this one instead
          </Link>
        )}
      </div>

      {/* The way back out. Escape does it too, but a phone has no Escape and
          the native controls' own close only exists in real fullscreen. */}
      {takeover && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close full screen"
          className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );

  /**
   * In takeover, the layer goes to <body> rather than staying where it sits.
   * `position: fixed` is measured against the nearest transformed ancestor,
   * not the viewport, and AppShell's `.page-enter` carries a transform for
   * the 200ms of its entry animation — long enough that a fast tap gets a
   * "full screen" the size of the shell's max-w-4xl column. The match page
   * dodges this by not using AppShell at all; a portal is the same escape
   * without restructuring the page.
   */
  if (!takeover || typeof document === "undefined") return body;
  return createPortal(body, document.body);
}

export function VideoCourse() {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState(0);
  const [failed, setFailed] = useState(false);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<HTMLDivElement[]>([]);

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

  /**
   * Playing a chapter hands it the whole screen.
   *
   * A CSS takeover, not requestFullscreen. The app refuses the Fullscreen
   * API on purpose (see Player.tsx and SharePlayer.tsx): on iOS it surrenders
   * the video to the system player, which brings its own chrome and its own
   * ideas about when to close. Since these are 9:16, a 100dvh box on a phone
   * IS the full screen — same pixels, none of the handover.
   *
   * The element is not moved into a portal. It is the same <video> node,
   * restyled where it stands, so playback does not restart under it.
   */
  const [takeover, setTakeover] = useState<number | null>(null);

  const openTakeover = useCallback(
    (i: number) => {
      setTakeover(i);
      markStarted();
    },
    [markStarted]
  );

  // No pause needed here: leaving the takeover rebuilds the element back in
  // the card, and the resume effect only presses play on the way in.
  const closeTakeover = useCallback(() => setTakeover(null), []);

  // Escape closes it, and the page behind must not scroll while it is open —
  // a takeover you can scroll out from under is just a big video.
  useEffect(() => {
    if (takeover === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTakeover();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [takeover, closeTakeover]);

  const chapter = CHAPTERS[current];

  return (
    <div className="mt-4">
      {failed && (
        <p className="mb-4 rounded-xl border border-edge bg-surface p-3 text-sm text-zinc-400">
          The videos could not be loaded just now. Refreshing usually sorts it.
        </p>
      )}

      {/* ---------------------------------------------------- mobile deck */}
      <div className="lg:hidden">
        {/* The neighbours show, dimmed and set back, the way the landing
            page's walkthrough band does it. They are the only thing telling
            you there are more chapters now that the numbered rail is gone —
            and a card you can see the edge of is a better invitation to
            swipe than a row of digits was. The -mx-5 cancels the shell's
            gutter so the peek reaches the screen edge. */}
        <div
          ref={deckRef}
          className="-mx-5 flex snap-x snap-mandatory overflow-x-auto px-[11vw] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {CHAPTERS.map((c, i) => (
            <div
              key={c.slug}
              ref={(el) => {
                if (el) cardRefs.current[i] = el;
              }}
              // 78vw leaves (100-78)/2 = 11vw either side, so about 43px of
              // the neighbour shows. It has to be this generous: an inactive
              // chapter has preload="none", so it paints nothing at all, and
              // a black sliver on a near-black page is invisible however wide
              // it is. No gap — the scale-down opens its own.
              className={`w-[78vw] shrink-0 snap-center transition-all duration-300 ${
                i === current ? "opacity-100" : "scale-95 opacity-50"
              }`}
            >
              {/* As tall as the page will allow. These are 9:16, so height is
                  what buys width: everything subtracted is real chrome — the
                  app header and bottom nav, the shell's padding and the title
                  row. Losing the rail gave this back about 50px. */}
              <ChapterVideo
                chapter={c}
                src={urls[c.slug]}
                active={i === current}
                near={Math.abs(i - current) === 1}
                maxHeight="calc(100dvh - 14rem)"
                takeover={takeover === i}
                onPlay={() => openTakeover(i)}
                onClose={closeTakeover}
              />
            </div>
          ))}
        </div>
      </div>

      {/* -------------------------------------------------- desktop layout */}
      {/* Flex rather than lg:grid-cols-[minmax(0,1fr)_320px]: Tailwind does
          not generate that class at all (the comma inside minmax defeats it),
          and the failure is silent — the grid falls back to one column and
          the list drops below the video looking merely unlucky. */}
      <div className="hidden justify-center gap-6 lg:flex lg:items-start">
        {/* No width here. The player already sizes itself to DESK_W from its
            height and aspect ratio; pinning the column too makes the video's
            own max-width:100% circular against a shrink-to-fit parent, and
            it collapses to min-content. The list is what needs telling. */}
        <div className="shrink-0">
          <ChapterVideo
            chapter={chapter}
            src={urls[chapter.slug]}
            active
            maxHeight={DESK_H}
            // One player here, so any open takeover is this one. Only one of
            // the two layouts is ever rendered — the other sits under a
            // display:none ancestor, which a fixed child cannot escape.
            takeover={takeover !== null}
            onPlay={() => openTakeover(current)}
            onClose={closeTakeover}
          />
        </div>

        {/* Same width and height as the player, so the two read as a matched
            pair rather than a video with a sidebar bolted on. Both come off
            DESK_H, so they cannot drift apart as the window resizes. */}
        <ol
          style={{ width: DESK_W, height: DESK_H }}
          className="shrink-0 divide-y divide-edge/60 overflow-y-auto rounded-2xl border border-edge bg-surface [scrollbar-width:thin]"
        >
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
    </div>
  );
}
