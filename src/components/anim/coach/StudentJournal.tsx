"use client";

import { motion, useReducedMotion } from "motion/react";

export function StudentJournal() {
  const reduced = useReducedMotion();

  return (
    <div
      role="img"
      aria-label="A private lesson entry with notes, a photo and a link"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12] px-8"
    >
      <div className="w-full max-w-[270px] rounded-xl border border-edge bg-surface-2/80 p-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            Forehand timing
          </span>
          <span className="rounded-full bg-zinc-700/60 px-2 py-0.5 text-[9px] text-zinc-400">
            Private
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
        <div className="mt-4 flex gap-2">
          <div className="relative h-12 w-16 overflow-hidden rounded-lg border border-edge bg-[#151526]">
            <span className="absolute bottom-0 left-0 h-7 w-full bg-cyan-glow/10 [clip-path:polygon(0_100%,42%_18%,64%_62%,78%_38%,100%_100%)]" />
            <span className="absolute right-2 top-2 size-2 rounded-full bg-magenta-glow/60" />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-edge bg-ink/50 px-2.5">
            <span className="text-sm text-cyan-glow">↗</span>
            <span className="min-w-0">
              <span className="block truncate text-[10px] text-zinc-300">
                Footwork drill
              </span>
              <span className="block text-[9px] text-zinc-600">video</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
