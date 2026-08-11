"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DropTarget } from "@/lib/backlog/dragModel";
import type { SectionKey } from "@/lib/backlog/sections";

/**
 * Press and hold to lift a card, then drag it.
 *
 * Pointer events rather than HTML5 drag-and-drop, because HTML5 DnD does
 * not fire on touch at all and this list is used on a phone first.
 *
 * THE THING THAT MAKES IT SMOOTH: a moving finger does not re-render
 * React. Positioning the ghost through React state meant re-running the
 * whole board — sections, readiness, verdict, every card — on every
 * pointermove, and that is what "janky" was. React state now changes only
 * when the drop TARGET changes: a few times per drag rather than sixty
 * times a second.
 *
 * The work is split by what it costs. Moving the ghost is a transform
 * write, which is composited and forces no layout, so it happens on every
 * event and the card stays welded to the finger. Hit-testing the drop
 * target calls elementFromPoint, which does force layout, so it is
 * throttled to one animation frame.
 *
 * Transform, not left/top: left/top would relayout the page under the
 * finger every frame.
 *
 * Touch and mouse start differently. A finger has to hold for HOLD_MS,
 * because on touch a drag and a scroll begin with the same gesture and
 * the list has to stay scrollable; moving more than SCROLL_SLOP before
 * the timer fires is a scroll and the lift is cancelled. A mouse has a
 * wheel and needs no such truce, so it lifts as soon as it moves past
 * MOUSE_SLOP.
 */

const HOLD_MS = 300;
/** Finger travel that cancels a pending lift and lets the page scroll. */
const SCROLL_SLOP = 8;
/** Mouse travel before a press becomes a drag rather than a click. */
const MOUSE_SLOP = 5;
/** Distance from the viewport edge where the page starts scrolling. */
const EDGE = 84;
/** Fastest edge scroll, in px per frame, reached at the very edge. */
const EDGE_MAX = 18;

/** Set once when a card is lifted; never changes during the drag. */
export interface DragState {
  id: string;
  /** Pointer offset inside the card, so the ghost sits where you grabbed. */
  dx: number;
  dy: number;
  width: number;
}

function targetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const item = el.closest<HTMLElement>("[data-drop-item]");
  if (item?.dataset.dropItem) return { kind: "item", id: item.dataset.dropItem };
  const section = el.closest<HTMLElement>("[data-drop-section]");
  if (section?.dataset.dropSection) {
    return {
      kind: "section",
      section: section.dataset.dropSection as SectionKey,
    };
  }
  return null;
}

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === "item" && b.kind === "item"
    ? a.id === b.id
    : a.kind === "section" && b.kind === "section" && a.section === b.section;
}

