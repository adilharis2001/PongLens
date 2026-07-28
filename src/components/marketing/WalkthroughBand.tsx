"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The landing page's chaptered demo player: the real product playing as
 * six short portrait loops (public/demo/ch-*.mp4, produced by
 * scripts/demos/ capture -> blur_video -> chapters.sh), with the chapter
 * list beside it. The video advances chapter to chapter on its own;
 * clicking a chapter jumps there. One element, both a walkthrough and a
 * carousel.
 *
 * Performance contract (same spirit as DemoLoop):
 *   - all six <video> elements are mounted once and never re-srced (no
 *     poster flash on switching); only the active one plays;
 *   - only the active and next chapters fetch bytes (preload swaps from
 *     "none" as the walkthrough approaches them);
 *   - off-screen, everything pauses; prefers-reduced-motion gets stills.
 */

export interface Chapter {
  name: string; // basename under /demo
  title: string;
  caption: React.ReactNode;
}

export function WalkthroughBand({ chapters }: { chapters: Chapter[] }) {
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);
  const [reduced, setReduced] = useState<boolean | null>(null);
  const [visible, setVisible] = useState(false);
  // chapters the player has reached (or is about to): these get real
  // preload; the rest stay preload="none" until their turn nears
  const [warm, setWarm] = useState<Set<number>>(() => new Set([0, 1]));
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => setVisible(e.isIntersecting),
      { rootMargin: "160px", threshold: 0.1 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // play/pause follows visibility + the active chapter
  useEffect(() => {
    if (reduced !== false) return;
    videos.current.forEach((v, i) => {
      if (!v) return;
      if (i === active && visible) {
        void v.play().catch(() => {});
      } else {
        v.pause();
      }
    });
  }, [active, visible, reduced]);

  const goTo = (i: number) => {
    const n = (i + chapters.length) % chapters.length;
    const v = videos.current[n];
    if (v) v.currentTime = 0;
    setProgress(0);
    setWarm((w) =>
      w.has(n) && w.has((n + 1) % chapters.length)
        ? w
        : new Set([...w, n, (n + 1) % chapters.length])
    );
    setActive(n);
  };

  return (
    <div ref={wrap} className="flex flex-col items-center gap-8 md:flex-row md:items-stretch md:gap-12">
      {/* the stage — one glass surface, all chapters stacked */}
      <div className="relative aspect-[390/844] w-60 shrink-0 overflow-hidden rounded-2xl border border-edge shadow-2xl shadow-black/50 sm:w-64 md:w-72">
        {chapters.map((c, i) =>
          reduced ? (
            i === active && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={c.name}
                src={`/demo/${c.name}.jpg`}
                alt={c.title}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )
          ) : (
            <video
              key={c.name}
              ref={(el) => {
                videos.current[i] = el;
              }}
              src={`/demo/${c.name}.mp4`}
              poster={`/demo/${c.name}.jpg`}
              muted
              playsInline
              preload={warm.has(i) ? "auto" : "none"}
              aria-label={c.title}
              onEnded={() => i === active && goTo(i + 1)}
              onTimeUpdate={(e) => {
                if (i !== active) return;
                const v = e.currentTarget;
                if (v.duration > 0) setProgress(v.currentTime / v.duration);
              }}
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                i === active ? "opacity-100" : "opacity-0"
              }`}
            />
          )
        )}
      </div>

      {/* chapter list — the captions ARE the narration */}
      <ol className="flex w-full max-w-md flex-col justify-center gap-1 md:max-w-sm">
        {chapters.map((c, i) => {
          const current = i === active;
          return (
            <li key={c.name}>
              <button
                type="button"
                onClick={() => goTo(i)}
                aria-current={current ? "step" : undefined}
                className={`group w-full rounded-xl px-4 py-3 text-left transition-colors ${
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
                    className={`font-semibold ${
                      current ? "text-zinc-100" : "text-zinc-400 group-hover:text-zinc-200"
                    }`}
                  >
                    {c.title}
                  </span>
                </span>
                {current && (
                  <>
                    <p className="mt-1.5 pl-8 text-sm leading-relaxed text-zinc-400">
                      {c.caption}
                    </p>
                    <span className="mt-2.5 ml-8 block h-0.5 overflow-hidden rounded-full bg-edge">
                      <span
                        className="block h-full rounded-full bg-cyan-glow/70 transition-[width] duration-300 ease-linear"
                        style={{ width: `${Math.round(progress * 100)}%` }}
                      />
                    </span>
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
