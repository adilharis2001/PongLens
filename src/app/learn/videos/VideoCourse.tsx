"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LearnAudienceSwitch } from "../LearnAudienceSwitch";
import type { LearnAudience } from "../catalogTypes";
import {
  tutorialLoadFailureMessage,
  tutorialURLLoadFailed,
  tutorialURLLoadStarted,
  tutorialURLLoadSucceeded,
} from "../tutorialLoadState";
import { tutorialProgressKey } from "../tutorialProgress";
import {
  tutorialTotalSeconds,
  visibleChapters,
  type Chapter,
} from "./chapters";

/**
 * The tutorial course for the selected Learn audience, in order.
 *
 * MOBILE is the whole screen. Not a video sitting inside the app's chrome —
 * the chapters are 9:16, and a 9:16 picture needs 699px of height to be
 * full-width on a 393px phone. With the app header, a page title and the
 * bottom nav all present there were 372px left, so the video came out 209px
 * wide: 53% of the screen, marooned in the middle. The page now covers that
 * chrome the way the match Player does, and the video gets the lot.
 *
 * DESKTOP keeps the windowed layout — one player beside the chapter list,
 * both the same size. Full-bleed on a wide screen would be a tall strip of
 * video between two vast black margins.
 *
 * There is no separate full-screen mode any more. The page IS full screen,
 * so playing a chapter just plays it, which also retires the takeover that
 * used to portal a card out of its layout and start two players at once.
 *
 * Only the visible chapter's <video> gets a src, so opening the page pulls
 * one file rather than nine. Links are signed in a single batch up front
 * (see /api/tutorial-url) and last six hours.
 */

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Desktop panel size. The player is 9:16 and height-bound, so its width is
 * not ours to choose — it falls out of the height. Deriving the list's width
 * from the same expression keeps the two columns equal at every window size.
 */
const DESK_H = "calc(100dvh - 11rem)";
const DESK_W = "calc((100dvh - 11rem) * 9 / 16)";

function TutorialLoadFailure({
  chapterTitle,
  onRetry,
}: {
  chapterTitle: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="pointer-events-auto absolute left-1/2 top-1/2 w-[min(17rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/15 bg-black/80 p-4 text-center backdrop-blur"
    >
      <p className="text-sm leading-relaxed text-zinc-200">
        {tutorialLoadFailureMessage(chapterTitle)}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-full border border-white/25 px-4 py-2 text-sm font-semibold text-white transition-colors hover:border-cyan-glow/60 hover:text-cyan-glow"
      >
        Try again
      </button>
    </div>
  );
}

