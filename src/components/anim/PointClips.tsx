"use client";

import { motion, useReducedMotion } from "motion/react";

// The cut match splitting into per-point clips: a strip of clip tiles pops in
// fast, then a note lands on one of them.
const CLIPS = ["P7", "P8", "P9", "P10", "P11", "P12"];
const LOOP = 4.2;

export function PointClips() {
  const reduced = useReducedMotion();
  return (
    <div
      role="img"
      aria-label="A match video splitting into one clip per point, with a note added to one clip"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0a0a12] px-8"
    >
      {/* the full cut video */}
      <div
        className="h-2.5 w-full max-w-[260px] rounded-full bg-cyan-glow/60"
        style={{ boxShadow: "0 0 10px rgba(34,211,238,.35)" }}
      />
      {/* splits into point clips */}
      <div className="grid w-full max-w-[260px] grid-cols-3 gap-2">
        {CLIPS.map((label, i) => (
          <motion.div
            key={label}
            className="relative flex h-11 items-center justify-center rounded-md border border-cyan-glow/40 bg-cyan-glow/10"
            initial={reduced ? undefined : { opacity: 0, y: -6, scale: 0.9 }}
            animate={
              reduced
                ? undefined
                : {
                    opacity: [0, 1, 1, 0],
                    y: [-6, 0, 0, 0],
                    scale: [0.9, 1, 1, 0.96],
                  }
            }
            transition={{
              duration: LOOP,
              times: [0, 0.1, 0.92, 1],
              delay: i * 0.09,
              repeat: Infinity,
              repeatDelay: 0.6,
            }}
          >
            {/* play triangle */}
            <svg viewBox="0 0 10 12" className="mr-1 h-3 w-2.5" aria-hidden>
              <path d="M0 0 L10 6 L0 12 Z" fill="#22d3ee" opacity="0.9" />
            </svg>
            <span className="font-mono text-[10px] font-semibold text-zinc-300">
              {label}
            </span>
            {/* note lands on P10 */}
            {label === "P10" && (
              <motion.span
                className="absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full border border-magenta-glow/70 bg-magenta-glow/90"
                style={{ boxShadow: "0 0 8px rgba(232,121,249,.7)" }}
                initial={reduced ? undefined : { scale: 0, opacity: 0 }}
                animate={
                  reduced ? undefined : { scale: [0, 1.15, 1, 1, 0], opacity: [0, 1, 1, 1, 0] }
                }
                transition={{
                  duration: LOOP,
                  times: [0.35, 0.45, 0.5, 0.92, 1],
                  repeat: Infinity,
                  repeatDelay: 0.6,
                }}
              />
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
