"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Note, Point } from "@/lib/types";
import type { GameEndOverride, MatchScore } from "./gameScore";
import type { MapLabels } from "./PlacementMap";
import { PointDetail } from "./PointDetail";
import { ScoreLine } from "./ScoreLine";
import type { ServeInfo } from "./serving";
import type { Side } from "./sides";

/**
 * Swipe hint, once per SESSION rather than once per lifetime.
 *
 * A single nudge on the very first sheet you ever open is spent in half a
 * second and never returns — by your second visit the sheet looks like a
 * static panel again. A session is the right unit: you get one reminder per
 * sitting, it costs nothing once you've learned it, and it can't nag.
 */
const HINT_KEY = "ponglens:swipe-hint-shown";
/**
 * The flag is written the instant this page load claims the hint, so this
 * module-level latch keeps the claim alive across effect re-runs (React
 * StrictMode remounts would otherwise see the flag and skip the nudge).
 */
let hintClaimed = false;
/** Finger-px → content-px while dragging: follows, but deliberately. */
const FOLLOW = 0.55;
/** Extra resistance when there's no point on that side. */
const EDGE_FOLLOW = 0.2;
/**
 * How much of each neighbour shows at rest, and how much dark channel sits
 * between it and the current point. The two together are the body's own p-4
 * padding, so widening the gap costs the clip nothing — it comes out of the
 * peek, not out of the video.
 *
 * The channel is what separates them. A drop shadow is the reflex here and
 * it is close to useless on a near-black surface; a strip of the PAGE colour
 * reads instantly as "these are two different cards with a gap between
 * them", which is the thing being communicated.
 */
const PEEK_PX = 10;
const PEEK_GAP_PX = 6;

/** One shape in the peek, mirroring one real block. */
interface PeekShape {
  top: number;
  height: number;
  /** Matches the real block, so the two agree on their fill. */
  dark: boolean;
}

/** Where the neighbour's shapes go, measured off the real ones. */
interface PeekMetrics {
  shapes: PeekShape[];
  /** Full width of the real blocks. The neighbour is the same size we are,
   *  so drawing them at their true width means no amount of dragging can
   *  reach the end of one and expose the void behind it. */
  width: number;
}

/**
 * The neighbouring point, bleeding off the edge.
 *
 * This is the only thing on the screen that says "there is another one
 * there" while nothing is moving. The research on mobile carousels is
 * consistent about why the alternatives fail: pagination dots are too small
 * to notice, and arrows read as a TAP affordance rather than a swipe one —
 * which is exactly why the chevrons sitting on the clip never taught this.
 * What works is the illusion of continuity: real structure, cut off by the
 * screen edge, so the eye completes the card that must be over there.
 *
 * It is a skeleton on purpose. Rendering the actual adjacent PointDetail
 * would mean two more <video> elements, two more placement maps and two more
 * note threads for 20px of visible pixels — unaffordable on an older phone.
 * These are a handful of divs that mirror the real layout's vertical rhythm:
 * the dark clip up top, the pill row under it, then the card stack running
 * down the rest of the sheet.
 *
 * We see the RIGHT edge of the left neighbour and the LEFT edge of the right
 * one, so the rounding and borders are mirrored accordingly — the far side
 * of each runs off-screen and gets no border at all.
 */
function NeighbourPeek({
  side,
  metrics,
}: {
  side: "left" | "right";
  metrics: PeekMetrics | null;
}) {
  if (!metrics) return null;
  const isLeft = side === "left";
  // We see the RIGHT edge of the left neighbour and the LEFT edge of the
  // right one, so each shape rounds on the side facing us and runs off the
  // screen on the other, with no border where it is cut.
  const edge = isLeft
    ? "right-0 rounded-r-xl border-y border-r"
    : "left-0 rounded-l-xl border-y border-l";
  return (
    <div
      aria-hidden="true"
      style={{ width: PEEK_PX, [isLeft ? "left" : "right"]: 0 }}
      className="pointer-events-none absolute inset-y-0 sm:hidden"
    >
      {metrics.shapes.map((s, i) => (
        <div
          key={i}
          style={{
            top: s.top,
            height: s.height,
            width: metrics.width,
            // A solid strip of page colour cast toward the current point:
            // the gap, drawn per shape so it never runs past a card into
            // the notes, where there is no card to separate from.
            boxShadow: `${isLeft ? "" : "-"}${PEEK_GAP_PX}px 0 0 0 var(--color-ink)`,
          }}
          className={`absolute border-edge ${edge} ${
            s.dark ? "bg-ink" : "bg-surface-2/40"
          }`}
        />
      ))}
    </div>
  );
}

