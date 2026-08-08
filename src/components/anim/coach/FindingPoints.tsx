"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * A finding with the rallies it is about: two clips light up in turn under
 * a written pattern, which is the whole idea of a review here. Abstract on
 * purpose, the way the home page's cards are.
 */
export function FindingPoints() {
  const reduced = useReducedMotion();
  const clips = [0, 1, 2, 3];

  return (
    <div
      role="img"
      aria-label="A written pattern with the points it links to"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12] px-8"
    >
      <div className="w-full max-w-[260px]">
        {/* the pattern itself */}
        <div className="rounded-lg border border-edge bg-surface-2/80 px-3.5 py-3">
          <div className="h-2 w-2/3 rounded-full bg-zinc-300/80" />
          <div className="mt-2 space-y-1.5">
            <div className="h-1.5 w-full rounded-full bg-zinc-600/70" />
            <div className="h-1.5 w-4/5 rounded-full bg-zinc-600/70" />
          </div>
        </div>

        {/* the clips it points at */}
        <div className="mt-3 flex gap-2">
          {clips.map((i) => {
            const lit = i === 0 || i === 2;
            return (
              <motion.div
                key={i}
                className="h-9 flex-1 rounded-md border"
                style={{
                  borderColor: lit
                    ? "rgba(34,211,238,.5)"
                    : "var(--color-edge)",
                  background: lit
                    ? "rgba(34,211,238,.12)"
                    : "rgba(27,27,38,.8)",
                }}
                animate={
                  reduced || !lit
                    ? undefined
                    : {
                        boxShadow: [
                          "0 0 0 rgba(34,211,238,0)",
                          "0 0 14px rgba(34,211,238,.45)",
                          "0 0 0 rgba(34,211,238,0)",
                        ],
                      }
                }
                transition={{
                  duration: 1.6,
                  repeat: Infinity,
                  repeatDelay: 1.4,
                  delay: i === 0 ? 0 : 0.8,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