export function useCardDrag(
  onDrop: (state: DragState, target: DropTarget | null) => void,
) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);

  /** The ghost element, positioned outside React. */
  const ghost = useRef<HTMLElement | null>(null);
  const point = useRef({ x: 0, y: 0 });
  const frame = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const targetRef = useRef<DropTarget | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = useRef<{
    x: number;
    y: number;
    id: string;
    rect: DOMRect;
    touch: boolean;
  } | null>(null);

  /**
   * One write per frame: move the ghost, scroll if we are at an edge, and
   * only tell React when the target actually changed.
   *
   * Held in a ref so it and `schedule` can call each other (an edge
   * scroll has to book the next frame) without either being referenced
   * before it exists.
   */
  const tick = useRef<() => void>(() => {});

  const schedule = useCallback(() => {
    if (frame.current === null) {
      frame.current = requestAnimationFrame(() => tick.current());
    }
  }, []);

  /** Move the ghost. Cheap enough to do on every event: a transform is
   *  composited and forces no layout, and pointermove already arrives at
   *  about display rate. Deferring it to a frame would only add latency
   *  between the finger and the card. */
  const paint = useCallback(() => {
    const state = dragRef.current;
    const el = ghost.current;
    if (!state || !el) return;
    const { x, y } = point.current;
    el.style.transform = `translate3d(${x - state.dx}px, ${y - state.dy}px, 0)`;
  }, []);

  /**
   * The ghost mounts a render AFTER the lift, so the first transform has
   * to be written the instant the element exists. Waiting for a frame is
   * not enough: React may not have committed the portal by then, and the
   * element paints once at its untransformed origin — a card that flashes
   * in the top-left corner of the screen before snapping to the finger.
   */
  const setGhost = useCallback(
    (el: HTMLElement | null) => {
      ghost.current = el;
      if (el) paint();
    },
    [paint],
  );

  tick.current = () => {
    frame.current = null;
    const state = dragRef.current;
    if (!state) return;
    const { y } = point.current;
    paint();

    // Proportional rather than fixed: barely creeps at the edge of the
    // zone and accelerates as the finger closes on the screen edge, which
    // is what makes reaching a far section feel controllable.
    let scroll = 0;
    if (y < EDGE) scroll = -EDGE_MAX * ((EDGE - y) / EDGE);
    else if (y > window.innerHeight - EDGE) {
      scroll = EDGE_MAX * ((y - (window.innerHeight - EDGE)) / EDGE);
    }
    if (scroll !== 0) {
      const before = window.scrollY;
      window.scrollBy(0, scroll);
      // Only keep the frame loop alive while the page can actually still
      // move. At the top or bottom of the document, re-booking a frame
      // that scrolls nothing is a hot loop that does no work.
      if (window.scrollY !== before) schedule();
    }

    const next = targetAt(point.current.x, point.current.y);
    if (!sameTarget(next, targetRef.current)) {
      targetRef.current = next;
      setTarget(next);
    }
  };

  const cancelHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    cancelHold();
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    dragRef.current = null;
    targetRef.current = null;
    press.current = null;
    setDrag(null);
    setTarget(null);
  }, [cancelHold]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent, id: string) => {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest("button[data-no-drag]")) return;

      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const touch = event.pointerType !== "mouse";
      press.current = { x: event.clientX, y: event.clientY, id, rect, touch };
      point.current = { x: event.clientX, y: event.clientY };

      if (!touch) return;
      holdTimer.current = setTimeout(() => {
        const p = press.current;
        if (!p) return;
        const state: DragState = {
          id,
          dx: p.x - p.rect.left,
          dy: p.y - p.rect.top,
          width: p.rect.width,
        };
        dragRef.current = state;
        setDrag(state);
        // A short tap of haptic is what tells a thumb the card came free
        // without having to look. Android honours it; iOS Safari ignores
        // it, which is why it is a bonus and not the only lift cue.
        try {
          navigator.vibrate?.(12);
        } catch {
          /* unsupported: the visual lift carries it */
        }
        schedule();
      }, HOLD_MS);
    },
    [schedule],
  );

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const state = dragRef.current;
      const p = press.current;
      point.current = { x: event.clientX, y: event.clientY };

      if (state) {
        // A lifted card owns the gesture: no scrolling it away underneath.
        event.preventDefault();
        paint();       // follows the finger this event, not next frame
        schedule();    // hit test and edge scroll, at most once a frame
        return;
      }
      if (!p) return;

      const travel = Math.hypot(event.clientX - p.x, event.clientY - p.y);
      if (p.touch) {
        // Moving before the hold completes is a scroll, not a lift.
        if (travel > SCROLL_SLOP) {
          cancelHold();
          press.current = null;
        }
        return;
      }
      if (travel > MOUSE_SLOP) {
        const lifted: DragState = {
          id: p.id,
          dx: p.x - p.rect.left,
          dy: p.y - p.rect.top,
          width: p.rect.width,
        };
        dragRef.current = lifted;
        setDrag(lifted);
        schedule();
      }
    };

    const up = () => {
      const state = dragRef.current;
      if (state) {
        // Resolve the target from where the finger actually LEFT, not
        // from the last frame's answer. The frame could be a beat stale,
        // and if frames were starved entirely — a backgrounded tab, a
        // busy main thread — targetRef would be stale or never set, and
        // the drop would quietly do nothing.
        const dropped = targetAt(point.current.x, point.current.y);
        stop();
        onDrop(state, dropped);
      } else {
        cancelHold();
        press.current = null;
      }
    };

    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    // A long press on touch also raises a context menu; the card is a
    // drag surface, so it has nothing to offer one.
    const menu = (e: Event) => {
      if (dragRef.current || press.current) e.preventDefault();
    };

    // Last resort. If a pointerup is ever missed — the finger leaves the
    // window, the tab is backgrounded mid-drag, a system gesture steals
    // the pointer — the drag must not survive it: body is left at
    // touch-action:none with a ghost stuck to the screen, and the page
    // is unusable until a reload. Cheap insurance against an expensive
    // dead end.
    const bail = () => {
      if (dragRef.current || press.current) stop();
    };

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("keydown", key);
    window.addEventListener("contextmenu", menu);
    window.addEventListener("blur", bail);
    document.addEventListener("visibilitychange", bail);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("keydown", key);
      window.removeEventListener("contextmenu", menu);
      window.removeEventListener("blur", bail);
      document.removeEventListener("visibilitychange", bail);
      cancelHold();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [cancelHold, onDrop, paint, schedule, stop]);

  /** While a card is up the document must not scroll, select or rubber-band,
   *  and the cursor should say what is happening. */
  useEffect(() => {
    if (!drag) return;
    const { body } = document;
    const prev = {
      select: body.style.userSelect,
      touch: body.style.touchAction,
      cursor: body.style.cursor,
    };
    body.style.userSelect = "none";
    body.style.touchAction = "none";
    body.style.cursor = "grabbing";
    return () => {
      body.style.userSelect = prev.select;
      body.style.touchAction = prev.touch;
      body.style.cursor = prev.cursor;
    };
  }, [drag]);

  return { drag, target, setGhost, onPointerDown };
}
