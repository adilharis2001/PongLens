"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * Money moving one way: the student's card, then the coach's bank, with a
 * pulse travelling the rail between them. The small notch on the rail is
 * the platform fee coming off on the way past.
 */
export function PayoutRail() {
  const reduced = useReducedMotion();

  return (
    <div
      role="img"
      aria-label="A payment travelling from a student's card to the coach's bank"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12] px-8"
    >
      <div className="w-full max-w-[260px]">
        <div className="flex items-center justify-between">
          {/* the card */}
          <div className="h-9 w-14 shrink-0 rounded-md border border-edge bg-surface-2">
            <div className="mt-2 h-1.5 w-full bg-zinc-600/70" />
            <div className="ml-1.5 mt-2 h-1 w-6 rounded-full bg-zinc-600/50" />
          </div>

          {/* the rail */}
          <div className="relative mx-3 h-px flex-1 bg-edge">
            <motion.span
              className="absolute -top-[3px] h-1.5 w-1.5 rounded-full bg-cyan-glow"
              style={{ boxShadow: "0 0 10px rgba(34,211,238,.8)" }}
              initial={reduced ? undefined : { left: "0%", opacity: 0 }}
              animate={
                reduced
                  ? { left: "100%", opacity: 1 }
                  : { left: ["0%", "100%"], opacity: [0, 1, 1, 0] }
              }
              transition={{
                duration: 2.4,
                times: [0, 0.15, 0.85, 1],
                repeat: Infinity,
                repeatDelay: 0.6,
                ease: "easeInOut",
              }}
            />
          </div>

          {/* the bank */}
          <div className="h-9 w-14 shrink-0 rounded-md border border-cyan-glow/40 bg-cyan-glow/10">
            <div className="mx-auto mt-2.5 h-1.5 w-8 rounded-full bg-cyan-glow/70" />
            <div className="mx-auto mt-1.5 h-1 w-5 rounded-full bg-cyan-glow/40" />
          </div>
        </div>

        <div className="mt-4 flex justify-between text-[11px] tabular-nums text-zinc-500">
          <span>they pay</span>
          <span className="text-zinc-400">less a small fee</span>
          <span>you keep</span>
        </div>
      </div>
    </div>
  );
}