/**
 * Mobile point view: full-screen sheet wrapping PointDetail.
 * Prev/next: chevrons flanking the clip (via PointDetail's nav prop) and
 * a horizontal swipe on the body — the content follows the finger, commits
 * past a distance/velocity threshold, snaps back otherwise. The header
 * shows the running match line score as of this point, which updates live
 * as outcomes get corrected. Desktop (lg+) uses the split-view pane.
 */
export function PointSheet({
  matchId,
  ownerId,
  point,
  serve,
  notes,
  authorNames,
  userId,
  userSide,
  gameIndex,
  gameEnd,
  onSetGameOverride,
  mapLabels,
  neutral = false,
  onSetUserSide,
  strictness,
  index,
  total,
  score,
  onClose,
  onPrev,
  onNext,
  onPointUpdate,
  onNoteAdded,
  onDelete,
  deleteBefore,
  onSplit,
  onClipEdited,
  onShare,
  onOpenInPlayer,
}: {
  matchId: string;
  ownerId: string;
  point: Point;
  serve: ServeInfo | undefined;
  notes: Note[];
  /** author_id -> display name, forwarded to PointDetail's note thread. */
  authorNames: Map<string, string>;
  userId: string;
  userSide: Side | null;
  gameIndex: number;
  /** Game-boundary walk facts for this point (see PointDetail). */
  gameEnd: { endsHere: boolean; openHere: boolean };
  /** Write this point's game_end_override; resolves false on failure. */
  onSetGameOverride: (v: GameEndOverride) => Promise<boolean>;
  mapLabels: MapLabels;
  /** Neutral / third-party match: names the players in the scorecard (see
   * MatchView's `neutral`). Forwarded to PointDetail. */
  neutral?: boolean;
  /** Owner-only: set matches.user_side from the map's orientation prompt. */
  onSetUserSide?: (side: Side) => void;
  strictness: string;
  index: number; // 0-based position in the (visible) point list
  total: number;
  /** Running match score over visible points up to and including this one. */
  score: MatchScore;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onPointUpdate: (patch: Partial<Point>) => void;
  onNoteAdded: (note: Note) => void;
  onDelete: (point: Point) => void;
  /** Bulk "delete all before this point" (owner, ≥2 earlier points). */
  deleteBefore?: { count: number; onConfirm: () => void };
  onSplit: (newPoint: Point) => void;
  onClipEdited: () => void;
  /** Open the public-link ShareSheet for this point (owner only). */
  onShare?: () => void;
  /** Jump to this point's moment in the full-match Player. */
  onOpenInPlayer?: () => void;
}) {
  const hasPrev = index > 0;
  const hasNext = index < total - 1;

  const bodyRef = useRef<HTMLDivElement | null>(null);
  // The body's horizontal offset plus how it's animating right now.
  const [slide, setSlide] = useState<{ dx: number; anim: string }>({
    dx: 0,
    anim: "none",
  });
  const drag = useRef<{
    x: number;
    y: number;
    /** null until the 8px axis lock decides; only horizontal drags claim. */
    horizontal: boolean | null;
    lastX: number;
    lastT: number;
    /** instantaneous velocity, px/ms, from the latest move sample */
    vx: number;
  } | null>(null);
  // While the commit animation runs, ignore new touches.
  const navLock = useRef(false);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // First sheet-open of the session: after it settles, one gentle
  // horizontal nudge — no text, no overlay. The flag is set the moment the
  // nudge is scheduled so it can never fire twice in a sitting.
  useEffect(() => {
    if (total <= 1) return;
    try {
      if (!hintClaimed) {
        if (sessionStorage.getItem(HINT_KEY)) return;
        sessionStorage.setItem(HINT_KEY, "1");
        hintClaimed = true;
      }
    } catch {
      return;
    }
    const out = window.setTimeout(() => {
      hintClaimed = false;
      setSlide({ dx: -24, anim: "transform 225ms ease-in-out" });
    }, 500);
    const back = window.setTimeout(
      () => setSlide({ dx: 0, anim: "transform 225ms ease-in-out" }),
      725
    );
    return () => {
      window.clearTimeout(out);
      window.clearTimeout(back);
    };
    // mount only: one nudge per lifetime, never re-armed by prop churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Measure the real clip and scorecard so the neighbour's shapes sit at
  // exactly their y. Guessing the offsets drifts the moment a clip is a
  // different aspect or the action row wraps, and a peek that is a few px
  // out reads as a glitch rather than as continuity.
  const [peek, setPeek] = useState<PeekMetrics | null>(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const clip = body.querySelector<HTMLElement>('[data-peek="clip"]');
    if (!clip) {
      setPeek(null);
      return;
    }
    const measure = () => {
      // EVERY marked block, not a guessed pair. The body is a stack of cards
      // with real gaps between them (and a notes section with no card at
      // all), so a peek made of two long shapes disagrees with whatever it
      // happens to sit beside. One shape per real block keeps the two sides
      // starting and ending together at any scroll position.
      const blocks = [
        ...body.querySelectorAll<HTMLElement>("[data-peek]"),
      ].map((el) => ({
        top: el.offsetTop,
        height: el.offsetHeight,
        dark: el.dataset.peek === "clip",
      }));
      setPeek({ shapes: blocks, width: clip.offsetWidth });
    };
    measure();
    // The clip settles after the video reports its aspect, and the card
    // moves whenever the scorecard flow opens a step. Re-measure on both;
    // a few px out reads as a glitch rather than as continuity.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(clip);
    ro.observe(body);
    return () => ro.disconnect();
  }, [point.id]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (navLock.current) return;
    // Never claim drags that start on surfaces where horizontal motion
    // means something else (the clip scrub bar especially).
    const el = e.target as HTMLElement;
    if (el.closest("video, input, textarea, select, audio, [data-noswipe]"))
      return;
    const t = e.touches[0];
    drag.current = {
      x: t.clientX,
      y: t.clientY,
      horizontal: null,
      lastX: t.clientX,
      lastT: performance.now(),
      vx: 0,
    };
  }, []);

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const s = drag.current;
      if (!s) return;
      const t = e.touches[0];
      const moveX = t.clientX - s.x;
      const moveY = t.clientY - s.y;
      if (s.horizontal === null) {
        // SwipeRemoveRow's axis lock: undecided under 8px, then whichever
        // axis leads wins for the rest of the gesture.
        if (Math.abs(moveX) < 8 && Math.abs(moveY) < 8) return;
        s.horizontal = Math.abs(moveX) > Math.abs(moveY);
      }
      if (!s.horizontal) return;
      const now = performance.now();
      if (now > s.lastT) s.vx = (t.clientX - s.lastX) / (now - s.lastT);
      s.lastX = t.clientX;
      s.lastT = now;
      const atEdge = (moveX > 0 && !hasPrev) || (moveX < 0 && !hasNext);
      setSlide({
        dx: moveX * (atEdge ? EDGE_FOLLOW : FOLLOW),
        anim: "none",
      });
    },
    [hasPrev, hasNext]
  );

  /**
   * Slide out, swap, land. Shared by the swipe and by the chevrons, so a tap
   * moves the same way a drag does — otherwise the button teleports and the
   * two controls feel like different features.
   */
  const commitTo = useCallback(
    (dir: -1 | 1) => {
      if (navLock.current) return;
      navLock.current = true;
      const width = bodyRef.current?.clientWidth ?? window.innerWidth;
      setSlide({
        dx: dir * Math.round(width * 0.35),
        anim: "transform 200ms ease",
      });
      const go = dir < 0 ? onNext : onPrev;
      window.setTimeout(() => {
        go();
        // The new point mounts in place: reset without animating back.
        setSlide({ dx: 0, anim: "none" });
        navLock.current = false;
      }, 200);
    },
    [onNext, onPrev]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const s = drag.current;
      drag.current = null;
      if (!s || s.horizontal !== true) return;
      const t = e.changedTouches[0];
      const moveX = t.clientX - s.x;
      const width = bodyRef.current?.clientWidth ?? window.innerWidth;
      const canGo = moveX < 0 ? hasNext : hasPrev;
      // Commit past a quarter of the width, or on a decisive flick.
      const flick =
        Math.abs(s.vx) > 0.5 &&
        Math.sign(s.vx) === Math.sign(moveX) &&
        Math.abs(moveX) > 32;
      if (canGo && (Math.abs(moveX) > width * 0.25 || flick)) {
        commitTo(moveX < 0 ? -1 : 1);
      } else {
        setSlide({ dx: 0, anim: "transform 180ms ease" });
      }
    },
    [hasPrev, hasNext, commitTo]
  );

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      {/* backdrop */}
      <button
        type="button"
        aria-label="Close point view"
        onClick={onClose}
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
      />
      {/* panel: full-screen sheet on mobile, right panel on sm+ */}
      <div className="absolute inset-x-0 bottom-0 top-10 overflow-y-auto overflow-x-hidden rounded-t-2xl border border-edge bg-surface shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[430px] sm:rounded-none sm:border-y-0 sm:border-r-0">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-edge/70 bg-surface/95 px-4 py-3 backdrop-blur">
          <p className="text-sm font-semibold">
            Point {index + 1}
            <span className="ml-2 text-xs font-normal text-zinc-500">
              {index + 1} of {total}
            </span>
          </p>
          <div className="flex min-w-0 items-center gap-3">
            {/* running match line AS OF this point — it tracks live while
                outcomes get corrected below */}
            <ScoreLine
              score={score}
              className="truncate text-xs font-bold tabular-nums tracking-tight"
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        <div
          ref={bodyRef}
          /* No horizontal inset. The peek lives INSIDE the p-4 padding that
             was always here, so it costs the clip nothing — an earlier pass
             added mx-5 for the gutters and quietly took 40px off the video,
             which is the most valuable thing on the screen. */
          className="relative p-4 pb-10"
          style={{
            transform: `translateX(${slide.dx}px)`,
            transition: slide.anim === "none" ? undefined : slide.anim,
            touchAction: "pan-y",
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {hasPrev && <NeighbourPeek side="left" metrics={peek} />}
          {hasNext && <NeighbourPeek side="right" metrics={peek} />}
          <PointDetail
            key={point.id}
            matchId={matchId}
            ownerId={ownerId}
            point={point}
            serve={serve}
            notes={notes}
            authorNames={authorNames}
            userId={userId}
            userSide={userSide}
            gameIndex={gameIndex}
            gameEnd={gameEnd}
            onSetGameOverride={onSetGameOverride}
            mapLabels={mapLabels}
            neutral={neutral}
            onSetUserSide={onSetUserSide}
            strictness={strictness}
            /* The chevrons animate through the same commit as a swipe. */
            nav={{
              hasPrev,
              hasNext,
              onPrev: () => commitTo(1),
              onNext: () => commitTo(-1),
            }}
            onPointUpdate={onPointUpdate}
            onNoteAdded={onNoteAdded}
            onDelete={onDelete}
            deleteBefore={deleteBefore}
            onSplit={onSplit}
            onClipEdited={onClipEdited}
            onShare={onShare}
            onOpenInPlayer={onOpenInPlayer}
          />
        </div>
      </div>
    </div>
  );
}
