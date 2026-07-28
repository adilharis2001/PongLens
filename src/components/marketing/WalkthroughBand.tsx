"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The landing page's chaptered walkthrough: real product screenshots
 * (public/showcase/*, the same captures the showcase page uses), one per
 * chapter, with the chapter list beside them. Each viewport sees its own
 * form factor: desktop shots (<shot>-d.jpg) on md+, phone shots
 * (<shot>-m.jpg) below. Chapters advance on a timer and any chapter is
 * clickable; prefers-reduced-motion turns the timer off.
 *
 * All images are mounted once and crossfade, so switching never flashes.
 * Only the first chapter loads eagerly.
 */

export interface Chapter {
  /** basename under /showcase — the -m (phone) variant is used everywhere:
   *  a portrait shot shows near native scale, so it stays legible, where a
   *  scaled-down desktop page does not. */
  shot: string;
  title: string;
  caption: React.ReactNode;
}

const HOLD_MS = 6000;

function Stage({ chapters, active }: { chapters: Chapter[]; active: number }) {
  return (
    <div className="relative mx-auto aspect-[390/844] w-52 sm:w-60 md:w-72 lg:w-80">
      {chapters.map((c, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={c.shot}
          src={`/showcase/${c.shot}-m.jpg`}
          alt={c.title}
          loading={i === 0 ? "eager" : "lazy"}
          decoding="async"
          className={`absolute inset-0 h-full w-full rounded-2xl border border-edge object-cover shadow-2xl shadow-black/50 transition-opacity duration-300 ${
            i === active ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}
    </div>
  );
}

export function WalkthroughBand({ chapters }: { chapters: Chapter[] }) {
  const [active, setActive] = useState(0);
  const [reduced, setReduced] = useState(true); // no timer until we know
  const [visible, setVisible] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
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

  // auto-advance; depending on `active` restarts the hold after a click
  useEffect(() => {
    if (reduced || !visible) return;
    const t = setTimeout(
      () => setActive((a) => (a + 1) % chapters.length),
      HOLD_MS
    );
    return () => clearTimeout(t);
  }, [reduced, visible, active, chapters.length]);

  return (
    <div
      ref={wrap}
      className="flex flex-col items-center gap-5 md:flex-row md:items-center md:justify-center md:gap-16 lg:gap-24"
    >
      <style>{`@keyframes walkband-progress { from { width: 0 } to { width: 100% } }`}</style>

      <div className="w-full min-w-0 md:w-auto md:shrink-0">
        <Stage chapters={chapters} active={active} />
      </div>

      {/* mobile: chips + one caption directly under the stage, so the
          whole unit fits one viewport — no scrolling between the image
          and the text to follow along */}
      <div className="w-full max-w-md md:hidden">
        <div className="flex justify-center gap-1.5">
          {chapters.map((c, i) => (
            <button
              key={c.shot}
              type="button"
              onClick={() => setActive(i)}
              aria-label={c.title}
              aria-current={i === active ? "step" : undefined}
              className={`h-8 w-8 rounded-full border text-xs font-semibold tabular-nums transition-colors ${
                i === active
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
            {chapters[active].title}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
            {chapters[active].caption}
          </p>
        </div>
        {!reduced && (
          <span className="mx-auto block h-0.5 w-40 overflow-hidden rounded-full bg-edge">
            <span
              key={active}
              className="block h-full rounded-full bg-cyan-glow/70"
              style={{
                animation: visible
                  ? `walkband-progress ${HOLD_MS}ms linear forwards`
                  : undefined,
              }}
            />
          </span>
        )}
      </div>

      <ol className="hidden w-full max-w-md flex-col gap-1.5 md:flex lg:max-w-lg">
        {chapters.map((c, i) => {
          const current = i === active;
          return (
            <li key={c.shot}>
              <button
                type="button"
                onClick={() => setActive(i)}
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
                          key={active}
                          className="block h-full rounded-full bg-cyan-glow/70"
                          style={{
                            animation: visible
                              ? `walkband-progress ${HOLD_MS}ms linear forwards`
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
