"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Landscape, on every surface that shows footage.
 *
 * Two implementations behind one control, lifted verbatim out of
 * Player.tsx where it was written and proved:
 *
 *  - REAL element fullscreen on the host's root where the platform has it
 *    (Android Chrome, desktop, iPad). Browser chrome goes away, every
 *    existing layout keeps working because it is the same element, and on
 *    touch devices we additionally ask for a landscape orientation lock
 *    (granted inside fullscreen on Android; a no-op where it isn't).
 *
 *  - iPhone Safari still has no element fullscreen, so there the button
 *    switches to FAKE landscape: the root stays a fixed overlay but is
 *    sized to the rotated viewport (width 100dvh, height 100dvw) and
 *    turned 90° — the trick every mobile video player uses. Safari's own
 *    chrome stays, which is as far as the platform lets a web page go;
 *    the picture still presents landscape without the viewer touching
 *    their rotation lock.
 *
 * THE TRAP, and the reason localPoint/localDims are part of this hook
 * rather than left to each caller: inside the fake mode the whole box is
 * turned 90°, so physical pointer coordinates must turn with it — what
 * the finger does on the screen's y axis is the picture's x axis. Any
 * gesture that reads clientX/clientY or a getBoundingClientRect() width
 * is wrong there unless it goes through these. Never reach for dvh or
 * physical rect maths inside a rotated box.
 *
 * NOTE: Player.tsx still carries its own inline copy of all of this. It
 * is a 7,000-line file that also holds Keep score, and it is not worth
 * opening for a refactor. This hook is a faithful lift of what is there —
 * when someone is next in that file for another reason, it can adopt this
 * and the duplicate goes away. Until then: change both or neither.
 */

/** The rotated box, when the fake mode is on. Spread onto the root. */
export const ROTATED_BOX_STYLE: React.CSSProperties = {
  top: 0,
  left: 0,
  width: "100dvh",
  height: "100dvw",
  transform: "rotate(90deg) translateY(-100%)",
  transformOrigin: "top left",
};

export interface VideoFullscreen {
  /** Attach to the element that should fill the screen. */
  rootRef: React.MutableRefObject<HTMLDivElement | null>;
  /** Real element fullscreen is active. */
  fsActive: boolean;
  /** The rotated-overlay mode is active (iPhone Safari). */
  fakeLandscape: boolean;
  /** Either flavour is on — the button reads "exit". */
  active: boolean;
  /** Offer the button at all? False when it could do nothing. */
  useful: boolean;
  toggle: () => void;
  /** Force both flavours off — for a host that is closing. */
  exit: () => void;
  /** Physical client coords → the box's LOCAL space. */
  localPoint: (
    clientX: number,
    clientY: number,
    rect: DOMRect
  ) => { x: number; y: number };
  /** A rect's local width/height — swapped when the box is rotated. */
  localDims: (rect: DOMRect) => { width: number; height: number };
  /** 0..1 along a horizontal bar's LOCAL axis (a scrub track). */
  localFrac: (clientX: number, clientY: number, rect: DOMRect) => number;
}

export function useVideoFullscreen({
  enabled = true,
  videoPortrait = false,
}: {
  /** The host is in a state where a landscape view means something.
   *  Turning this off exits both flavours. */
  enabled?: boolean;
  /** Portrait-shot footage. A landscape view can do nothing for it —
   *  rotating only pillarboxes the picture — so it gates the iPhone
   *  rotate button and the Android orientation lock. */
  videoPortrait?: boolean;
} = {}): VideoFullscreen {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [fsActive, setFsActive] = useState(false);
  const [fakeFs, setFakeFs] = useState(false);

  // Viewport orientation as state: the fake mode only rotates while the
  // device is actually portrait (physically landscape it would be
  // rotating AWAY from landscape).
  const [isPortrait, setIsPortrait] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const update = () => setIsPortrait(mq.matches);
    update();
    // Belt and braces: some embedded/emulated environments resize the
    // viewport without firing matchMedia change events. resize always
    // fires, and re-reading the query is free.
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const fsSupported =
    typeof document !== "undefined" &&
    !!(
      document.fullscreenEnabled ||
      (document as Document & { webkitFullscreenEnabled?: boolean })
        .webkitFullscreenEnabled
    );

  const toggle = useCallback(() => {
    const root = rootRef.current;
    if (!fsSupported) {
      setFakeFs((v) => !v);
      return;
    }
    if (!root) return;
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => void;
    };
    const el = root as HTMLDivElement & {
      webkitRequestFullscreen?: () => void;
    };
    const current = document.fullscreenElement ?? doc.webkitFullscreenElement;
    if (current) {
      if (document.exitFullscreen) void document.exitFullscreen();
      else doc.webkitExitFullscreen?.();
      return;
    }
    if (el.requestFullscreen) {
      void el
        .requestFullscreen({ navigationUI: "hide" })
        .catch(() => undefined);
    } else {
      el.webkitRequestFullscreen?.();
    }
    // Phones and tablets: fullscreen for LANDSCAPE footage means
    // landscape — portrait-shot footage stays however the viewer holds
    // the phone. The lock is only grantable inside fullscreen and only on
    // platforms that implement it (Android); everywhere else this rejects
    // and the device's own rotation stays in charge.
    if (window.matchMedia("(pointer: coarse)").matches && !videoPortrait) {
      const so = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      void so.lock?.("landscape").catch(() => undefined);
    }
  }, [fsSupported, videoPortrait]);

  // Mirror the browser's fullscreen state (Esc, the system gesture and
  // our own exits all land here) and release the orientation lock when
  // fullscreen ends — a locked orientation outside fullscreen strands the
  // whole app sideways.
  useEffect(() => {
    const onChange = () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
      };
      const current = document.fullscreenElement ?? doc.webkitFullscreenElement;
      const on = !!current;
      // Whose fullscreen? fullscreenchange is a DOCUMENT event, so every
      // instance of this hook hears every other instance's. Without the
      // identity check a point sheet's player would believe it had gone
      // fullscreen because the match takeover did, and would size its
      // picture accordingly.
      setFsActive(on && current === rootRef.current);
      if (!on) {
        try {
          (
            screen.orientation as ScreenOrientation & { unlock?: () => void }
          ).unlock?.();
        } catch {
          // nothing was locked
        }
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const exit = useCallback(() => {
    setFakeFs(false);
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => void;
    };
    const current = document.fullscreenElement ?? doc.webkitFullscreenElement;
    // Only end fullscreen if THIS player is the one holding it. Several
    // instances of a player can be alive at once — the match page has the
    // takeover and a point sheet mounted together — and an unconditional
    // exit would mean any one of them unmounting drops another out of
    // fullscreen. Player.tsx can skip this check because it is the only
    // one of its kind on a page; a shared hook cannot.
    if (current && current === rootRef.current) {
      if (document.exitFullscreen)
        void document.exitFullscreen().catch(() => undefined);
      else doc.webkitExitFullscreen?.();
    }
  }, []);

  // A host that closes takes both flavours with it. Without this the
  // browser is left in fullscreen over whatever replaced the player, and
  // on Android the orientation lock survives too.
  const exitRef = useRef(exit);
  exitRef.current = exit;
  useEffect(() => {
    if (enabled) return;
    exitRef.current();
  }, [enabled]);
  useEffect(() => () => exitRef.current(), []);

  // The fake mode is only a rotation while the viewport is portrait — and
  // only for landscape footage (see videoPortrait above).
  const fakeLandscape =
    enabled && fakeFs && !fsActive && isPortrait && !videoPortrait;
  // Ref twin for gesture handlers, which are built once and read pointer
  // coordinates that must turn with the rotated box.
  const fakeRef = useRef(false);
  fakeRef.current = fakeLandscape;

  const localPoint = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) =>
      fakeRef.current
        ? { x: clientY - rect.top, y: rect.right - clientX }
        : { x: clientX - rect.left, y: clientY - rect.top },
    []
  );

  const localDims = useCallback(
    (rect: DOMRect) =>
      fakeRef.current
        ? { width: rect.height, height: rect.width }
        : { width: rect.width, height: rect.height },
    []
  );

  const localFrac = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => {
      // Along the bar's LOCAL axis: in the rotated mode the bar runs down
      // the physical screen, so the finger's y is the bar's x.
      const span = fakeRef.current ? rect.height : rect.width;
      if (!(span > 0)) return 0;
      const along = fakeRef.current
        ? clientY - rect.top
        : clientX - rect.left;
      return Math.min(1, Math.max(0, along / span));
    },
    []
  );

  return {
    rootRef,
    fsActive,
    fakeLandscape,
    active: fsActive || fakeLandscape,
    // Offered only where it can do something: real fullscreen wherever the
    // platform has it, and on iPhone only the fake rotation — which
    // portrait footage has no use for.
    useful: fsSupported || !videoPortrait,
    toggle,
    exit,
    localPoint,
    localDims,
    localFrac,
  };
}
