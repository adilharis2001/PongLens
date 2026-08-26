"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ClipPlayer } from "@/app/match/[id]/ClipPlayer";
import type { GameSummary } from "@/app/match/[id]/gameScore";

/**
 * The points a coach cited, on the page instead of behind a button.
 *
 * Somebody paid for this review, and the clips are the part of it that only
 * this coach could have made. The player is ClipPlayer — the same one the
 * point detail view and the coach's workspace use — so the review viewer
 * stops being the one clip surface on the platform with browser chrome
 * painted over the footage. Tap to play, double-tap the sides to step
 * points, hold a half for slow motion or fast forward, pinch to zoom.
 *
 * One clip at a time, swiped on a touch screen (the neighbour peeks in at
 * the edge so the deck reads as a deck) and stepped with the player's own
 * chevrons on a desktop. Nothing autoplays on load: several videos on one
 * page, all deciding to start themselves, is how a page starts shouting.
 * Once someone presses play, though, the reel behaves like a tape — a clip
 * that ends rolls on to the next cited point, and a swipe away from a
 * playing clip starts the one that arrives.
 */

interface ReelPoint {
  point_id: string;
  idx: number;
}

async function signBatch(
  orderId: string,
  pointIds: string[],
): Promise<Record<string, string>> {
  try {
    const res = await fetch("/api/review-media", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId, pointIds }),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { urls?: Record<string, string> };
    return data.urls ?? {};
  } catch {
    return {};
  }
}

/** The running score once this point was played, in the library's colours:
 *  the student's number cyan, the opponent's magenta. */
function ChipScore({ score }: { score: GameSummary }) {
  return (
    <span className="pl-1.5 tabular-nums">
      <span className="text-cyan-glow">{score.you}</span>
      <span className="px-0.5 text-zinc-600">-</span>
      <span className="text-magenta-glow">{score.them}</span>
    </span>
  );
}

