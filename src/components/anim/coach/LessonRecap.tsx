"use client";

import { motion, useReducedMotion } from "motion/react";

const chapters = ["Backhand block", "First attack", "Serve and receive"];

export function LessonRecap() {
  const reduced = useReducedMotion();
  return (
    <div role="img" aria-label="A recorded lesson becomes a video recap with chapters for each topic" className="absolute inset-0 flex items-center justify-center bg-[#0a0a12] px-8">
      <div className="w-full max-w-[270px] rounded-xl border border-edge bg-surface-2/80 p-4">
        <div className="flex items-center justify-between text-[10px]">
          <span className="uppercase tracking-wider text-zinc-400">Lesson recap</span>
          <span className="text-cyan-glow">Chapters</span>
        </div>
        <div className="mt-3 flex h-12 items-center gap-1 overflow-hidden rounded-lg bg-ink/60 px-3" aria-hidden="true">
          {[0, 1, 2].map(index => (
            <motion.div key={index} className="flex h-7 flex-1 items-center justify-center rounded bg-cyan-glow/15 text-[10px] text-cyan-glow" animate={reduced ? undefined : { opacity: [0.4, 1, 0.4] }} transition={{ duration: 4.8, repeat: Infinity, delay: index * 0.5 }}>
              <span>▶</span>
            </motion.div>
          ))}
        </div>
        <div className="mt-3 divide-y divide-edge/60">
          {chapters.map((title, index) => (
            <div key={title} className="flex items-center gap-2 py-2 text-[10px]">
              <span className="tabular-nums text-cyan-glow">0{index + 1}</span>
              <span className="text-zinc-300">{title}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
