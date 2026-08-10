"use client";

import { useCallback, useEffect, useState } from "react";

import type { BacklogBlocker } from "@/lib/backlog/blockers";
import { lineGeometry } from "@/lib/backlog/dragModel";

/**
 * The dependency lines, drawn in a reserved channel down the left side.
 *
 * Strictly in the gutter: the list is inset by GUTTER and nothing here is
 * ever painted over a card. Lines that overlap vertically take separate
 * tracks (see packLines), so two dependencies crossing the same stretch
 * of list stay individually readable instead of merging into one stripe.
 *
 * Each line runs from the PREREQUISITE and arrives, with the arrowhead,
 * at the item that waits on it — the direction you would draw with a pen:
 * this one, then that one.
 *
 * Positions are measured from the DOM rather than derived from the data,
 * because card heights depend on wrapped titles, chips and whether the
 * editor is open underneath. Measurement re-runs on anything that can
 * move a card: the data changing, the container resizing, a card
 * resizing, and the window resizing.
 */

/** Width of the reserved channel, in px. Must match the list's padding. */
export const GUTTER = 22;
const TRACK = 7;
const EDGE_INSET = 5;

interface Measured {
  height: number;
  lines: ReturnType<typeof lineGeometry>;
}

export function DependencyLines({
  edges,
  container,
  /** Bumped by the board whenever something that affects layout changes. */
  revision,
}: {
  edges: BacklogBlocker[];
  container: HTMLElement | null;
  /** Compared by identity in the effect deps, so a composite string key
   *  works as well as a counter. */
  revision: string | number;
}) {
  const [measured, setMeasured] = useState<Measured>({ height: 0, lines: [] });

  const measure = useCallback(() => {
    if (!container) return;
    const base = container.getBoundingClientRect();
    const centers = new Map<
      string,
      { top: number; bottom: number; center: number }
    >();
    container.querySelectorAll<HTMLElement>("[data-card-id]").forEach((el) => {
      const id = el.dataset.cardId;
      if (!id) return;
      const r = el.getBoundingClientRect();
      centers.set(id, {
        top: r.top - base.top,
        bottom: r.bottom - base.top,
        center: r.top - base.top + r.height / 2,
      });
    });
    setMeasured({
      height: base.height,
      lines: lineGeometry(edges, centers),
    });
  }, [container, edges]);

  useEffect(() => {
    measure();
  }, [measure, revision]);

  useEffect(() => {
    if (!container) return;
    // One observer on the container catches its own growth; observing the
    // cards catches a title rewrapping or an editor opening inside a row
    // without the container's own height changing first.
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    container
      .querySelectorAll<HTMLElement>("[data-card-id]")
      .forEach((el) => observer.observe(el));
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [container, measure, revision]);

  if (measured.lines.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-0"
      width={GUTTER}
      height={measured.height}
      aria-hidden="true"
    >
      {measured.lines.map((line) => {
        const x = GUTTER - EDGE_INSET - line.track * TRACK;
        const arrowY = line.toY;
        const dir = line.upward ? -1 : 1;
        return (
          <g key={line.key} stroke="currentColor" className="text-cyan-glow/45">
            <path
              d={`M ${GUTTER - 2} ${line.fromY}
                  H ${x + 4}
                  Q ${x} ${line.fromY} ${x} ${line.fromY + dir * 4}
                  V ${arrowY - dir * 4}
                  Q ${x} ${arrowY} ${x + 4} ${arrowY}
                  H ${GUTTER - 2}`}
              fill="none"
              strokeWidth="1.5"
            />
            {/* A dot where it leaves the prerequisite, an arrow where it
                arrives at the item that has to wait. */}
            <circle
              cx={GUTTER - 2}
              cy={line.fromY}
              r="2"
              fill="currentColor"
              stroke="none"
            />
            <path
              d={`M ${GUTTER - 6} ${arrowY - 3} L ${GUTTER - 2} ${arrowY} L ${GUTTER - 6} ${arrowY + 3}`}
              fill="none"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      })}
    </svg>
  );
}
