"use client";

import { motion, useReducedMotion } from "motion/react";

// 1 = live rally segment (stays lit), 0 = dead time. Dead segments fade and
// COLLAPSE, so the live segments slide together into a visibly shorter cut —
// the "cut" reads at a glance.
const SEGMENTS = [1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1];

export function TimelineDissolve() {
  const reduced = useReducedMotion();
  return (
    <div
      role="img"
      aria-label="Video timeline: dead segments collapse away and the rally segments merge into a shorter cut"
      className="absolute inset-0 flex items-center gap-1.5 bg-[#0a0a12] px-8"
    >
      {SEGMENTS.map((on, i) =>
        on ? (
          <div
            key={i}
            className="h-16 min-w-0 flex-1 rounded-sm bg-cyan-glow/80"
            style={{ boxShadow: "0 0 10px rgba(34,211,238,.45)" }}
          />
        ) : (
          <motion.div
            key={i}
            className="h-16 min-w-0 rounded-sm bg-zinc-600/60"
            style={reduced ? { opacity: 0.15, flexGrow: 0.15 } : { flexGrow: 1 }}
            animate={
              reduced
                ? undefined
                : {
                    flexGrow: [1, 1, 0.001, 0.001, 1],
                    opacity: [0.7, 0.7, 0, 0, 0.7],
                    marginLeft: [0, 0, -6, -6, 0],
                  }
            }
            transition={{
              duration: 2.6,
              times: [0, 0.1, 0.3, 0.82, 1],
              repeat: Infinity,
              repeatDelay: 0.9,
              ease: "easeInOut",
            }}
          />
        )
      )}
    </div>
  );
}
