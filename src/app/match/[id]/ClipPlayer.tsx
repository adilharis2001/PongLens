"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { tapZone } from "./tapZone";
import { SpeedMenu } from "./SpeedMenu";
import { GesturesButton } from "./GesturesSheet";
import { ROTATED_BOX_STYLE, useVideoFullscreen } from "./useVideoFullscreen";

/** Pinch zoom ceiling. */
const MAX_ZOOM = 4;
// Zoom persists across point navigation (module-scoped): if the user
// zoomed, the camera was too far for the WHOLE recording — every clip
// benefits. The 1x pill or snap-back are the only resets.
const persistedZoom = { scale: 1, tx: 0, ty: 0 };
// Speed persists the same way — slow motion chosen for one rally is a
// choice about the footage, not the clip. Same rates as the match player.
let persistedSpeed = 1;

/** "7:24" / "1:07:24" — the shape every phone shows a video length in. */
function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const t = Math.floor(seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * The picture's box inside this component, plus how far its own chrome
 * reaches up from the bottom. Handed to `overlay` so a caller can place
 * something against the FRAME rather than the element — see
 * scoreBugPlacement, which is the rule the match player already uses.
 *
 * The two floors are this player's own transport: the cut view carries a
 * real one with a clock and a draggable track (52 matches what the match
 * player reserves for its own), a clip carries a 3px hairline.
 */
export interface PictureBox {
  left: number;
  top: number;
  width: number;
  height: number;
  bottomGap: number;
  chromeFloor: number;
}
const CUT_CHROME_FLOOR = 52;
const CLIP_CHROME_FLOOR = 16;

/** Released below this scale → snap back to exactly 1. */
const SNAP_ZOOM = 1.05;
/** Pointer travel (px) beyond which a press stops counting as a tap. */
const TAP_SLOP = 8;
/** Press-and-hold rates, same as the match player: left half slows,
 *  right half speeds up, release restores. Armed during playback at any
 *  zoom — a STILL press is unambiguous even zoomed in; the moment the
 *  finger travels, the hold cancels and the drag is a pan again. */
const HOLD_MS = 250;
const HOLD_SLOW = 0.25;
const HOLD_FAST = 2;
/** Double-tap seek, the step and the window. Same ±10s every phone uses. */
const SEEK_STEP_S = 10;
const DOUBLE_TAP_MS = 280;
/**
 * The gesture is invisible, so it has to be shown once. Both halves light
 * up for a moment when playback starts, then clear out — an overlay that
 * outstays the picture is worse than no overlay.
 *
 * It retires itself two ways: the moment anyone actually double-taps, and
 * after LEARN_SHOWS openings for anyone who never does. Neither the video
 * nor the account decides it; the person does, once, on this device.
 */
const HINT_KEY = "ponglens:seek-hint";
const HINT_MS = 2200;
const LEARN_SHOWS = 3;

function hintState(): { shows: number; used: boolean } {
  try {
    const raw = window.localStorage.getItem(HINT_KEY);
    if (!raw) return { shows: 0, used: false };
    const v = JSON.parse(raw);
    return { shows: Number(v?.shows) || 0, used: v?.used === true };
  } catch {
    // Private mode, or a value someone else wrote. Teaching twice is a
    // far smaller failure than throwing inside a play handler.
    return { shows: 0, used: false };
  }
}

function writeHintState(next: { shows: number; used: boolean }) {
  try {
    window.localStorage.setItem(HINT_KEY, JSON.stringify(next));
  } catch {
    // Nothing to do, and nothing worth breaking playback over.
  }
}

/**
 * Player for point clips in the detail view AND for a whole unprocessed
 * upload (mode="cut"). No native controls — the iOS chrome is pure noise
 * on a clip, and on a raw upload it is a different player from the one the
 * rest of the app uses. Autoplays on open and on prev/next navigation in
 * clip mode, plays the rally twice, then rests on the first frame; a cut
 * starts paused and plays straight through. Tap to play/pause; DOUBLE-tap
 * the left or right half to jump ±10s; a draggable transport with a clock
 * on a cut, a hairline tap-to-seek bar on a clip;
 * small speaker toggle when muted autoplay was needed; speed + zoom
 * buttons bottom-right (the match player's transport pair — both choices
 * persist across clips). Timing fixes live in the Modify modal, not here.
 *
 * Pinch to zoom (1x–4x, anchored at the pinch midpoint) with one-finger
 * pan while zoomed — for judging edge balls on far camera angles. The
 * transform lives on the <video> only; the overlays (mute, progress, play
 * glyph, 1x pill) are unscaled siblings. Zoom survives play/pause and
 * scrubbing but resets when the clip (point) changes.
 */
export function ClipPlayer({
  src,
  videoElRef,
  mode = "clip",
  startPaused = false,
  onTime,
  onLoadedMetadata,
  onMediaError,
  onReplay,
  onStepPoint,
  onEnded,
  onClose,
  overlay,
  fill = false,
  readPixels = true,
  landscape = false,
  tall = false,
  speedRef,
}: {
  src: string;
  /** Exposes the <video> element so the point view can capture the
   *  on-screen frame for annotation (Player.captureFrame rationale). */
  videoElRef?: React.MutableRefObject<HTMLVideoElement | null>;
  /** "clip" (default): autoplays and plays the rally twice — the point
   *  detail behavior. "cut": a full match video — starts paused, plays
   *  straight through, never restarts itself. Gestures are identical. */
  mode?: "clip" | "cut";
  /** Every timeupdate, for point tracking in the cut view. */
  onTime?: (el: HTMLVideoElement) => void;
  /** Metadata arrived. A cut starts paused, so timeupdate may never fire
   *  and a caller waiting for the duration would wait forever. */
  onLoadedMetadata?: (el: HTMLVideoElement) => void;
  /** The media failed after the CORS retry — the owner may hold an
   *  expired signed URL and want to mint a fresh one. */
  onMediaError?: () => void;
  /** Restart whatever the owner considers "this point". Only the caller
   *  knows where a point begins in cut mode, so the button is theirs to
   *  wire; it sits in the transport cluster so the spacing stays right. */
  onReplay?: () => void;
  /** Walk to the neighbouring point, when the caller has a sequence to
   *  walk. Given this, the double tap navigates POINTS in thirds — outer
   *  two step, middle replays — instead of nudging ten seconds. On a six
   *  second rally ten seconds is the whole clip and then some, so the
   *  nudge only makes sense where there is nowhere else to go. Same
   *  arrangement the shared starred viewer uses. */
  onStepPoint?: (delta: -1 | 1) => void;
  /**
   * The clip finished. Given this, the host owns what happens next and
   * the built-in "play a rally twice" loop stands down — a sequence
   * viewer that advances on 'ended' must not watch each clip twice on
   * the way through.
   */
  onEnded?: () => void;
  /**
   * A way out, drawn top-right inside the player. Hosts with their own
   * chrome around the player do not need it — but chrome OUTSIDE the
   * player is covered by the rotated landscape box, so anything that has
   * to stay reachable sideways belongs in here.
   */
  onClose?: () => void;
  /**
   * Drawn over the PICTURE, in the chrome layer: above the video, below
   * the controls, and outside the zoom transform so it neither scales nor
   * pans with a pinch. Positioned against the picture's own box rather
   * than this component's, so a letterboxed video puts it on the frame
   * and not in the black band beside it. The share page's score bug is
   * the reason this exists — it used to be a sibling of the player and
   * got left behind the moment the player went full screen.
   *
   * A render prop, not a node: the score bug sizes itself as a share of
   * the picture's height (so it is the same panel on a phone and on a
   * desktop) and places itself against the picture's edges, and both are
   * things only this component can measure. Called with the picture's box
   * once it is known.
   */
  overlay?: (picture: PictureBox) => React.ReactNode;
  /** Fill the host box (a full-screen takeover) instead of capping the
   *  picture's height. `tall` raises the cap; this removes it. */
  fill?: boolean;
  /**
   * Will anything read the frame's pixels (annotation)? If so the element
   * asks for CORS, and a one-time retry drops the attribute when the
   * bucket refuses. A surface that only ever WATCHES should say false:
   * R2's presigned URLs carry no Access-Control-Allow-Origin, so asking
   * costs a failed request and a reload on every single load, to buy a
   * capability that surface does not have.
   */
  readPixels?: boolean;
  /**
   * Offer the expand button: real element fullscreen with a landscape
   * orientation lock, or the rotated overlay on iPhone Safari. See
   * useVideoFullscreen — this is the match player's own implementation,
   * lifted.
   *
   * Opt-in because it does not suit every host. A rally in the point
   * sheet is six seconds inside a scrollable sheet, where taking over the
   * screen is more disruptive than the clip is long. A whole match — the
   * unprocessed view, the coach's workspace, a shared link — is exactly
   * what a landscape view is for.
   */
  landscape?: boolean;
  /** Filled with a press-and-hold rate control so the owner can drive
   *  speed from its own keyboard handler, without a second copy of the
   *  guards that keep shortcuts out of text fields. */
  speedRef?: React.MutableRefObject<{
    hold: (target: number) => void;
    release: () => void;
  } | null>;
  /** Lift the desktop height cap. Width alone does not make a 16:9 picture
   *  bigger: past 52vh the box just grows black bars either side, so a
   *  full-width layout has to raise the ceiling too. */
  tall?: boolean;
  /** Skip the autoplay for THIS mount only — for a clip that is on screen
   *  because a page opened, not because anyone chose it. Every later clip
   *  change in the same mount autoplays as usual. */
  startPaused?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Consumed by the first src effect and never set again, so only the
  // clip that was on screen at mount is held back.
  const startPausedRef = useRef(startPaused);
  const [paused, setPaused] = useState(true);
  /**
   * Has this video ever started? It gates the big centre play glyph in
   * cut mode.
   *
   * The glyph is a POSTER affordance — it says "this is a video, press
   * it" on a still frame nobody has touched yet. Left on for every pause
   * it became a flash: the first tap of a double tap pauses, the second
   * resumes, so a viewer aiming for "next point" saw a play button strobe
   * in the middle of the picture. The match player has no glyph at all
   * for exactly this reason; it can afford that because its poster is a
   * separate render with its own affordance, and this component's poster
   * is the same element. So: poster yes, pause no — and the transport
   * carries a real play/pause button, as the match player's does.
   */
  const [everPlayed, setEverPlayed] = useState(false);
  const [muted, setMuted] = useState(false);
  // Readable pixels for annotation; a CORS regression retries once
  // without crossOrigin so the clip always plays (drawing degrades).
  const [corsOff, setCorsOff] = useState(false);
  const [progress, setProgress] = useState(0);
  /** Seconds, for the cut transport's clock. A clip does not need one. */
  const [duration, setDuration] = useState(0);
  /** Kept in a ref so the src effect can call it without re-running. */
  const onLoadedMetadataRef = useRef(onLoadedMetadata);
  onLoadedMetadataRef.current = onLoadedMetadata;
  const [scrubbing, setScrubbing] = useState(false);
  /** Brief ±10s flash so a double-tap is visibly acknowledged. */
  const [seekHint, setSeekHint] = useState<"back" | "fwd" | null>(null);
  const seekHintTimer = useRef<number | null>(null);
  /** The one-off "you can double-tap here" overlay. */
  const [learnHint, setLearnHint] = useState(false);
  const learnTimer = useRef<number | null>(null);
  const learnShownRef = useRef(false);
  const [zoomed, setZoomed] = useState(persistedZoom.scale > 1);
  const [zoomScale, setZoomScale] = useState(persistedZoom.scale);
  const playsRef = useRef(0);
  // Muting is only ever a fallback to satisfy autoplay policy; the first
  // user gesture that starts playback lifts it.
  const autoMuted = useRef(false);

  /**
   * The PICTURE's box inside this component, when an overlay needs one.
   *
   * A <video> is a letterbox: `object-fit: contain` paints the frame
   * inside the element and fills whatever is left over with black. Pin an
   * overlay to the element's bottom-left and on a 16:9 file in a portrait
   * takeover it lands in the black band, forty pixels below the picture.
   * So the frame is measured from videoWidth/videoHeight against the
   * element's own box — the same contain arithmetic the match player does
   * for its score bug — and the overlay is positioned against that.
   *
   * Only measured when there IS an overlay: the three callers that came
   * before this prop pay nothing for it.
   */
  /** Portrait-shot footage: a landscape view can do nothing for it. Set
   *  from the media's own dimensions, not the element's. */
  const [videoPortrait, setVideoPortrait] = useState(false);

  const fs = useVideoFullscreen({ enabled: landscape, videoPortrait });
  const { localPoint, localDims, localFrac } = fs;

  /** The root is BOTH the gesture surface and the element that goes
   *  fullscreen. One node, two refs. */
  const setRoot = useCallback(
    (el: HTMLDivElement | null) => {
      wrapRef.current = el;
      fs.rootRef.current = el;
    },
    [fs.rootRef]
  );

  const wantsOverlay = overlay != null;
  const [picture, setPicture] = useState<PictureBox | null>(null);

  const measurePicture = useCallback(() => {
    if (!wantsOverlay) return;
    const v = videoRef.current;
    const wrap = wrapRef.current;
    if (!v || !wrap) return;
    const { videoWidth: vw, videoHeight: vh } = v;
    const cw = v.offsetWidth;
    const ch = v.offsetHeight;
    if (!(vw > 0 && vh > 0 && cw > 0 && ch > 0)) return;
    const scale = Math.min(cw / vw, ch / vh);
    const width = vw * scale;
    const height = vh * scale;
    const top = v.offsetTop + (ch - height) / 2;
    setPicture((prev) => {
      const next = {
        left: v.offsetLeft + (cw - width) / 2,
        top,
        width,
        height,
        // The black bar BELOW the picture, measured to the bottom of this
        // component's own box — which is the space an overlay is
        // positioned in. Anchoring to the picture alone cannot express
        // "clear the transport", because the transport is not in the
        // picture.
        bottomGap: Math.max(0, wrap.clientHeight - (top + height)),
        chromeFloor: mode === "cut" ? CUT_CHROME_FLOOR : CLIP_CHROME_FLOOR,
      };
      // Object identity drives a re-render of the overlay's host, and a
      // ResizeObserver fires plenty of no-op ticks.
      return prev
        && Math.abs(prev.left - next.left) < 0.5
        && Math.abs(prev.top - next.top) < 0.5
        && Math.abs(prev.width - next.width) < 0.5
        && Math.abs(prev.height - next.height) < 0.5
        && Math.abs(prev.bottomGap - next.bottomGap) < 0.5
        && prev.chromeFloor === next.chromeFloor
        ? prev
        : next;
    });
  }, [wantsOverlay, mode]);

  useEffect(() => {
    if (!wantsOverlay) return;
    const v = videoRef.current;
    const wrap = wrapRef.current;
    if (!v || !wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measurePicture);
    ro.observe(v);
    ro.observe(wrap);
    measurePicture();
    return () => ro.disconnect();
  }, [wantsOverlay, measurePicture, fill]);

  // ---- zoom/pan gesture state -------------------------------------------
  // The transform is applied imperatively (element.style) during gestures
  // so pointermove never waits on a React render. `zoomed` is the only
  // piece React needs (1x pill, touch-action, sheet-swipe exclusion).
  const tRef = useRef({ ...persistedZoom });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    /** The root's rect, read ONCE when the gesture starts. Every pointer
     *  coordinate is resolved against it, so a pinch does not force a
     *  layout read per move event — and every event in one gesture is
     *  measured against the same box even if something reflows mid-drag. */
    rect: DOMRect;
    downX: number;
    downY: number;
    moved: boolean;
    pinched: boolean;
    /** a press-and-hold rate fired during this press */
    held: boolean;
    /** pan anchor: last position of the single active pointer */
    lastX: number;
    lastY: number;
    /** pinch anchors, captured when the second finger lands */
    startDist: number;
    startScale: number;
    startTx: number;
    startTy: number;
    startMidX: number;
    startMidY: number;
  } | null>(null);

  const applyTransform = useCallback((animate: boolean) => {
    const v = videoRef.current;
    if (!v) return;
    const { scale, tx, ty } = tRef.current;
    persistedZoom.scale = scale;
    persistedZoom.tx = tx;
    persistedZoom.ty = ty;
    v.style.transition = animate ? "transform 180ms ease" : "";
    v.style.transform =
      scale === 1 && tx === 0 && ty === 0
        ? ""
        : `translate(${tx}px, ${ty}px) scale(${scale})`;
    setZoomed(scale > 1);
    setZoomScale(scale);
  }, []);

  /** Keep the (scaled) frame covering the viewport — no gaps at the edges. */
  const clampPan = () => {
    const v = videoRef.current;
    if (!v) return;
    const t = tRef.current;
    const mx = ((t.scale - 1) * v.offsetWidth) / 2;
    const my = ((t.scale - 1) * v.offsetHeight) / 2;
    t.tx = Math.min(mx, Math.max(-mx, t.tx));
    t.ty = Math.min(my, Math.max(-my, t.ty));
  };

  const resetZoom = useCallback(
    (animate: boolean) => {
      tRef.current = { scale: 1, tx: 0, ty: 0 };
      applyTransform(animate);
    },
    [applyTransform]
  );

  // Button zoom (same ×1.5 steps as the match player's transport): pinch
  // is invisible, and on desktop there is nothing to pinch with. Scales
  // about the frame center, so the pan offset scales along.
  const zoomBy = useCallback(
    (f: number) => {
      const t = tRef.current;
      const s = Math.min(MAX_ZOOM, Math.max(1, t.scale * f));
      const k = s / t.scale;
      t.scale = s;
      t.tx *= k;
      t.ty *= k;
      if (s <= SNAP_ZOOM) {
        t.scale = 1;
        t.tx = 0;
        t.ty = 0;
      }
      clampPan();
      applyTransform(true);
    },
    [applyTransform]
  );

  // Playback rate: applied on mount (persisted choice) and on change.
  const [speed, setSpeedState] = useState(persistedSpeed);
  const setSpeed = useCallback((v: number) => {
    persistedSpeed = v;
    setSpeedState(v);
    const el = videoRef.current;
    if (el) el.playbackRate = v;
  }, []);

  // Hand the owner a press-and-hold rate control, the same way seekRef
  // hands one back for jumping points — and the same shape as the hold
  // gesture on the picture: the rate lasts exactly as long as the press.
  // It restores whatever was set before rather than assuming 1x, so a
  // coach reviewing at half speed gets half speed back. Going through
  // here also keeps the pill honest; setting playbackRate on the element
  // would change the video and not the label.
  const heldFrom = useRef<number | null>(null);
  if (speedRef) {
    speedRef.current = {
      hold: (target: number) => {
        if (heldFrom.current !== null) return; // key repeat
        heldFrom.current = speed;
        setSpeed(target);
      },
      release: () => {
        if (heldFrom.current === null) return;
        setSpeed(heldFrom.current);
        heldFrom.current = null;
      },
    };
  }

  // Press-and-hold rate (match-player parity). holdRate drives the pill;
  // the timer arms on a still, single-finger press during 1x playback.
  const [holdRate, setHoldRate] = useState<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    const v = videoRef.current;
    if (v) v.playbackRate = persistedSpeed;
    setHoldRate(null);
  }, []);

  useEffect(() => {
    playsRef.current = 0;
    setProgress(0);
    // New point, same framing: gestures reset but the ZOOM carries over
    // (persistedZoom) — re-apply it to the fresh <video> element.
    pointers.current.clear();
    gesture.current = null;
    applyTransform(false);
    const v = videoRef.current;
    if (!v) return;

    /**
     * Duration, read rather than awaited.
     *
     * A <video> whose src is set in the same commit can reach readyState 4
     * before React has finished attaching props, and loadedmetadata does
     * not bubble or replay — so the handler below it is simply never
     * called and the transport's clock sits at 0:00 forever. Observed at
     * readyState 4 with duration 12.16 already available. Ask the element
     * what it knows, and keep the listener for the case where it does not
     * know yet.
     */
    const readDuration = () => {
      const d = v.duration;
      if (Number.isFinite(d) && d > 0) {
        setDuration(d);
        onLoadedMetadataRef.current?.(v);
      }
    };
    if (v.readyState >= 1) readDuration();
    v.addEventListener("loadedmetadata", readDuration);

    v.muted = false;
    setMuted(false);
    v.playbackRate = persistedSpeed;
    // A full cut waits for the coach; a clip is here to be watched now.
    //
    // Except on the very first render of a page. Opening a match on
    // desktop selects point 1, which meant the page loaded playing, with
    // sound, before anyone had asked for anything. Choosing a point is a
    // request to see it; arriving on a page is not.
    if (mode === "cut" || startPausedRef.current) {
      startPausedRef.current = false;
      setPaused(true);
      return () => v.removeEventListener("loadedmetadata", readDuration);
    }
    v.play().catch(() => {
      // Autoplay with sound refused (fresh iOS page load): retry muted.
      v.muted = true;
      autoMuted.current = true;
      setMuted(true);
      v.play().catch(() => setPaused(true));
    });
    return () => v.removeEventListener("loadedmetadata", readDuration);
  }, [src, applyTransform, mode]);

  // React's touch listeners are passive, so scroll prevention during an
  // active pinch (or a pan while zoomed) needs a native non-passive hook —
  // otherwise the browser claims the gesture for sheet scrolling and fires
  // pointercancel mid-pinch. Single-finger touches at 1x are left alone.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (
        pointers.current.size >= 2 ||
        (pointers.current.size === 1 && tRef.current.scale > 1)
      ) {
        e.preventDefault();
      }
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, []);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (autoMuted.current) {
        v.muted = false;
        autoMuted.current = false;
        setMuted(false);
      }
      playsRef.current = 0;
      void v.play().catch(() => setPaused(true));
    } else {
      v.pause();
    }
  }, []);

  /**
   * Double-tap the left or right half to jump ±10s — the gesture every
   * video app on a phone has trained people to expect, and the one thing
   * the match player had that this did not. In "cut" mode it is the main
   * way to move through a long recording without aiming at a 4px bar.
   */
  const lastTapAt = useRef(0);
  // Read the callbacks through refs: endPointer is a plain function
  // recreated every render, and closing over the props directly would make
  // a stale one fire after a fast re-render mid-gesture.
  const onStepPointRef = useRef(onStepPoint);
  onStepPointRef.current = onStepPoint;
  const onReplayRef = useRef(onReplay);
  onReplayRef.current = onReplay;
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  /** Drop the teaching overlay, and stop offering it from now on. */
  const retireLearnHint = useCallback(() => {
    if (learnTimer.current) window.clearTimeout(learnTimer.current);
    setLearnHint(false);
    const s = hintState();
    if (!s.used) writeHintState({ shows: s.shows, used: true });
  }, []);

  const seekBy = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.duration)) return;
      v.currentTime = Math.min(
        Math.max(0, v.currentTime + delta),
        Math.max(0, v.duration - 0.05)
      );
      // They have the gesture. Nothing left to teach.
      retireLearnHint();
      setSeekHint(delta > 0 ? "fwd" : "back");
      if (seekHintTimer.current) window.clearTimeout(seekHintTimer.current);
      seekHintTimer.current = window.setTimeout(() => setSeekHint(null), 700);
    },
    [retireLearnHint]
  );

  /**
   * Show it once playback starts, not on the idle frame: idle already has
   * a play button in the middle of the picture, and a hint nobody can use
   * yet is just clutter over it.
   */
  const maybeTeachSeek = useCallback(() => {
    if (learnShownRef.current) return;
    learnShownRef.current = true;
    const s = hintState();
    if (s.used || s.shows >= LEARN_SHOWS) return;
    writeHintState({ shows: s.shows + 1, used: false });
    setLearnHint(true);
    if (learnTimer.current) window.clearTimeout(learnTimer.current);
    learnTimer.current = window.setTimeout(() => setLearnHint(false), HINT_MS);
  }, []);

  useEffect(
    () => () => {
      if (learnTimer.current) window.clearTimeout(learnTimer.current);
      if (seekHintTimer.current) window.clearTimeout(seekHintTimer.current);
    },
    []
  );

  /** Along the track's LOCAL axis: in the rotated landscape mode the bar
   *  runs down the physical screen, so the finger's y is the bar's x. */
  const seekToPoint = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.duration)) return;
      const frac = localFrac(clientX, clientY, rect);
      v.currentTime = frac * v.duration;
      setProgress(frac * 100);
    },
    [localFrac]
  );

  const seek = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      seekToPoint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    },
    [seekToPoint]
  );

  /**
   * Press-and-drag scrubbing for the cut transport. A seventeen-minute
   * match cannot be navigated by tapping a line: you need to hold the
   * handle and move. Pointer capture keeps the drag alive when the finger
   * leaves the strip, which on a 4px-tall control is most of the time.
   */
  const trackRef = useRef<HTMLDivElement | null>(null);
  const scrubRef = useRef<DOMRect | null>(null);
  const onScrubDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      scrubRef.current =
        trackRef.current?.getBoundingClientRect() ??
        e.currentTarget.getBoundingClientRect();
      setScrubbing(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // A missed capture only means the drag ends at the strip's edge.
      }
      seekToPoint(e.clientX, e.clientY, scrubRef.current);
    },
    [seekToPoint]
  );
  const onScrubMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!scrubRef.current) return;
      e.stopPropagation();
      seekToPoint(e.clientX, e.clientY, scrubRef.current);
    },
    [seekToPoint]
  );
  const onScrubUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    scrubRef.current = null;
    setScrubbing(false);
  }, []);

  // ---- gesture handlers (on the wrapper: the video and, while paused, ----
  // ---- the glyph overlay both funnel here; small controls opt out) -------

  /**
   * Every pointer coordinate below is in the ROOT'S LOCAL SPACE, converted
   * the moment it arrives (see `local`). Inside the rotated landscape mode
   * the box is turned 90°, so the finger's physical y is the picture's x —
   * converting once at the boundary means the pinch, pan, hold and
   * double-tap maths downstream never has to know. Distances are
   * rotation-invariant, so pinch spread needs no mapping either way.
   */
  const gestureRect = () =>
    gesture.current?.rect ?? wrapRef.current?.getBoundingClientRect() ?? null;

  const local = (clientX: number, clientY: number) => {
    const rect = gestureRect();
    if (!rect) return { x: clientX, y: clientY };
    return localPoint(clientX, clientY, rect);
  };
  /** The root's local width/height — swapped when the box is rotated. */
  const rootDims = () => {
    const rect = gestureRect();
    if (!rect) return { width: 0, height: 0 };
    return localDims(rect);
  };

  /** Anchor a pinch on the current two pointers. */
  const beginPinch = () => {
    const g = gesture.current;
    if (!g || !wrapRef.current || pointers.current.size < 2) return;
    const [a, b] = [...pointers.current.values()];
    const { width, height } = rootDims();
    const t = tRef.current;
    g.startDist = Math.hypot(b.x - a.x, b.y - a.y);
    g.startScale = t.scale;
    g.startTx = t.tx;
    g.startTy = t.ty;
    // Midpoint relative to the root's centre — the transform's origin.
    // The pointers are already local, so there is no rect offset to
    // subtract, only half the local box.
    g.startMidX = (a.x + b.x) / 2 - width / 2;
    g.startMidY = (a.y + b.y) / 2 - height / 2;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Small controls (mute, 1x pill, seek bar) keep their native behavior.
    if ((e.target as HTMLElement).closest("[data-nozoom]")) return;
    if (pointers.current.size >= 2) return; // two fingers is plenty
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events may carry inactive pointer ids; capture is a
      // nicety (keeps pans alive past the edge), not a requirement.
    }
    // The first finger of a gesture measures the box; the second reuses
    // that measurement. Reading it through `local()` here would resolve
    // against the PREVIOUS gesture's cached rect, which is stale the
    // moment anything has scrolled or rotated since.
    const first = pointers.current.size === 0;
    const rect = first
      ? (wrapRef.current?.getBoundingClientRect() ?? null)
      : (gesture.current?.rect ?? null);
    if (!rect) return;
    const p = localPoint(e.clientX, e.clientY, rect);
    pointers.current.set(e.pointerId, { x: p.x, y: p.y });
    if (first) {
      gesture.current = {
        rect,
        downX: p.x,
        downY: p.y,
        moved: false,
        pinched: false,
        held: false,
        lastX: p.x,
        lastY: p.y,
        startDist: 0,
        startScale: 1,
        startTx: 0,
        startTy: 0,
        startMidX: 0,
        startMidY: 0,
      };
      // Arm the hold: a still press during playback becomes slow-mo
      // (left half) or fast-forward (right half) until release. Works
      // zoomed too — movement cancels it into a pan (onPointerMove).
      if (!videoRef.current?.paused) {
        holdTimer.current = setTimeout(() => {
          const g = gesture.current;
          const wrap = wrapRef.current;
          const v = videoRef.current;
          if (
            !g ||
            g.moved ||
            g.pinched ||
            pointers.current.size !== 1 ||
            !wrap ||
            !v ||
            v.paused
          ) {
            return;
          }
          // downX is already local, so this is simply "past the middle of
          // the picture" in whichever direction the box is facing.
          const rate = g.downX > rootDims().width / 2 ? HOLD_FAST : HOLD_SLOW;
          g.held = true;
          v.playbackRate = rate;
          setHoldRate(rate);
        }, HOLD_MS);
      }
    } else {
      // Second finger: this is a pinch, never a tap (and never a hold).
      if (gesture.current) gesture.current.pinched = true;
      endHold();
      beginPinch();
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, { x: p.x, y: p.y });
    const g = gesture.current;
    if (!g) return;
    const t = tRef.current;
    if (pointers.current.size >= 2) {
      // Pinch: scale about the moving midpoint. The content point that sat
      // under the start-midpoint stays under the current midpoint:
      //   t' = mid − (mid₀ − t₀)·(s'/s₀)
      if (g.startDist > 0 && wrapRef.current) {
        const [a, b] = [...pointers.current.values()];
        const { width, height } = rootDims();
        const midX = (a.x + b.x) / 2 - width / 2;
        const midY = (a.y + b.y) / 2 - height / 2;
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const s = Math.min(
          MAX_ZOOM,
          Math.max(1, (g.startScale * dist) / g.startDist)
        );
        const k = s / g.startScale;
        t.scale = s;
        t.tx = midX - (g.startMidX - g.startTx) * k;
        t.ty = midY - (g.startMidY - g.startTy) * k;
        clampPan();
        applyTransform(false);
      }
    } else if (t.scale > 1) {
      // One-finger pan, only while zoomed. At 1x single-finger drags stay
      // inert — the point sheet already ignores video-origin drags, and we
      // must not start eating them here.
      t.tx += p.x - g.lastX;
      t.ty += p.y - g.lastY;
      clampPan();
      applyTransform(false);
    }
    g.lastX = p.x;
    g.lastY = p.y;
    if (
      Math.abs(p.x - g.downX) > TAP_SLOP ||
      Math.abs(p.y - g.downY) > TAP_SLOP
    ) {
      if (!g.moved) {
        g.moved = true;
        // A press that moves is a pan or scrub, not a hold.
        endHold();
      }
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (pointers.current.size === 1) {
      // Pinch → pan handoff: re-anchor on the surviving finger.
      const [p] = [...pointers.current.values()];
      g.lastX = p.x;
      g.lastY = p.y;
      g.startDist = 0;
    } else if (pointers.current.size === 0) {
      const t = tRef.current;
      const held = g.held;
      endHold();
      if (!cancelled && !g.moved && !g.pinched && !held) {
        const now = Date.now();
        if (now - lastTapAt.current < DOUBLE_TAP_MS) {
          // Second tap inside the window: act, and undo the play/pause the
          // first tap already applied so the state is unchanged.
          lastTapAt.current = 0;
          toggle();
          // Both already local: downX was converted on the way in, and
          // rootDims swaps the axes when the box is rotated. Reading
          // offsetWidth or a physical rect here put the thirds on the
          // wrong axis in landscape.
          const w = rootDims().width;
          const x = g.downX;
          if (onStepPointRef.current) {
            const zone = tapZone(x, w);
            if (zone === "prev") onStepPointRef.current(-1);
            else if (zone === "next") onStepPointRef.current(1);
            else onReplayRef.current?.();
          } else {
            // Nowhere to walk to: the gesture stays a ten second nudge on
            // halves, which is the only thing it can usefully do here.
            seekBy(x > w / 2 ? SEEK_STEP_S : -SEEK_STEP_S);
          }
        } else {
          lastTapAt.current = now;
          toggle(); // a clean tap is still play/pause
        }
      } else if (t.scale !== 1 && t.scale < SNAP_ZOOM) {
        resetZoom(true); // barely zoomed: snap back to exactly 1
      }
      gesture.current = null;
    }
  };

  return (
    <div
      ref={setRoot}
      // The callout opt-out lives on the wrapper so the gesture layer over
      // the video inherits it too (see Player.tsx).
      //
      // In the rotated landscape mode this same element becomes a fixed
      // box sized to the rotated viewport and turned 90° — inset-0 is
      // replaced by the explicit box in `style`, and the direction rides
      // in `style` with it, beyond the reach of a stale dev stylesheet.
      className={`relative select-none overflow-hidden [-webkit-touch-callout:none] ${
        fs.fakeLandscape
          ? "fixed z-[90] flex flex-col bg-black"
          : fs.fsActive || fill
            ? "h-full"
            : ""
      }`}
      // While zoomed the finger owns the frame; at 1x defer to the sheet's
      // vertical scrolling like before.
      style={
        fs.fakeLandscape
          ? { ...ROTATED_BOX_STYLE, touchAction: "none" }
          : { touchAction: zoomed ? "none" : "pan-y" }
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPointer(e, false)}
      onPointerCancel={(e) => endPointer(e, true)}
    >
      <video
        ref={(el) => {
          videoRef.current = el;
          if (videoElRef) videoElRef.current = el;
        }}
        src={src}
        playsInline
        preload="metadata"
        crossOrigin={corsOff || !readPixels ? undefined : "anonymous"}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          const d = el.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
          // videoWidth/videoHeight only exist from here on, so this is the
          // first moment the picture's box — or its shape — can be known.
          if (el.videoWidth > 0 && el.videoHeight > 0) {
            setVideoPortrait(el.videoHeight > el.videoWidth);
          }
          measurePicture();
          onLoadedMetadata?.(el);
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onError={() => {
          if (!corsOff) {
            setCorsOff(true);
            const v = videoRef.current;
            if (v) {
              // Drop the attribute NOW: a sync load() would otherwise
              // re-request before React commits the prop change, and the
              // retry races the very failure it exists to dodge.
              v.removeAttribute("crossorigin");
              v.load();
              if (mode !== "cut") {
                void v.play().catch(() => setPaused(true));
              }
            }
          } else {
            onMediaError?.();
          }
        }}
        // Same as the match player: a long press here is a gesture of ours,
        // not an invitation to save the file (see Player.tsx).
        disablePictureInPicture
        controlsList="nodownload noplaybackrate noremoteplayback"
        onContextMenu={(e) => e.preventDefault()}
        onPlay={() => {
          setPaused(false);
          setEverPlayed(true);
          maybeTeachSeek();
        }}
        onPause={() => setPaused(true)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (Number.isFinite(v.duration) && v.duration > 0) {
            setProgress((v.currentTime / v.duration) * 100);
          }
          onTime?.(v);
        }}
        onEnded={(e) => {
          const v = e.currentTarget;
          // A host that handles the end owns it completely — including the
          // "play a rally twice" loop below, which would make a sequence
          // viewer watch every clip through before advancing.
          if (onEndedRef.current) {
            setPaused(true);
            onEndedRef.current();
            return;
          }
          if (mode === "cut") {
            setPaused(true);
            return;
          }
          playsRef.current += 1;
          v.currentTime = 0;
          if (playsRef.current < 2) {
            void v.play().catch(() => setPaused(true));
          } else {
            setPaused(true);
            setProgress(0);
          }
        }}
        className={`w-full select-none bg-black [-webkit-touch-callout:none] ${
          // A height cap is meaningless once the player owns the screen —
          // in either landscape flavour the picture takes the whole box.
          fill || fs.active
            ? "h-full min-h-0 flex-1 object-contain"
            : `max-h-[45vh] ${tall ? "lg:max-h-[70vh]" : "lg:max-h-[52vh]"}`
        }`}
      />
      {/* Over the picture, under the controls, outside the zoom transform.
          The host spans this whole component, NOT the picture: the caller
          is handed the picture's box and places against whichever edge it
          means — the frame for a score bug, the player's own bottom for
          anything that has to clear the transport. Nothing until the frame
          has been measured, because an overlay drawn against a guess is
          worse than one that arrives a frame late. */}
      {overlay && picture && (
        <div className="pointer-events-none absolute inset-0">
          {overlay(picture)}
        </div>
      )}
      {paused && (mode !== "cut" || !everPlayed) && (
        <button
          type="button"
          // Pointer taps are handled by the wrapper's gesture logic (the
          // wrapper captures the pointer, so no click lands here); keep the
          // button for keyboard activation only.
          onClick={(e) => {
            if (e.detail === 0) toggle();
          }}
          // While zoomed this full-bleed overlay must not feed the point
          // sheet's swipe-to-navigate — the drag is a pan. At 1x it keeps
          // its old behavior (sheet swipes work from the paused overlay).
          data-noswipe={zoomed || undefined}
          aria-label="Play"
          className="absolute inset-0 flex items-center justify-center"
        >
          <span className="ks-fade rounded-full bg-ink/60 p-3.5 backdrop-blur-sm">
            <svg
              viewBox="0 0 24 24"
              className="h-7 w-7 text-white"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 5.5v13l11-6.5-11-6.5Z" />
            </svg>
          </span>
        </button>
      )}
      {zoomed && (
        <button
          type="button"
          data-nozoom
          onClick={() => resetZoom(true)}
          aria-label="Reset zoom"
          className="absolute left-2 top-2 rounded-full bg-ink/60 px-2.5 py-1 text-[11px] font-semibold leading-none text-zinc-300 backdrop-blur-sm"
        >
          1x
        </button>
      )}
      {holdRate !== null && (
        <span className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-ink/60 px-2.5 py-1 text-[11px] font-semibold tabular-nums leading-none text-zinc-200 backdrop-blur-sm">
          {holdRate}x
        </span>
      )}
      {/* The gesture, shown once. Both halves at the same time, because
          the point is that the picture is split in two — one arrow would
          read as a button rather than a whole side. It fades on its own
          after a couple of seconds and never blocks a tap: pointer events
          stay with the gesture layer underneath. */}
      {learnHint && (
        <div
          aria-hidden="true"
          className="ks-fade pointer-events-none absolute inset-0"
        >
          <div className="absolute inset-y-0 left-0 right-0 flex items-center justify-between px-5">
            <span className="flex items-center gap-1 rounded-full bg-ink/70 px-3 py-1.5 text-xs font-semibold leading-none text-zinc-100 backdrop-blur-sm">
              <SeekChevrons dir="back" />
              10s
            </span>
            <span className="flex items-center gap-1 rounded-full bg-ink/70 px-3 py-1.5 text-xs font-semibold leading-none text-zinc-100 backdrop-blur-sm">
              10s
              <SeekChevrons dir="fwd" />
            </span>
          </div>
          <span className="absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink/70 px-3 py-1.5 text-xs leading-none text-zinc-200 backdrop-blur-sm">
            Double-tap to skip
          </span>
        </div>
      )}
      {/* A double-tap that only changed currentTime would look like a
          dropped gesture; the flash is the acknowledgement. */}
      {seekHint && (
        <span
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full bg-ink/70 px-3 py-1.5 text-xs font-semibold leading-none text-zinc-100 backdrop-blur-sm ${
            seekHint === "fwd" ? "right-6" : "left-6"
          }`}
        >
          {seekHint === "fwd" ? "+10s" : "-10s"}
        </span>
      )}
      {/* Walk the points, for anyone who would rather press a button than
          learn a double tap. Same size and perch as the match player's:
          h-8 circles hugging the edges, vertically centred. They live
          INSIDE the player so they turn with the rotated landscape box —
          chrome drawn by a host around it does not. */}
      {onStepPoint && (
        <>
          <button
            type="button"
            data-nozoom
            data-noswipe
            onClick={() => onStepPointRef.current?.(-1)}
            aria-label="Previous point"
            className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-ink/60 text-zinc-200 backdrop-blur-sm transition-colors hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            data-nozoom
            data-noswipe
            onClick={() => onStepPointRef.current?.(1)}
            aria-label="Next point"
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-ink/60 text-zinc-200 backdrop-blur-sm transition-colors hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
            </svg>
          </button>
        </>
      )}
      {/* The gestures cheat sheet, top-left, where the match player keeps
          it. Only where the double-tap rows it lists are true — a player
          with nothing to walk to would be describing controls it does not
          have. */}
      {onStepPoint && (
        <GesturesButton
          mode="watch"
          className="absolute left-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-ink/60 text-[13px] font-semibold text-zinc-300 backdrop-blur-sm transition-colors hover:text-white"
        />
      )}
      <div className="absolute right-2 top-2 flex items-center gap-1.5">
      <button
        type="button"
        data-nozoom
        onClick={() => {
          const v = videoRef.current;
          if (!v) return;
          autoMuted.current = false;
          v.muted = !v.muted;
          setMuted(v.muted);
        }}
        aria-label={muted ? "Unmute" : "Mute"}
        className="rounded-full bg-ink/60 p-1.5 text-zinc-300 backdrop-blur-sm"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          {muted ? (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11 5 6 9H3v6h3l5 4V5Zm10 4-6 6m0-6 6 6"
            />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11 5 6 9H3v6h3l5 4V5Zm4.5 2.5a5 5 0 0 1 0 9M18 4.8a8.5 8.5 0 0 1 0 14.4"
            />
          )}
        </svg>
      </button>
      {/* The way out, top-right, where the match player keeps it. In here
          rather than in the host's chrome so it is still reachable in the
          rotated landscape box. */}
      {onClose && (
        <button
          type="button"
          data-nozoom
          data-noswipe
          onClick={onClose}
          aria-label="Close"
          className="rounded-full bg-ink/60 p-1.5 text-zinc-300 backdrop-blur-sm transition-colors hover:text-white"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
      </div>
      {/* speed + zoom, same controls the match player carries on its
          transport — pinch is invisible and desktop has nothing to pinch
          with. Bottom-right, clear of the progress bar's hit area. */}
      <div
        data-nozoom
        data-noswipe
        className={`absolute right-2 flex items-center gap-1 ${
          mode === "cut" ? "bottom-12" : "bottom-4"
        }`}
      >
        {onReplay && (
          <button
            type="button"
            onClick={onReplay}
            aria-label="Replay this point"
            title="Replay this point"
            className="rounded-full bg-ink/60 p-1.5 text-zinc-300 backdrop-blur-sm transition-colors hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8Z" />
            </svg>
          </button>
        )}
        <SpeedMenu
          value={speed}
          onChange={setSpeed}
          className="rounded-full bg-ink/60 px-2.5 py-1.5 text-[11px] font-semibold tabular-nums leading-none text-zinc-300 backdrop-blur-sm"
        />
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.5)}
          disabled={zoomScale <= 1.001}
          aria-label="Zoom out"
          title="Zoom out"
          className="rounded-full bg-ink/60 p-1.5 text-zinc-300 backdrop-blur-sm transition-colors hover:text-white disabled:opacity-30"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.4-3.4M8 11h6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.5)}
          disabled={zoomScale >= MAX_ZOOM - 0.001}
          aria-label="Zoom in"
          title="Zoom in"
          className="rounded-full bg-ink/60 p-1.5 text-zinc-300 backdrop-blur-sm transition-colors hover:text-white disabled:opacity-30"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.4-3.4M8 11h6M11 8v6" />
          </svg>
        </button>
        {/* Landscape, where every video player keeps it — last in the
            cluster, same order as the match player's transport. Hidden
            when it could do nothing: an iPhone with portrait-shot
            footage, where rotating would only pillarbox the picture. */}
        {landscape && fs.useful && (
          <button
            type="button"
            onClick={fs.toggle}
            aria-label={fs.active ? "Exit full screen" : "Full screen"}
            title={fs.active ? "Exit full screen" : "Full screen"}
            className="rounded-full bg-ink/60 p-1.5 text-zinc-300 backdrop-blur-sm transition-colors hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {fs.active ? (
                <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              ) : (
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              )}
            </svg>
          </button>
        )}
      </div>
      {mode === "cut" ? (
        /* A full match needs a real transport. The hairline below is fine
           for a four-second rally — on seventeen minutes it is invisible,
           says nothing about where you are, and cannot be dragged. This is
           the one thing the native controls did better, and dropping it
           was a regression. */
        <div
          data-noswipe
          data-nozoom
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          className="absolute inset-x-0 bottom-0 cursor-pointer touch-none bg-gradient-to-t from-ink/85 to-transparent px-3 pb-2.5 pt-6"
        >
          <div className="flex items-center gap-2.5">
            {/* Play/pause where the match player keeps it: bottom-left of
                the transport. With this here the centre glyph has nothing
                left to do except be a poster. */}
            <button
              type="button"
              data-nozoom
              data-noswipe
              onClick={toggle}
              aria-label={paused ? "Play" : "Pause"}
              className="shrink-0 rounded-full p-1 text-white transition-colors hover:text-white/80"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="currentColor"
                aria-hidden="true"
              >
                {paused ? (
                  <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                ) : (
                  <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
                )}
              </svg>
            </button>
            <span className="w-11 shrink-0 text-[11px] font-medium tabular-nums text-zinc-300">
              {clock((progress / 100) * duration)}
            </span>
            {/* The track is 4px but the row around it is the hit area, so
                a thumb has something to land on. */}
            <div
              ref={trackRef}
              className="relative h-1 flex-1 rounded-full bg-white/20"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-cyan-glow"
                style={{ width: `${progress}%` }}
              />
              <span
                className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-glow shadow-[0_0_8px_rgba(34,211,238,0.6)] transition-[height,width] ${
                  scrubbing ? "h-4 w-4" : "h-3 w-3"
                }`}
                style={{ left: `${progress}%` }}
              />
            </div>
            <span className="w-11 shrink-0 text-right text-[11px] font-medium tabular-nums text-zinc-400">
              {clock(duration)}
            </span>
          </div>
        </div>
      ) : (
        <div
          onPointerDown={seek}
          data-noswipe
          data-nozoom
          className="absolute inset-x-0 bottom-0 h-3 cursor-pointer"
        >
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
            <div
              className="h-full bg-cyan-glow/80"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** The double-chevron every phone uses for a fixed-step skip. */
function SeekChevrons({ dir }: { dir: "back" | "fwd" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`h-3.5 w-3.5 ${dir === "back" ? "" : "rotate-180"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 6 11 12l6 6M11 6 5 12l6 6" />
    </svg>
  );
}
