"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * A coach's own material arriving on the review: a prepared file dropping
 * onto the write-up under it.
 */
export function AttachFile() {
  const reduced = useReducedMotion();

  return (
    <div
      role="img"
      aria-label="A prepared file attached to a review"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12] px-8"
    >
      <div className="w-full max-w-[260px]">
        {/* the review it lands on */}
        <div className="rounded-lg border border-edge bg-surface-2/80 px-3.5 py-3">
          <div className="space-y-1.5">
            <div className="h-1.5 w-full rounded-full bg-zinc-600/70" />
            <div className="h-1.5 w-5/6 rounded-full bg-zinc-600/70" />
            <div className="h-1.5 w-3/5 rounded-full bg-zinc-600/70" />
          </div>
        </div>

        {/* the file */}
        <motion.div
          className="mt-3 flex items-center gap-2.5 rounded-lg border border-magenta-glow/50 bg-magenta-glow/10 px-3 py-2.5"
          style={{ boxShadow: "0 0 14px rgba(232,121,249,.18)" }}
          initial={reduced ? undefined : { opacity: 0, y: -14 }}
          animate={
            reduced ? undefined : { opacity: [0, 1, 1, 0], y: [-14, 0, 0, -14] }
          }
          // Mostly on screen: a still of the gap is just an empty card.
          transition={{
            duration: 4,
            times: [0, 0.12, 0.9, 1],
            repeat: Infinity,
            repeatDelay: 0.4,
            ease: "easeOut",
          }}
        >
          <span className="h-6 w-5 shrink-0 rounded-[3px] border border-magenta-soft/60 bg-magenta-soft/20" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-magenta-soft">
              two-week-plan.pdf
            </span>
            <span className="block text-[11px] text-zinc-500">1.4 MB</span>
          </span>
        </motion.div>
      </div>
    </div>
  );
}
