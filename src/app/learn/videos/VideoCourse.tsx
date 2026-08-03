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

function DeckArrow({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous chapter" : "Next chapter"}
      className={`absolute top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-ink/80 text-zinc-200 shadow-lg shadow-black/50 backdrop-blur transition-colors hover:text-cyan-glow ${
        side === "left" ? "-left-3" : "-right-3"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d={side === "left" ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"}
        />
      </svg>
    </button>
  );
}

function ChapterVideo({
  chapter,
  src,
  active,
  boxHeight,
  near,
  onPlay,
}: {
  chapter: Chapter;
  src?: string;
  active: boolean;
  /** Next to the current card, so its first frame is worth fetching — it is
   *  the half of it you can see that has to look like a video. */
  near?: boolean;
  /** Hands the element over so the owner can read the playhead and stop it. */
  onPlay: (el: HTMLVideoElement) => void;
  /**
   * The box's height, as a definite CSS length — width comes off it via the
   * 9:16 ratio. It has to be definite and it has to already account for the
   * width limit: give the box an explicit height AND a max-width and the
   * aspect ratio loses to both, leaving a wrong-shaped box with the picture
   * letterboxed inside it. Callers pass a min() of the two limits.
   *
   * A prop rather than a class because the layouts differ and Tailwind only
   * generates classes it can read literally — `h-[${x}]` produces nothing.
   */
  boxHeight: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);

  // Moving away from a chapter pauses it. Two chapters talking at once is
  // the one thing a swipe deck of videos can do that nothing else can.
  useEffect(() => {
    if (!active) ref.current?.pause();
  }, [active]);

  // Unmounting does not stop playback — a detached media element carries on
  // with sound. Every <video> on this page has to be stopped by hand on the
  // way out, or leaving the page leaves the narration running.
  useEffect(() => {
    const el = ref.current;
    return () => el?.pause();
  }, []);

  const body = (
    <div
      // The box is sized here, on a plain div, not on the <video>. A video
      // element has no intrinsic size until its metadata arrives, so
      // width:auto starts at the spec's default 300×150 and only jumps to
      // the real shape once the file responds — the "tiny square that then
      // enlarges". A div takes its aspect ratio from CSS on the first paint
      // and never moves.
      style={{ height: boxHeight, aspectRatio: "9 / 16" }}
      className="relative mx-auto"
    >
      <video
        ref={ref}
        src={active || src ? src : undefined}
        controls
        playsInline
        preload={active || near ? "metadata" : "none"}
        onPlay={(e) => {
          setPlaying(true);
          onPlay(e.currentTarget);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        // Fills whatever box the wrapper worked out. object-fit is contain
        // for video by default, so the picture keeps its shape either way.
        className="h-full w-full rounded-2xl border border-edge bg-black"
        aria-label={`Chapter ${chapter.n}: ${chapter.title}`}
      />

      {/* Which chapter this is, on the picture rather than under it — the
          video is the whole point of the page and every line of text beneath
          it is height the video does not get. Gone once it is playing, when
          the title is just something in the way. */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 rounded-t-2xl bg-gradient-to-b from-black/85 via-black/45 to-transparent px-4 pb-8 pt-3 transition-opacity duration-300 ${
          playing ? "opacity-0" : "opacity-100"
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
    </div>
  );

  return body;
}

/**
 * The full-screen player. Exactly one of these exists, owned by VideoCourse.
 *
 * It used to be each card promoting itself into a portal, which was wrong in
 * a way that only showed up with sound on: BOTH layouts are always in the
 * DOM, one of them hidden by `lg:hidden` or `hidden lg:flex`. Portalling to
 * <body> lifted a card clean out of the wrapper whose display:none was the
 * only thing keeping it quiet, so a single tap started two players — the
 * mobile card's and the desktop one's — stacked, both audible, and only the
 * top one reachable by its controls. A separate dedicated player cannot
 * double up: the cards never move, and they are all paused while it is open.
 *
 * The portal is still needed, but for the original reason: position:fixed
 * resolves against the nearest transformed ancestor, and AppShell's
 * `.page-enter` holds a transform during its 200ms entry animation.
 */
function TakeoverPlayer({
  chapter,
  src,
  startAt,
  onClose,
}: {
  chapter: Chapter;
  src?: string;
  startAt: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = () => {
      if (startAt > 0) el.currentTime = startAt;
      void el.play().catch(() => {});
    };
    if (el.readyState >= 1) start();
    else el.addEventListener("loadedmetadata", start, { once: true });

    // A media element keeps playing after it leaves the document, so the
    // teardown has to stop it by hand. Without this, closing or navigating
    // away leaves a voice coming from nothing.
    //
    // Pause and nothing else. Clearing the src here as well looked tidier
    // and broke the player outright: StrictMode runs effects mount → cleanup
    // → mount, the cleanup stripped the attribute, and React saw no prop
    // change to put it back, so the second mount had no source at all.
    return () => {
      el.pause();
    };
  }, [startAt]);

  const layer = (
    <div
      style={{ zIndex: 60 }}
      className="fixed inset-0 flex items-center justify-center bg-black"
    >
      <video
        ref={ref}
        src={src}
        controls
        autoPlay
        playsInline
        style={{ height: "100dvh", width: "100vw" }}
        className="bg-black"
        aria-label={`Chapter ${chapter.n}: ${chapter.title}`}
      />
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
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(layer, document.body);
}

/**
 * The chapter directory: every chapter by name, under the video.
 *
 * Numbers alone were what the rail did, and they said nothing about what
 * you were jumping to. These are chips wide enough to carry the title, in
 * one horizontally scrolling row so nine of them cost one line of height —
 * and the row keeps the current chip in view, so it doubles as "you are
 * here" without a second indicator.
 */
function ChapterDirectory({
  current,
  onPick,
}: {
  current: number;
  onPick: (i: number) => void;
}) {
  const chipRefs = useRef<HTMLButtonElement[]>([]);

  useEffect(() => {
    chipRefs.current[current]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [current]);

  return (
    <div
      // Full-bleed so the row can run to both screen edges; a directory that
      // stops short of the edge looks like it has ended when it has not.
      className="-mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {CHAPTERS.map((c, i) => (
        <button
          key={c.slug}
          ref={(el) => {
            if (el) chipRefs.current[i] = el;
          }}
          type="button"
          onClick={() => onPick(i)}
          aria-current={i === current ? "true" : undefined}
          className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-left transition-colors ${
            i === current
              ? "border-cyan-glow bg-cyan-glow/15"
              : "border-edge bg-surface hover:border-cyan-glow/40"
          }`}
        >
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
              i === current ? "bg-cyan-glow text-ink" : "bg-surface-2 text-zinc-500"
            }`}
          >
            {c.n}
          </span>
          <span
            className={`whitespace-nowrap text-xs font-semibold ${
              i === current ? "text-cyan-glow" : "text-zinc-400"
            }`}
          >
            {c.title}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-zinc-600">
            {mmss(c.seconds)}
          </span>
        </button>
      ))}
    </div>
  );
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
   * One player, owned here — see TakeoverPlayer for why it cannot be the
   * card promoting itself. The card that was tapped is stopped and its
   * playhead handed over, so the big one carries on from the same second
   * and nothing is left playing behind it.
   */
  const [takeover, setTakeover] = useState<{ i: number; at: number } | null>(
    null
  );

  const openTakeover = useCallback(
    (i: number, el: HTMLVideoElement) => {
      const at = el.currentTime;
      el.pause();
      setTakeover({ i, at });
      markStarted();
    },
    [markStarted]
  );

  const closeTakeover = useCallback(() => setTakeover(null), []);

  // Escape closes it, and the page behind must not scroll while it is open —
  // a takeover you can scroll out from under is just a big video.
  useEffect(() => {
    if (!takeover) return;
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
        {/* The arrows are centred on the deck, so the deck owns the
            positioning context — with the directory inside it too they would
            centre on the pair and float somewhere below the video. */}
        <div className="relative">
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
                boxHeight="min(calc(100dvh - 18rem), calc(78vw * 16 / 9))"
                onPlay={(el) => openTakeover(i, el)}
              />
            </div>
          ))}
        </div>

        {/* Arrows sitting on the peeking neighbours. The peek alone says
            "there is more over there"; an arrow on top of it says which way
            to go and gives anyone who would rather tap than swipe a target.
            Each disappears at its end of the deck, so the pair also reads as
            a position indicator without printing nine numbers. */}
        {current > 0 && (
          <DeckArrow side="left" onClick={() => goTo(current - 1)} />
        )}
        {current < CHAPTERS.length - 1 && (
            <DeckArrow side="right" onClick={() => goTo(current + 1)} />
          )}
        </div>

        <ChapterDirectory current={current} onPick={goTo} />
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
            boxHeight={DESK_H}
            onPlay={(el) => openTakeover(current, el)}
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

      {/* One, for the whole page, whichever layout opened it. */}
      {takeover && (
        <TakeoverPlayer
          chapter={CHAPTERS[takeover.i]}
          src={urls[CHAPTERS[takeover.i].slug]}
          startAt={takeover.at}
          onClose={closeTakeover}
        />
      )}
    </div>
  );
}