function ChapterVideo({
  chapter,
  chapterCount,
  src,
  active,
  near,
  fullBleed,
  boxHeight,
  onPlayingChange,
  onFirstPlay,
  loadFailed,
  onRetry,
}: {
  chapter: Chapter;
  chapterCount: number;
  src?: string;
  active: boolean;
  /** Next to the current card, so its first frame is worth fetching. */
  near?: boolean;
  /** Fill the parent instead of sizing to a fixed box (mobile). */
  fullBleed?: boolean;
  /** Definite height for the windowed layout; width comes off it via 9:16. */
  boxHeight?: string;
  onPlayingChange?: (playing: boolean) => void;
  onFirstPlay?: () => void;
  loadFailed: boolean;
  onRetry: () => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  /**
   * Native controls arrive only once you have started watching.
   *
   * Before that they are in the way: the browser paints its own play button,
   * skip-back/forward and a scrubber across the picture, and on iOS an
   * expand icon in the very corner where a title wants to go. So the idle
   * state is ours — one play button, the chapter's name, nothing else — and
   * the moment it is playing the real controls take over for scrubbing.
   */
  const [started, setStarted] = useState(false);

  // Moving away from a chapter pauses it. Two chapters talking at once is
  // the one thing a swipe deck of videos can do that nothing else can.
  useEffect(() => {
    if (!active) ref.current?.pause();
  }, [active]);

  // Unmounting does not stop playback — a detached media element carries on
  // with sound. Stop it by hand or leaving the page leaves the narration on.
  useEffect(() => {
    const el = ref.current;
    return () => el?.pause();
  }, []);

  const start = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setStarted(true);
    void el.play().catch(() => {});
  }, []);

  const report = useCallback(
    (p: boolean) => {
      setPlaying(p);
      onPlayingChange?.(p);
    },
    [onPlayingChange]
  );

  return (
    <div
      // The box is sized on a plain div, never on the <video>. A video element
      // has no intrinsic size until its metadata arrives, so width:auto starts
      // at the spec's default 300×150 and only jumps to the real shape once
      // the file answers — the card that appeared small and then grew.
      style={fullBleed ? undefined : { height: boxHeight, aspectRatio: "9 / 16" }}
      className={
        fullBleed
          ? "relative flex h-full w-full items-center justify-center"
          : "relative mx-auto"
      }
    >
      <video
        ref={ref}
        src={active || src ? src : undefined}
        controls={started}
        playsInline
        preload={active || near ? "metadata" : "none"}
        onPlay={() => {
          report(true);
          setStarted(true);
          onFirstPlay?.();
        }}
        onPause={() => report(false)}
        onEnded={() => report(false)}
        className={
          fullBleed
            ? "h-full w-auto max-w-full bg-black"
            : "h-full w-full rounded-2xl border border-edge bg-black"
        }
        aria-label={`Chapter ${chapter.n}: ${chapter.title}`}
      />

      {/* The idle face of a chapter: what it is, and one way in. */}
      <div
        className={`pointer-events-none absolute inset-0 flex flex-col justify-between transition-opacity duration-300 ${
          playing ? "opacity-0" : "opacity-100"
        } ${fullBleed ? "" : "rounded-2xl"}`}
      >
        <div
          className={`bg-gradient-to-b from-black/80 to-transparent px-5 pb-10 ${
            fullBleed ? "pt-20" : "rounded-t-2xl pt-4"
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-glow">
            Chapter {chapter.n} of {chapterCount}
          </p>
          <h2 className="mt-1 text-2xl font-bold leading-tight tracking-tight text-white">
            {chapter.title}
          </h2>
          <p className="mt-1 max-w-[16rem] text-[13px] leading-relaxed text-zinc-400">
            {chapter.blurb}
          </p>
        </div>

        {loadFailed ? (
          <TutorialLoadFailure
            chapterTitle={chapter.title}
            onRetry={onRetry}
          />
        ) : !started && (
          <button
            type="button"
            onClick={start}
            aria-label={`Play chapter ${chapter.n}: ${chapter.title}`}
            className="pointer-events-auto absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white shadow-2xl shadow-black/60 backdrop-blur-md transition-transform active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="ml-1 h-8 w-8" fill="currentColor" aria-hidden>
              <path d="M8 5.5v13l11-6.5-11-6.5Z" />
            </svg>
          </button>
        )}

        <div
          className={`bg-gradient-to-t from-black/80 to-transparent px-5 pt-10 ${
            fullBleed ? "pb-28" : "rounded-b-2xl pb-4"
          }`}
        >
          {chapter.guide && (
            <Link
              href={`/learn/${chapter.guide}`}
              className="pointer-events-auto text-xs text-zinc-300 underline underline-offset-4"
            >
              Read this one instead
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The chapter directory: every chapter by name, in one scrolling row.
 *
 * Numbers alone were what the old rail did, and they said nothing about
 * where you were about to land. The row keeps the current chip in view, so
 * it doubles as "you are here" without a second indicator.
 */
function ChapterDirectory({
  chapters,
  current,
  onPick,
  overlay,
}: {
  chapters: Chapter[];
  current: number;
  onPick: (i: number) => void;
  /** Sitting on the video rather than under it. */
  overlay?: boolean;
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
      className={`flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
        overlay ? "px-4 pb-1" : "-mx-5 mt-4 px-5 pb-1"
      }`}
    >
      {chapters.map((c, i) => (
        <button
          key={c.slug}
          ref={(el) => {
            if (el) chipRefs.current[i] = el;
          }}
          type="button"
          onClick={() => onPick(i)}
          aria-current={i === current ? "true" : undefined}
          className={`flex shrink-0 items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 text-left transition-colors ${
            i === current
              ? "border-cyan-glow/70 bg-cyan-glow/20"
              : overlay
                ? "border-white/10 bg-white/5 hover:border-white/25"
                : "border-edge bg-surface hover:border-cyan-glow/40"
          }`}
        >
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
              i === current ? "bg-cyan-glow text-ink" : "bg-white/10 text-zinc-400"
            }`}
          >
            {c.n}
          </span>
          <span
            className={`whitespace-nowrap text-xs font-semibold ${
              i === current ? "text-cyan-glow" : "text-zinc-300"
            }`}
          >
            {c.title}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
            {mmss(c.seconds)}
          </span>
        </button>
      ))}
    </div>
  );
}

