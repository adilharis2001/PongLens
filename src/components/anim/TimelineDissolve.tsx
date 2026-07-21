"use client";

import { motion, useReducedMotion } from "motion/react";

// 1 = live rally segment (stays lit), 0 = dead time (dissolves away)
const SEGMENTS = [1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1];

export function TimelineDissolve() {
  const reduced = useReducedMotion();
  return (
    <div
      role="img"
      aria-label="Video timeline with dead segments dissolving away"
      className="absolute inset-0 flex items-center gap-1.5 bg-[#0a0a12] px-8"
    >
      {SEGMENTS.map((on, i) => {
        const deadIdx = SEGMENTS.slice(0, i).filter((s) => !s).length;
        return on ? (
          <div
            key={i}
            className="h-16 flex-1 rounded-sm bg-cyan-glow/80"
            style={{ boxShadow: "0 0 10px rgba(34,211,238,.45)" }}
          />
        ) : (
          <motion.div
            key={i}
            className="h-16 flex-1 rounded-sm bg-zinc-600/60"
            style={reduced ? { opacity: 0.15, scaleY: 0.3 } : undefined}
            animate={
              reduced
                ? undefined
                : { scaleY: [1, 1, 0.05, 0.05, 1], opacity: [0.7, 0.7, 0, 0, 0.7] }
            }
            transition={{
              duration: 4.5,
              times: [0, 0.12, 0.3, 0.88, 1],
              delay: deadIdx * 0.18,
              repeat: Infinity,
              repeatDelay: 2,
            }}
          />
        );
      })}
    </div>
  );
}
