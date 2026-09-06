"use client";

import { motion, useReducedMotion } from "motion/react";

const BARS = [7, 14, 21, 11, 25, 16, 9, 19, 13, 23, 10, 17];

export function LessonRecording() {
  const reduced = useReducedMotion();

  return (
    <div
      role="img"
      aria-label="A lesson recording becoming an editable transcript and prepared notes"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12] px-8"
    >
      <div className="w-full max-w-[270px]">
        <div className="rounded-xl border border-edge bg-surface-2/80 p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[11px] font-medium text-zinc-200">
              <motion.span
                className="size-2 rounded-full bg-red-400"
                animate={reduced ? undefined : { opacity: [1, 0.35, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              />
              Recording lesson
            </span>
            <span className="text-[11px] tabular-nums text-zinc-400">32:18</span>
          </div>
          <div className="mt-4 flex h-7 items-center justify-center gap-[4px]">
            {BARS.map((height, index) => (
              <motion.span
                key={index}
                className="w-[3px] rounded-full bg-cyan-glow"
                style={{ height }}
                animate={
                  reduced ? undefined : { scaleY: [0.35, 1, 0.5, 0.85, 0.35] }
                }
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  delay: index * 0.07,
                  ease: "easeInOut",
                }}
              />
            ))}
          </div>
        </div>
        <motion.div
          className="mt-2.5 rounded-xl border border-cyan-glow/35 bg-cyan-glow/8 px-4 py-3"
          initial={reduced ? undefined : { opacity: 0, y: -6 }}
          animate={
            reduced ? undefined : { opacity: [0, 1, 1, 0], y: [-6, 0, 0, -6] }
          }
          transition={{
            duration: 4.8,
            times: [0, 0.16, 0.9, 1],
            repeat: Infinity,
            ease: "easeOut",
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-cyan-glow">
              Notes prepared
            </span>
            <span className="text-[9px] text-zinc-500">Transcript ready</span>
          </div>
          <div className="mt-2 space-y-1.5">
            <div className="h-1.5 w-full rounded-full bg-zinc-500/60" />
            <div className="h-1.5 w-3/4 rounded-full bg-zinc-500/60" />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
