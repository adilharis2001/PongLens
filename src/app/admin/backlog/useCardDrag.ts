"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DropTarget } from "@/lib/backlog/dragModel";
import type { BacklogLane } from "@/lib/backlog/types";

/**
 * Press-and-hold to lift a card, then drag it.
 *
 * Pointer events rather than HTML5 drag-and-drop, because HTML5 DnD does
 * not fire on touch at all and this list is used on a phone first.
 *
 * Touch and mouse deliberately start differently. A finger has to hold
 * for HOLD_MS, because on touch a drag and a scroll begin with the same
 * gesture and the list has to stay scrollable; moving more than
 * SCROLL_SLOP before the timer fires is a scroll, and the lift is
 * cancelled. A mouse has a scroll wheel and needs no such truce, so it
 * lifts as soon as it moves past MOUSE_SLOP.
 *
 * Targets are resolved with elementFromPoint against `data-drop-*`
 * attributes rather than by tracking enter/leave events. The dragged
 * ghost sits under the pointer, so hit-testing has to ignore it — hence
 * pointer-events: none on the ghost — and one lookup per move is both
 * simpler and immune to the enter/leave ordering bugs that come with
 * nested targets.
 */

const HOLD_MS = 300;
/** Finger travel that cancels a pending lift and lets the page scroll. */
const SCROLL_SLOP = 8;
/** Mouse travel before a press becomes a drag rather than a click. */
const MOUSE_SLOP = 5;
/** How close to the viewport edge before the page scrolls itself. */
const EDGE = 72;
const EDGE_SPEED = 14;

export interface DragState {
  id: string;
  x: number;
  y: number;
  /** Pointer offset inside the card, so the ghost sits where you grabbed it. */
  dx: number;
  dy: number;
  width: number;
  height: number;
  target: DropTarget | null;
}

function targetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const item = el.closest<HTMLElement>("[data-drop-item]");
  if (item?.dataset.dropItem) return { kind: "item", id: item.dataset.dropItem };
  const lane = el.closest<HTMLElement>("[data-drop-lane]");
  if (lane?.dataset.dropLane) {
    return { kind: "lane", lane: lane.dataset.dropLane as BacklogLane };
  }
  return null;
}

export function useCardDrag(onDrop: (state: DragState) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{
    x: number;
    y: number;
    id: string;
    rect: DOMRect;
    touch: boolean;
  } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const edgeTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  dragRef.current = drag;

  const stopEdgeScroll = useCallback(() => {
    if (edgeTimer.current) {
      clearInterval(edgeTimer.current);
      edgeTimer.current = null;
    }
  }, []);

  const cancelHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const finish = useCallback(() => {
    cancelHold();
    stopEdgeScroll();
    const state = dragRef.current;
    setDrag(null);
    dragRef.current = null;
    start.current = null;
    if (state) onDrop(state);
  }, [cancelHold, onDrop, stopEdgeScroll]);

  /** Drags near the top or bottom edge scroll the page, so a card can
   *  reach a prerequisite that is not currently on screen. */
  const runEdgeScroll = useCallback((y: number) => {
    stopEdgeScroll();
    const top = y < EDGE;
    const bottom = y > window.innerHeight - EDGE;
    if (!top && !bottom) return;
    edgeTimer.current = setInterval(() => {
      window.scrollBy(0, top ? -EDGE_SPEED : EDGE_SPEED);
      const state = dragRef.current;
      // The pointer has not moved, but the page under it has, so the
      // target has to be re-resolved or it goes stale mid-scroll.
      if (state) {
        const next = targetAt(state.x, state.y);
        setDrag((d) => (d ? { ...d, target: next } : d));
      }
    }, 16);
  }, [stopEdgeScroll]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent, id: string) => {
      // Left button / primary contact only, and never from a control.
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest("button[data-no-drag]")) return;

      const rect = (
        event.currentTarget as HTMLElement
      ).getBoundingClientRect();
      const touch = event.pointerType !== "mouse";
      start.current = { x: event.clientX, y: event.clientY, id, rect, touch };

      const lift = () => {
        const s = start.current;
        if (!s) return;
        const state: DragState = {
          id,
          x: s.x,
          y: s.y,
          dx: s.x - s.rect.left,
          dy: s.y - s.rect.top,
          width: s.rect.width,
          height: s.rect.height,
          target: null,
        };
        dragRef.current = state;
        setDrag(state);
      };

      if (touch) {
        holdTimer.current = setTimeout(lift, HOLD_MS);
      }
    },
    [],
  );

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const s = start.current;
      const state = dragRef.current;

      if (!state && s) {
        const travel = Math.hypot(event.clientX - s.x, event.clientY - s.y);
        if (s.touch) {
          // Moving before the hold completes is a scroll, not a lift.
          if (travel > SCROLL_SLOP) {
            cancelHold();
            start.current = null;
          }
          return;
        }
        if (travel > MOUSE_SLOP) {
          const lifted: DragState = {
            id: s.id,
            x: event.clientX,
            y: event.clientY,
            dx: s.x - s.rect.left,
            dy: s.y - s.rect.top,
            width: s.rect.width,
            height: s.rect.height,
            target: targetAt(event.clientX, event.clientY),
          };
          dragRef.current = lifted;
          setDrag(lifted);
        }
        return;
      }
      if (!state) return;

      // A lifted card owns the gesture: no scrolling, no text selection.
      event.preventDefault();
      const target = targetAt(event.clientX, event.clientY);
      const next = { ...state, x: event.clientX, y: event.clientY, target };
      dragRef.current = next;
      setDrag(next);
      runEdgeScroll(event.clientY);
    };

    const up = () => {
      if (dragRef.current) finish();
      else {
        cancelHold();
        start.current = null;
      }
    };

    const cancel = () => {
      cancelHold();
      stopEdgeScroll();
      setDrag(null);
      dragRef.current = null;
      start.current = null;
    };

    // Non-passive: a lifted card must be able to preventDefault the scroll.
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    // Escape is the way out of a drag you did not mean to start.
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      cancelHold();
      stopEdgeScroll();
    };
  }, [cancelHold, finish, runEdgeScroll, stopEdgeScroll]);

  // While a card is lifted the document must not rubber-band or select.
  useEffect(() => {
    if (!drag) return;
    const { body } = document;
    const prevSelect = body.style.userSelect;
    const prevTouch = body.style.touchAction;
    body.style.userSelect = "none";
    body.style.touchAction = "none";
    return () => {
      body.style.userSelect = prevSelect;
      body.style.touchAction = prevTouch;
    };
  }, [drag]);

  return { drag, onPointerDown };
}
