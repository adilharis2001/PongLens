"use client";

import { useEffect, useRef, useState } from "react";
import { BetaPill } from "@/components/BetaPill";
import type { Count, Tally } from "./matchAnalysis";

/**
 * The shells every card in the Match analysis deck is built from. One
 * module so the scorecard cards, the video cards and the map cards cannot
 * drift into three slightly different tiles.
 */

/**
 * The scrolling part of a card. A fixed tile that clips its content would
 * otherwise just look truncated, so a fade sits over the bottom edge while
 * there is more to reach, and clears once you get there.
 */
export function CardBody({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () =>
      setMore(el.scrollHeight - el.scrollTop > el.clientHeight + 4);
    check();
    el.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      el.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  return (
    <div className="relative mt-3 sm:min-h-0 sm:flex-1">
      <div ref={ref} className="sm:h-full sm:overflow-y-auto sm:pr-1">
        {children}
      </div>
      {more && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-10 bg-gradient-to-t from-surface via-surface/80 to-transparent sm:block" />
      )}
    </div>
  );
}

/**
 * One card of the deck. Mobile: a snap target sized by its content, one
 * per screen with the next one peeking. Desktop: two per view at a fixed
 * height, snapping to card starts, so the deck is the same swipe on every
 * surface (Adil, 2026-09-15) rather than a grid on one and a carousel on
 * the other.
 */
export const CARD_CLASS =
  "flex w-[86%] shrink-0 snap-center flex-col rounded-2xl border border-edge bg-surface p-4 sm:h-[30rem] sm:w-[calc(50%-0.5rem)] sm:snap-start";

export function Card({
  title,
  hint,
  beta = false,
  children,
}: {
  title: string;
  hint?: string;
  /** The numbers come from the ball engine, not from the score. */
  beta?: boolean;
  children: React.ReactNode;
}) {
  return (
    /* Equal tiles beat honest heights on desktop — four different heights
       in a grid leave holes that read as broken rather than as data. The
       BODY scrolls when a card has more in it than the others. */
    <div className={CARD_CLASS}>
      <h3 className="flex shrink-0 items-center gap-2 text-sm font-semibold text-zinc-100">
        {title}
        {beta && <BetaPill />}
      </h3>
      {hint && <p className="mt-0.5 shrink-0 text-xs text-zinc-500">{hint}</p>}
      <CardBody>{children}</CardBody>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-6 text-center text-xs leading-relaxed text-zinc-500">
      {children}
    </p>
  );
}

export function StatRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-zinc-400">{label}</span>
      <span className="shrink-0 text-xs font-semibold tabular-nums">
        {children}
      </span>
    </div>
  );
}

export function Pct({
  played,
  won,
  pct,
}: {
  played: number;
  won: number;
  pct: number | null;
}) {
  if (pct === null) return <span className="text-zinc-500">—</span>;
  return (
    <>
      <span className="text-cyan-glow">{pct}%</span>
      <span className="ml-1.5 text-[11px] font-normal text-zinc-500">
        {won}/{played}
      </span>
    </>
  );
}

export function Pair({ you, them }: { you: number; them: number }) {
  return (
    <>
      <span className="text-cyan-glow">{you}</span>
      <span className="text-zinc-600">–</span>
      <span className="text-magenta-soft">{them}</span>
    </>
  );
}

/** A won/lost split bar: cyan for points won, magenta for points lost. */
export function SplitBar({ row }: { row: Tally }) {
  const total = row.won + row.lost;
  const pct = total > 0 ? Math.round((row.won / total) * 100) : 0;
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-zinc-300">{row.label}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
          <span className="font-semibold text-cyan-glow">{pct}%</span> · {total}
        </span>
      </div>
      <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-ink">
        <div
          className="bg-cyan-glow"
          style={{ width: `${total ? (row.won / total) * 100 : 0}%` }}
        />
        <div
          className="bg-magenta-glow/70"
          style={{ width: `${total ? (row.lost / total) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}

/** A plain count bar, sized against the biggest count in its group. */
export function CountBar({
  row,
  max,
  tone = "magenta",
}: {
  row: Count;
  max: number;
  tone?: "magenta" | "cyan";
}) {
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-zinc-300">{row.label}</span>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-zinc-400">
          {row.count}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink">
        <div
          className={tone === "cyan" ? "h-full bg-cyan-glow" : "h-full bg-magenta-glow/70"}
          style={{ width: `${max ? (row.count / max) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}
