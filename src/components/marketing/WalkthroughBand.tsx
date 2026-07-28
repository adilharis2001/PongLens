"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The landing page's chaptered walkthrough: real product screenshots
 * (public/showcase/*-m.jpg — phone shots read near native scale at
 * every viewport), grouped into chapters that each cycle through a few
 * screens. Chapters advance on a timer; any chapter is clickable.
 *
 * Desktop: one stage beside the chapter list. Mobile: a swipeable track
 * with the neighboring chapters peeking at the edges (the affordance
 * that says "swipe me"), numbered chips, and the active caption right
 * under the stage so the whole unit fits one viewport.
 */

export interface Chapter {
  /** basenames under /showcase (-m.jpg) — each chapter cycles these */
  shots: string[];
  title: string;
  caption: React.ReactNode;
}

const SUB_MS = 3200; // per screenshot within a chapter

export function WalkthroughBand({ chapters }: { chapters: Chapter[] }) {
  const [pos, setPos] = useState({ a: 0, s: 0 });
  const [reduced, setReduced] = useState(true); // no timer until we know
  const [visible, setVisible] = useState(false);
  const [cardW, setCardW] = useState(208); // px; larger on md+ viewports
  const wrap = useRef<HTMLDivElement | null>(null);
  const touchX = useRef<number | null>(null);
  const cardGap = cardW > 240 ? 24 : 14;

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    const size = () =>
      setCardW(
        window.innerWidth >= 1024 ? 300 : window.innerWidth >= 768 ? 272 : 208
      );
    size();
    window.addEventListener("resize", size);
    return () => window.removeEventListener("resize", size);
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      threshold: 0.2,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const goTo = (i: number) =>
    setPos({ a: (i + chapters.length) % chapters.length, s: 0 });

  // advance one screenshot at a time; chapter rolls over when its
  // screenshots run out
  useEffect(() => {
    if (reduced || !visible) return;
    const t = setTimeout(() => {
      setPos((p) =>
        p.s + 1 < chapters[p.a].shots.length
          ? { a: p.a, s: p.s + 1 }
          : { a: (p.a + 1) % chapters.length, s: 0 }
      );
    }, SUB_MS);
    return () => clearTimeout(t);
  }, [reduced, visible, pos, chapters]);

  const holdMs = chapters[pos.a].shots.length * SUB_MS;

  const swipeHandlers = {
    onTouchStart: (e: React.TouchEvent) => {
      touchX.current = e.touches[0].clientX;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (touchX.current === null) return;
      const dx = e.changedTouches[0].clientX - touchX.current;
      touchX.current = null;
      if (dx < -40) goTo(pos.a + 1);
      else if (dx > 40) goTo(pos.a - 1);
    },
  };

  // Stage (one box, all chapters stacked): only the active chapter's
  // active shot shows. Track (one card per chapter): inactive cards show
  // their first shot as the peek.
  const shotImg = (
    chapter: Chapter,
    i: number,
    shot: string,
    j: number,
    eager: boolean,
    peek: boolean
  ) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={shot}
      src={`/showcase/${shot}-m.jpg`}
      alt={chapter.title}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={`absolute inset-0 h-full w-full rounded-2xl border border-edge object-cover shadow-2xl shadow-black/50 transition-opacity duration-300 ${
        (i === pos.a ? j === pos.s : peek && j === 0)
          ? "opacity-100"
          : "opacity-0"
      }`}
    />
  );

  return (
    <div
      ref={wrap}
      className="flex flex-col items-center gap-5 md:flex-row md:items-center md:justify-center md:gap-16 lg:gap-24"
    >
      <style>{`@keyframes walkband-progress { from { width: 0 } to { width: 100% } }`}</style>

      {/* the track — every viewport: neighbors peek at the edges so it
          reads as a carousel; swipe on touch, click a peeked card to jump */}
      <div
        className="w-full min-w-0 overflow-hidden md:flex-1"
        {...swipeHandlers}
      >
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{
            gap: cardGap,
            paddingLeft: `calc(50% - ${cardW / 2}px)`,
            transform: `translateX(-${pos.a * (cardW + cardGap)}px)`,
          }}
        >
          {chapters.map((c, i) => (
            <button
              key={c.title}
              type="button"
              onClick={() => i !== pos.a && goTo(i)}
              aria-label={c.title}
              className={`relative aspect-[390/844] shrink-0 transition-opacity duration-300 ${
                i === pos.a ? "" : "opacity-40"
              }`}
              style={{ width: cardW }}
            >
              {c.shots.map((shot, j) =>
                shotImg(c, i, shot, j, i === 0 && j === 0, true)
              )}
            </button>
          ))}
        </div>
      </div>

      {/* mobile chips + one caption under the stage: the whole unit fits
          one viewport, no scrolling between image and text */}
      <div className="w-full max-w-md md:hidden">
        <div className="flex justify-center gap-1.5">
          {chapters.map((c, i) => (
            <button
              key={c.title}
              type="button"
              onClick={() => goTo(i)}
              aria-label={c.title}
              aria-current={i === pos.a ? "step" : undefined}
              className={`h-8 w-8 rounded-full border text-xs font-semibold tabular-nums transition-colors ${
                i === pos.a
                  ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                  : "border-edge text-zinc-500"
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <div className="mt-4 min-h-[7.5rem] text-center">
          <p className="font-semibold text-zinc-100">
            {chapters[pos.a].title}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
            {chapters[pos.a].caption}
          </p>
        </div>
        {!reduced && (
          <span className="mx-auto block h-0.5 w-40 overflow-hidden rounded-full bg-edge">
            <span
              key={pos.a}
              className="block h-full rounded-full bg-cyan-glow/70"
              style={{
                animation: visible
                  ? `walkband-progress ${holdMs}ms linear forwards`
                  : undefined,
              }}
            />
          </span>
        )}
      </div>

      {/* desktop chapter list */}
      <ol className="hidden w-full max-w-md flex-col gap-1.5 md:flex lg:max-w-lg">
        {chapters.map((c, i) => {
          const current = i === pos.a;
          return (
            <li key={c.title}>
              <button
                type="button"
                onClick={() => goTo(i)}
                aria-current={current ? "step" : undefined}
                className={`group w-full rounded-xl px-5 py-3.5 text-left transition-colors ${
                  current ? "bg-surface" : "hover:bg-surface/50"
                }`}
              >
                <span className="flex items-baseline gap-3">
                  <span
                    className={`text-sm tabular-nums ${
                      current ? "text-cyan-glow" : "text-zinc-600"
                    }`}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={`font-semibold lg:text-lg ${
                      current
                        ? "text-zinc-100"
                        : "text-zinc-400 group-hover:text-zinc-200"
                    }`}
                  >
                    {c.title}
                  </span>
                </span>
                {current && (
                  <>
                    <p className="mt-1.5 pl-8 text-sm leading-relaxed text-zinc-400 lg:text-[15px]">
                      {c.caption}
                    </p>
                    {!reduced && (
                      <span className="mt-2.5 ml-8 block h-0.5 overflow-hidden rounded-full bg-edge">
                        <span
                          key={pos.a}
                          className="block h-full rounded-full bg-cyan-glow/70"
                          style={{
                            animation: visible
                              ? `walkband-progress ${holdMs}ms linear forwards`
                              : undefined,
                          }}
                        />
                      </span>
                    )}
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
