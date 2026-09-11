"use client";

import { motion, useReducedMotion } from "motion/react";

export function StudentJournal() {
  const reduced = useReducedMotion();

  return (
    <div
      role="img"
      aria-label="A shared coaching journal with the coach's advice and the student's reflections"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12] px-8"
    >
      <div className="w-full max-w-[270px] rounded-xl border border-edge bg-surface-2/80 p-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            Forehand timing
          </span>
          <span className="rounded-full bg-zinc-700/60 px-2 py-0.5 text-[9px] text-zinc-400">
            Shared
          </span>
        </div>
        <div className="mt-3 space-y-1.5">
          {["100%", "88%", "68%"].map((width, index) => (
            <motion.div
              key={width}
              className="h-1.5 rounded-full bg-zinc-500/70"
              style={{ width, transformOrigin: "left" }}
              initial={reduced ? undefined : { opacity: 0, scaleX: 0 }}
              animate={
                reduced
                  ? undefined
                  : { opacity: [0, 1, 1, 0], scaleX: [0, 1, 1, 0] }
              }
              transition={{
                duration: 4.8,
                times: [0, 0.12, 0.9, 1],
                repeat: Infinity,
                delay: index * 0.18,
                ease: "easeOut",
              }}
            />
          ))}
        </div>
        <div className="mt-4 space-y-3 border-t border-edge pt-3 text-[10px]">
          <div><span className="text-cyan-glow">Coach&apos;s notes</span><p className="mt-1 text-zinc-400">Recover before the next ball.</p></div>
          <div><span className="text-magenta-soft">Student&apos;s journal</span><p className="mt-1 text-zinc-400">A shorter swing helped in practice.</p></div>
        </div>
      </div>
    </div>
  );
}
