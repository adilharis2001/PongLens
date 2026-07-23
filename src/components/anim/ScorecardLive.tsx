"use client";

import { motion, useReducedMotion } from "motion/react";

// A live scorebug: your score ticks up while the LIVE dot pulses.
// The digit strip ends where it starts, so the loop is seamless.
const DIGITS = ["9", "10", "11", "9"];

export function ScorecardLive() {
  const reduced = useReducedMotion();
  return (
    <div
      role="img"
      aria-label="A live scorecard with the score ticking up as points are played"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12] px-8"
    >
      <div className="w-full max-w-[240px]">
        <div
          className="overflow-hidden rounded-lg border border-edge bg-ink/90"
          style={{ boxShadow: "0 0 18px rgba(34,211,238,.12)" }}
        >
          {/* you */}
          <div className="flex items-center gap-2.5 border-b border-edge/70 px-3.5 py-2.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-cyan-glow"
              style={{ boxShadow: "0 0 6px rgba(34,211,238,.8)" }}
            />
            <span className="flex-1 text-sm font-semibold text-zinc-100">
              You
            </span>
            <span className="font-mono text-sm tabular-nums text-zinc-400">
              2
            </span>
            <span className="w-9 rounded bg-cyan-glow/15 py-0.5 text-center font-mono text-sm font-bold tabular-nums text-cyan-glow">
              {reduced ? (
                "11"
              ) : (
                <span className="block h-5 overflow-hidden">
                  <motion.span
                    className="block"
                    animate={{ y: [0, -20, -40, -60] }}
                    transition={{
                      duration: 4.5,
                      times: [0.2, 0.45, 0.7, 1],
                      ease: ["easeOut", "easeOut", "easeOut"],
                      repeat: Infinity,
                    }}
                  >
                    {DIGITS.map((d, i) => (
                      <span key={i} className="block h-5 leading-5">
                        {d}
                      </span>
                    ))}
                  </motion.span>
                </span>
              )}
            </span>
          </div>
          {/* opponent */}
          <div className="flex items-center gap-2.5 px-3.5 py-2.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-zinc-600" />
            <span className="flex-1 text-sm font-medium text-zinc-400">
              M. Chen
            </span>
            <span className="font-mono text-sm tabular-nums text-zinc-500">
              1
            </span>
            <span className="w-9 rounded bg-surface-2 py-0.5 text-center font-mono text-sm font-bold tabular-nums text-zinc-300">
              8
            </span>
          </div>
        </div>
        {/* live + share row */}
        <div className="mt-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-magenta-soft">
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-magenta-glow"
              style={{ boxShadow: "0 0 6px rgba(232,121,249,.8)" }}
              animate={reduced ? undefined : { opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            />
            Live
          </span>
          <span className="flex items-center gap-1 rounded-full border border-edge px-2.5 py-1 text-[11px] font-medium text-zinc-400">
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden>
              <path
                d="M6 8V1.5M6 1.5 3.5 4M6 1.5 8.5 4M2 6.5v3a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Share
          </span>
        </div>
      </div>
    </div>
  );
}
