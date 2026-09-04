"use client";

import { motion, useReducedMotion } from "motion/react";

export function JournalShare() {
  const reduced = useReducedMotion();

  return (
    <div
      role="img"
      aria-label="A coach sharing a lesson entry into a student's journal"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12] px-7"
    >
      <div className="relative grid w-full max-w-[290px] grid-cols-[1fr_38px_1fr] items-center">
        <JournalCard label="Coach entry" accent={false} />
        <div className="relative h-px bg-edge">
          <motion.span
            className="absolute -top-2 left-0 flex size-4 items-center justify-center rounded bg-cyan-glow text-[9px] font-bold text-ink"
            initial={false}
            animate={
              reduced
                ? { x: 22, opacity: 1 }
                : { x: [0, 22, 22, 0], opacity: [0, 1, 1, 0] }
            }
            transition={{
              duration: 3.8,
              times: [0, 0.3, 0.82, 1],
              repeat: Infinity,
              repeatDelay: 0.7,
              ease: "easeInOut",
            }}
          >
            ↗
          </motion.span>
        </div>
        <motion.div
          animate={
            reduced
              ? { borderColor: "rgba(34,211,238,.5)" }
              : {
                  filter: [
                    "drop-shadow(0 0 0 rgba(34,211,238,0))",
                    "drop-shadow(0 0 10px rgba(34,211,238,.28))",
                    "drop-shadow(0 0 0 rgba(34,211,238,0))",
                  ],
                }
          }
          transition={{ duration: 3.8, repeat: Infinity, repeatDelay: 0.7 }}
        >
          <JournalCard label="Student journal" accent />
        </motion.div>
      </div>
    </div>
  );
}

function JournalCard({ label, accent }: { label: string; accent: boolean }) {
  return (
    <div
      className={`rounded-xl border bg-surface-2/80 p-3 ${
        accent ? "border-cyan-glow/40" : "border-edge"
      }`}
    >
      <p className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-2 text-[11px] font-medium text-zinc-200">Short serve</p>
      <div className="mt-2 space-y-1.5">
        <div className="h-1 w-full rounded-full bg-zinc-500/60" />
        <div className="h-1 w-3/4 rounded-full bg-zinc-500/60" />
      </div>
      <p className={`mt-3 text-[9px] ${accent ? "text-cyan-glow" : "text-zinc-600"}`}>
        {accent ? "Shared" : "Private"}
      </p>
    </div>
  );
}
