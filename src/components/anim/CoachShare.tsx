"use client";

import { motion, useReducedMotion } from "motion/react";

// A shared match card, then a coach note arriving on it.
export function CoachShare() {
  const reduced = useReducedMotion();
  return (
    <div
      role="img"
      aria-label="A shared match receiving a coach note"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12] px-8"
    >
      <div className="w-full max-w-[260px] space-y-3">
        {/* the player's match card */}
        <div
          className="flex items-center gap-3 rounded-lg border border-cyan-glow/40 bg-cyan-glow/10 px-3.5 py-3"
          style={{ boxShadow: "0 0 14px rgba(34,211,238,.18)" }}
        >
          <div
            className="h-8 w-11 shrink-0 rounded-sm bg-cyan-glow/70"
            style={{ boxShadow: "0 0 8px rgba(34,211,238,.5)" }}
          />
          <div className="flex-1 space-y-1.5">
            <div className="h-2 w-3/4 rounded-full bg-zinc-400/70" />
            <div className="h-2 w-1/2 rounded-full bg-zinc-600/70" />
          </div>
        </div>
        {/* the coach's note, arriving */}
        <motion.div
          className="ml-8 rounded-lg border border-magenta-glow/50 bg-magenta-glow/10 px-3.5 py-3"
          style={
            reduced
              ? { boxShadow: "0 0 14px rgba(232,121,249,.2)" }
              : { boxShadow: "0 0 14px rgba(232,121,249,.2)", transformOrigin: "top right" }
          }
          initial={reduced ? undefined : { opacity: 0, y: 8, scale: 0.96 }}
          animate={
            reduced
              ? undefined
              : { opacity: [0, 1, 1, 0], y: [8, 0, 0, 8], scale: [0.96, 1, 1, 0.96] }
          }
          transition={{
            duration: 5,
            times: [0, 0.12, 0.88, 1],
            repeat: Infinity,
            repeatDelay: 1.5,
          }}
        >
          <div className="space-y-1.5">
            <div className="h-2 w-full rounded-full bg-magenta-soft/80" />
            <div className="h-2 w-2/3 rounded-full bg-magenta-soft/50" />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