export function PointReel({
  orderId,
  points,
  matchId,
  scores,
}: {
  orderId: string;
  points: ReelPoint[];
  /** When set, the reel offers a way through to the full match. */
  matchId?: string | null;
  /** point id -> running game score at that point (runningScoreByPoint).
   *  Absent when the match has no scoring, or the host cannot read the
   *  points — the chips just stay plain. */
  scores?: Record<string, GameSummary>;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const [cur, setCur] = useState(0);
  /** Index open in the phone's full-screen watch view, null when inline.
   *  While it is open the inline players are unmounted: a re-signed URL
   *  makes ClipPlayer autoplay its new src, and two players voicing the
   *  same rally — one of them behind the takeover — is the alternative. */
  const [full, setFull] = useState<number | null>(null);

  const deckRef = useRef<HTMLDivElement | null>(null);
  const slideEls = useRef<Record<string, HTMLDivElement | null>>({});
  const curRef = useRef(0);
  /** ClipPlayer wants stable ref objects (videoElRef / playRef), one pair
   *  per point, however many times this component renders. */
  const videoRefs = useRef(
    new Map<string, React.MutableRefObject<HTMLVideoElement | null>>(),
  );
  const playRefs = useRef(
    new Map<
      string,
      React.MutableRefObject<{ play: () => void; pause: () => void } | null>
    >(),
  );
  /** Clips someone has actually asked to play. A signed URL dying under
   *  one of these earns a re-mint; an idle failure is left alone, because
   *  re-signing on every idle error is a retry loop. */
  const started = useRef(new Set<string>());
  /** One automatic re-mint per watch attempt — the next play gesture
   *  re-arms it. Without the latch a dead bucket loops sign-fail-sign. */
  const reminted = useRef(new Set<string>());
  /** Where the viewer stood when a clip's URL died mid-watch. Recovery
   *  must not cost them their place (the coach workspace's rule). */
  const resume = useRef<
    Record<string, { time: number; wasPlaying: boolean }>
  >({});

  const videoRefFor = (id: string) => {
    let r = videoRefs.current.get(id);
    if (!r) {
      r = { current: null };
      videoRefs.current.set(id, r);
    }
    return r;
  };
  const playRefFor = (id: string) => {
    let r = playRefs.current.get(id);
    if (!r) {
      r = { current: null };
      playRefs.current.set(id, r);
    }
    return r;
  };

  // Signed URLs are short lived by design, so the identity that matters is
  // the list of points, not the array object the parent happened to build.
  const key = points.map((p) => p.point_id).join(",");

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) return;
    let alive = true;
    void signBatch(orderId, ids).then((got) => {
      if (!alive) return;
      setUrls(got);
      setFailed(Object.keys(got).length === 0);
    });
    return () => {
      alive = false;
    };
  }, [orderId, key]);

  // A detached <video> carries on playing, with sound. Every one of them.
  useEffect(() => {
    const refs = videoRefs.current;
    return () => {
      for (const r of refs.values()) r.current?.pause();
    };
  }, []);

  const only = useCallback((pointId: string | null) => {
    for (const [id, r] of videoRefs.current) {
      if (id !== pointId) r.current?.pause();
    }
  }, []);

  const anyPlaying = () => {
    for (const r of videoRefs.current.values()) {
      const v = r.current;
      if (v && !v.paused && !v.ended) return true;
    }
    return false;
  };

  /** Centre slide i in the deck. Rect-based so the peek padding and the
   *  gap between slides never enter the arithmetic. */
  const goTo = useCallback(
    (i: number) => {
      const deck = deckRef.current;
      const slide =
        i >= 0 && i < points.length
          ? slideEls.current[points[i].point_id]
          : null;
      if (!deck || !slide) return;
      const dRect = deck.getBoundingClientRect();
      const sRect = slide.getBoundingClientRect();
      deck.scrollTo({
        left:
          sRect.left -
          dRect.left +
          deck.scrollLeft -
          (dRect.width - sRect.width) / 2,
        behavior: "smooth",
      });
    },
    [points],
  );

  /** Walk to slide i and start it — the double tap, the player's chevrons
   *  and the tape's own advance all arrive here, so stepping a point plays
   *  it, the same as the point sheet and the starred tape. */
  const step = useCallback(
    (i: number) => {
      if (i < 0 || i >= points.length) return;
      goTo(i);
      playRefs.current.get(points[i].point_id)?.current?.play();
    },
    [points, goTo],
  );

  const replay = useCallback((pointId: string) => {
    const v = videoRefs.current.get(pointId)?.current;
    if (v) v.currentTime = 0;
    playRefs.current.get(pointId)?.current?.play();
  }, []);

  /** Walk the takeover to point i. Marking it started (and re-arming its
   *  recovery latch) is what lets a dead URL re-sign itself in there —
   *  the same rule the inline play listener applies. */
  const fullGo = useCallback(
    (i: number) => {
      if (i < 0 || i >= points.length) return;
      const id = points[i].point_id;
      started.current.add(id);
      reminted.current.delete(id);
      setFull(i);
    },
    [points],
  );

  const openFull = useCallback(
    (i: number) => {
      only(null);
      fullGo(i);
    },
    [only, fullGo],
  );

  const closeFull = () => {
    if (full !== null) {
      // The page picks up where the takeover left off: same slide
      // centred, same chip lit.
      curRef.current = full;
      setCur(full);
      const idx = full;
      requestAnimationFrame(() => goTo(idx));
    }
    setFull(null);
  };

  /**
   * The URL that loaded the first frame ten minutes ago will not serve the
   * rest of the clip today. Mint a fresh one; the restore effect below
   * finishes the job by putting the viewer back at the second they lost.
   */
  const recover = useCallback(
    (pointId: string, state?: { time: number; wasPlaying: boolean }) => {
      if (!started.current.has(pointId) || reminted.current.has(pointId)) {
        return;
      }
      reminted.current.add(pointId);
      if (state) resume.current[pointId] = state;
      void signBatch(orderId, [pointId]).then((got) => {
        const fresh = got[pointId];
        if (fresh) setUrls((u) => ({ ...u, [pointId]: fresh }));
      });
    },
    [orderId],
  );

  // A fresh URL after a mid-watch failure: back to where they were.
  // ClipPlayer autoplays a src change in clip mode, so a clip that was
  // PAUSED when its URL died gets paused again, not left running.
  useEffect(() => {
    for (const [id, r] of Object.entries(resume.current)) {
      const v = videoRefs.current.get(id)?.current;
      if (!v || !urls[id]) continue;
      delete resume.current[id];
      const apply = () => {
        v.currentTime = r.time;
        if (!r.wasPlaying) v.pause();
      };
      if (v.readyState >= 1) apply();
      else v.addEventListener("loadedmetadata", apply, { once: true });
    }
  }, [urls]);

  // Whichever clip starts — a tap on it, a tap on a peeking neighbour, or
  // the tape rolling forward — silence the rest, remember it has played,
  // and bring its slide to the middle if it is not there already.
  useEffect(() => {
    const cleanups: (() => void)[] = [];
    points.forEach((p, i) => {
      const v = videoRefs.current.get(p.point_id)?.current;
      if (!v) return;
      const onPlay = () => {
        started.current.add(p.point_id);
        reminted.current.delete(p.point_id);
        only(p.point_id);
        if (curRef.current !== i) goTo(i);
      };
      v.addEventListener("play", onPlay);
      cleanups.push(() => v.removeEventListener("play", onPlay));
    });
    return () => {
      for (const fn of cleanups) fn();
    };
  }, [points, urls, only, goTo]);

  /** Playback follows the swipe — but only once the deck has come to
   *  rest. Playing at every crossing turned a two-slide swipe (or a chip
   *  jump across the deck) into a cascade of hundred-millisecond blips,
   *  one per slide passed. Whether anything WAS playing is read at the
   *  start of the scroll burst, because by the time it settles the
   *  departed clip has already been paused. */
  const carryRef = useRef(false);
  const settleTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    },
    [],
  );

  const onScroll = () => {
    const deck = deckRef.current;
    if (!deck) return;
    if (settleTimer.current === null) carryRef.current = anyPlaying();
    else window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      if (!carryRef.current) return;
      carryRef.current = false;
      playRefs.current
        .get(points[curRef.current]?.point_id ?? "")
        ?.current?.play();
    }, 160);
    const dRect = deck.getBoundingClientRect();
    const mid = dRect.left + dRect.width / 2;
    let best = curRef.current;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const el = slideEls.current[p.point_id];
      if (!el) return;
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - mid);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best === curRef.current) return;
    // Leaving a playing clip silences it at the crossing; the arriving
    // clip starts from the settle timer above.
    curRef.current = best;
    setCur(best);
    only(points[best].point_id);
  };

  if (points.length === 0) return null;

  const many = points.length > 1;

  return (
    <div className="mt-3">
      {/* Full bleed through the card's p-5 on a phone: the picture is the
          point of the page, and forty pixels of padding was a fifth of it. */}
      <div
        ref={deckRef}
        onScroll={many ? onScroll : undefined}
        className={`-mx-5 flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] sm:mx-0 [&::-webkit-scrollbar]:hidden ${
          many ? "gap-2 px-[4%] sm:px-0" : ""
        }`}
      >
        {points.map((p, i) => {
          const url = urls[p.point_id];
          return (
            <div
              key={p.point_id}
              ref={(el) => {
                slideEls.current[p.point_id] = el;
              }}
              className={`shrink-0 snap-center ${
                many ? "w-[92%] sm:w-full" : "w-full"
              }`}
              aria-label={`Point ${p.idx + 1}`}
            >
              {/* The box is a div, always. A <video> has no size until its
                  metadata lands, so sizing one starts at the spec's 300x150
                  and visibly jumps when the file answers. */}
              <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-edge bg-black">
                {url && full === null ? (
                  <ClipPlayer
                    src={url}
                    fill
                    startPaused
                    hostSwipeX
                    quietChrome
                    readPixels={false}
                    videoElRef={videoRefFor(p.point_id)}
                    playRef={playRefFor(p.point_id)}
                    onStepPoint={many ? (d) => step(i + d) : undefined}
                    onReplay={() => replay(p.point_id)}
                    onEnded={() => step(i + 1)}
                    onMediaError={(state) => recover(p.point_id, state)}
                  />
                ) : (
                  <div
                    className={`h-full w-full ${
                      url || failed ? "" : "animate-pulse bg-surface-2/40"
                    }`}
                  />
                )}
                {/* On a phone the slide is a poster: the tap goes to the
                    full-screen watch view instead of playing a clip this
                    small in place. The overlay sits above the player, so
                    its idle glyph shows through and its own controls never
                    fight for the tap. Swiping still moves the deck — a
                    drag on a button scrolls like a drag anywhere else. */}
                {url && (
                  <button
                    type="button"
                    onClick={() => openFull(i)}
                    aria-label={`Watch point ${p.idx + 1} full screen`}
                    className="absolute inset-0 z-10 sm:hidden"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {failed && (
        <p className="mt-2 text-sm text-zinc-400">
          The clips could not be loaded just now. Refreshing usually sorts it.
        </p>
      )}

      {/* The only place a point number is printed, so the reel and the index
          can never disagree about which clip you are looking at. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {many &&
          points.map((p, i) => (
            <button
              key={p.point_id}
              type="button"
              onClick={() => goTo(i)}
              aria-current={i === cur}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                i === cur
                  ? "border-cyan-glow/60 text-cyan-glow"
                  : "border-edge bg-surface-2 text-zinc-300 hover:border-cyan-glow/40"
              }`}
            >
              Point {p.idx + 1}
              {scores?.[p.point_id] && (
                <ChipScore score={scores[p.point_id]} />
              )}
            </button>
          ))}
        {!many && (
          <span className="text-sm text-zinc-400">
            Point {points[0].idx + 1}
            {scores?.[points[0].point_id] && (
              <ChipScore score={scores[points[0].point_id]} />
            )}
          </span>
        )}
        {matchId && (
          <a
            href={`/match/${matchId}?p=${points[cur]?.point_id ?? points[0].point_id}`}
            className="ml-auto text-sm text-zinc-400 transition-colors hover:text-cyan-glow"
          >
            Open in the match
          </a>
        )}
      </div>

      {full !== null &&
        createPortal(
          <ReelTakeover
            points={points}
            urls={urls}
            scores={scores}
            index={full}
            onIndex={fullGo}
            onClose={closeFull}
            onError={(pointId) => recover(pointId, undefined)}
          />,
          document.body,
        )}
    </div>
  );
}

/**
 * The phone's watch view. Inline on a phone the reel's slides are small —
 * a card's width minus its padding minus the peek — which works as a
 * poster and fails as a place to study a serve. Tapping a slide opens
 * this instead: the starred tape's takeover, one ClipPlayer at full
 * chrome, walked with the same double tap and chevrons, rolling to the
 * next cited point on 'ended'. X, Escape, or a vertical swipe outside
 * the picture puts the review page back where it was. Desktop never
 * comes here; its inline picture is already the size this view exists
 * to provide.
 *
 * Portalled to document.body: `position: fixed` resolves against the
 * nearest transformed ancestor, and AppShell's `.page-enter` holds a
 * transform while it animates in — the starred player's lesson.
 */
function ReelTakeover({
  points,
  urls,
  scores,
  index,
  onIndex,
  onClose,
  onError,
}: {
  points: ReelPoint[];
  urls: Record<string, string>;
  scores?: Record<string, GameSummary>;
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onError: (pointId: string) => void;
}) {
  const p = points[index];
  const url = urls[p.point_id];
  const score = scores?.[p.point_id];
  const many = points.length > 1;
  const playerBox = useRef<HTMLDivElement | null>(null);
  /** A vertical swipe on the backdrop closes; one that starts on the
   *  picture belongs to the player's gestures and is left alone. */
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The page behind must not scroll under the takeover.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-ink/97 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (playerBox.current?.contains(e.target as Node)) return;
        drag.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        const dy = e.clientY - d.y;
        const dx = e.clientX - d.x;
        if (Math.abs(dy) > 80 && Math.abs(dy) > 2 * Math.abs(dx)) onClose();
      }}
    >
      <header className="flex shrink-0 items-start justify-between gap-4 px-5 pb-4 pt-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-100">
            Point {p.idx + 1}
            {score && <ChipScore score={score} />}
          </p>
          {many && (
            <p className="mt-0.5 text-xs tabular-nums text-zinc-500">
              {index + 1} of {points.length}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center pb-10">
        <div ref={playerBox} className="w-full overflow-hidden bg-black">
          {url ? (
            <ClipPlayer
              key={p.point_id}
              src={url}
              tall
              landscape
              readPixels={false}
              onStepPoint={
                many
                  ? (d) => {
                      const to = index + d;
                      if (to >= 0 && to < points.length) onIndex(to);
                    }
                  : undefined
              }
              onEnded={() => {
                if (index < points.length - 1) onIndex(index + 1);
              }}
              onMediaError={() => onError(p.point_id)}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center">
              <p className="text-sm text-zinc-600">Loading…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