interface VideoCourseProps {
  audience: LearnAudience;
  activeWorkspace: LearnAudience;
  canSwitch: boolean;
}

export function VideoCourse(props: VideoCourseProps) {
  // Audience owns every piece of course state. Remounting this inner course
  // resets its index, signed URLs, playback state, loading failure, and DOM
  // refs together when the URL override changes.
  return <AudienceVideoCourse key={props.audience} {...props} />;
}

function AudienceVideoCourse({
  audience,
  activeWorkspace,
  canSwitch,
}: VideoCourseProps) {
  const chapters = useMemo(() => visibleChapters(audience, "web"), [audience]);
  const totalSeconds = useMemo(
    () => tutorialTotalSeconds(audience, "web"),
    [audience],
  );
  const learnHref =
    audience === activeWorkspace ? "/learn" : `/learn?audience=${audience}`;
  const [urlLoad, setURLLoad] = useState(tutorialURLLoadStarted);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<HTMLDivElement[]>([]);
  const loadAttempt = useRef(0);
  const urls = urlLoad.urls;

  const loadURLs = useCallback(async () => {
    const attempt = ++loadAttempt.current;
    setURLLoad(tutorialURLLoadStarted());
    try {
      const res = await fetch("/api/tutorial-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ course: audience, platform: "web" }),
      });
      const data = res.ok ? await res.json() : null;
      if (attempt !== loadAttempt.current) return;
      if (data?.urls && typeof data.urls === "object") {
        setURLLoad(tutorialURLLoadSucceeded(data.urls));
      } else {
        setURLLoad(tutorialURLLoadFailed());
      }
    } catch {
      if (attempt === loadAttempt.current) {
        setURLLoad(tutorialURLLoadFailed());
      }
    }
  }, [audience]);

  useEffect(() => {
    void loadURLs();
    return () => {
      loadAttempt.current += 1;
    };
  }, [loadURLs]);

  /**
   * Which card the deck has settled on. Watched rather than computed from
   * scrollLeft: a scroll handler has to guess where a momentum swipe lands,
   * and it stops matching the moment the card geometry changes.
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

    /**
     * And a plain scroll fallback beside it.
     *
     * The observer is the better primitive — it survives the cards changing
     * size — but it is also the one that goes quiet when the page is not
     * being painted, and a chapter indicator stuck on 1 while the deck sits
     * on 5 is the kind of thing that reaches a user. Every card is exactly
     * one viewport wide in this deck, so the arithmetic is not a guess:
     * whichever of the two speaks first wins, and they agree.
     */
    const onScroll = () => {
      // A deck with no layout yet divides to NaN, and setCurrent(NaN) takes
      // the indicator with it. No width means no answer worth having.
      const w = root.clientWidth;
      if (!w) return;
      const i = Math.min(
        Math.max(Math.round(root.scrollLeft / w), 0),
        chapters.length - 1,
      );
      setCurrent((prev) => (prev === i ? prev : i));
    };
    root.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      io.disconnect();
      root.removeEventListener("scroll", onScroll);
    };
  }, [chapters.length]);

  /**
   * Tick the first-steps checklist the first time a chapter actually plays.
   * On play rather than on open, because a checked box someone did not earn
   * is worse than an unchecked one.
   */
  const played = useRef(false);
  useEffect(() => {
    played.current = false;
  }, [audience]);

  const markStarted = useCallback(() => {
    if (played.current) return;
    played.current = true;
    void createClient()
      .auth.updateUser({ data: { [tutorialProgressKey(audience)]: true } })
      .catch(() => {});
  }, [audience]);

  const goTo = useCallback((i: number) => {
    setCurrent(i);
    cardRefs.current[i]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "start",
    });
  }, []);

  const chapter = chapters[current];

  return (
    <>
      {/* ------------------------------------------- mobile: the whole screen */}
      {/* Above the app's own bars (both are z-50) so the player is the page.
          zIndex inline rather than a class: this one cannot afford to be a
          utility Tailwind happened not to generate. */}
      <div
        style={{ zIndex: 55 }}
        className="fixed inset-0 bg-black lg:hidden"
      >
        <div
          ref={deckRef}
          className="flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {chapters.map((c, i) => (
            <div
              key={c.slug}
              ref={(el) => {
                if (el) cardRefs.current[i] = el;
              }}
              className="h-full w-screen shrink-0 snap-center"
            >
              <ChapterVideo
                chapter={c}
                chapterCount={chapters.length}
                src={urls[c.slug]}
                active={i === current}
                near={Math.abs(i - current) === 1}
                fullBleed
                onPlayingChange={i === current ? setPlaying : undefined}
                onFirstPlay={markStarted}
                loadFailed={urlLoad.status === "failed"}
                onRetry={loadURLs}
              />
            </div>
          ))}
        </div>

        {/* Everything below floats on the picture, and clears out while it is
            playing — the native scrubber lives along the bottom edge, exactly
            where the directory would otherwise sit. */}
        <div
          className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${
            playing ? "opacity-0" : "opacity-100"
          }`}
        >
          <Link
            href={learnHref}
            aria-label="Back to how-to guides"
            className="pointer-events-auto absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-colors hover:text-cyan-glow"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
            </svg>
          </Link>

          <div className="pointer-events-auto absolute right-4 top-4">
            <LearnAudienceSwitch
              audience={audience}
              activeWorkspace={activeWorkspace}
              canSwitch={canSwitch}
              basePath="/learn/videos"
              className="mt-0 border-white/15 bg-black/50 backdrop-blur"
            />
          </div>

          {/* env() rather than a utility: the home indicator's height is only
              known to the device, and a directory under it is unreachable. */}
          <div
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
            className="pointer-events-auto absolute inset-x-0 bottom-0"
          >
            <ChapterDirectory
              chapters={chapters}
              current={current}
              onPick={goTo}
              overlay
            />
          </div>
        </div>
      </div>

      {/* ------------------------------------------------- desktop: windowed */}
      <div className="hidden justify-center gap-6 lg:flex lg:items-start">
        {/* No width here. The player sizes itself to DESK_W from its height
            and aspect ratio; pinning the column too makes the video's own
            max-width circular against a shrink-to-fit parent. */}
        <div className="shrink-0">
          <ChapterVideo
            key={chapter.slug}
            chapter={chapter}
            chapterCount={chapters.length}
            src={urls[chapter.slug]}
            active
            boxHeight={DESK_H}
            onFirstPlay={markStarted}
            loadFailed={urlLoad.status === "failed"}
            onRetry={loadURLs}
          />
        </div>

        {/* Same width and height as the player, so the two read as a matched
            pair rather than a video with a sidebar bolted on. */}
        <div
          style={{ width: DESK_W, height: DESK_H }}
          className="flex shrink-0 flex-col"
        >
          <p className="mb-2 px-1 text-xs tabular-nums text-zinc-500">
            {chapters.length} chapters · {Math.round(totalSeconds / 60)} min
          </p>
          <ol className="min-h-0 flex-1 divide-y divide-edge/60 overflow-y-auto rounded-2xl border border-edge bg-surface [scrollbar-width:thin]">
            {chapters.map((c, i) => (
              <li key={c.slug}>
                <button
                  type="button"
                  onClick={() => setCurrent(i)}
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
                    <span className="block truncate text-xs text-zinc-500">
                      {c.blurb}
                    </span>
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
    </>
  );
}
