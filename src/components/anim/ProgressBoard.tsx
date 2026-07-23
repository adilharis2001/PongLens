"use client";

import { motion, useReducedMotion } from "motion/react";

// Notes from matches and lessons collecting into a progress view:
// three note rows check off while a trend line draws upward.
const LOOP = 5;

export function ProgressBoard() {
  const reduced = useReducedMotion();
  return (
    <div
      role="img"
      aria-label="Notes from matches and lessons organized into a progress view with an upward trend"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12] px-8"
    >
      <div className="flex w-full max-w-[260px] items-center gap-4">
        {/* note rows, checking off */}
        <div className="flex-1 space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md border border-edge bg-surface-2/80 px-2.5 py-2"
            >
              <span className="relative h-3.5 w-3.5 shrink-0 rounded-[4px] border border-zinc-600">
                <motion.svg
                  viewBox="0 0 10 8"
                  className="absolute inset-0 m-auto h-2 w-2.5"
                  aria-hidden
                  initial={reduced ? { opacity: 1 } : { opacity: 0 }}
                  animate={
                    reduced ? undefined : { opacity: [0, 0, 1, 1, 0] }
                  }
                  transition={{
                    duration: LOOP,
                    times: [0, 0.15 + i * 0.12, 0.2 + i * 0.12, 0.92, 1],
                    repeat: Infinity,
                    repeatDelay: 0.8,
                  }}
                >
                  <path
                    d="M1 4 L3.8 6.5 L9 1"
                    fill="none"
                    stroke="#22d3ee"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </motion.svg>
              </span>
              <span
                className={`h-1.5 rounded-full ${
                  i === 1 ? "w-2/3 bg-magenta-soft/50" : "w-full bg-zinc-500/60"
                }`}
              />
            </div>
          ))}
        </div>
        {/* trend line drawing upward */}
        <div className="relative h-24 w-20 shrink-0 rounded-md border border-edge bg-surface-2/60">
          <svg
            viewBox="0 0 80 96"
            className="absolute inset-0 h-full w-full"
            aria-hidden
          >
            <motion.path
              d="M10 78 L28 62 L44 68 L70 24"
              fill="none"
              stroke="#22d3ee"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ filter: "drop-shadow(0 0 4px rgba(34,211,238,.6))" }}
              initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
              animate={reduced ? undefined : { pathLength: [0, 0, 1, 1, 0] }}
              transition={{
                duration: LOOP,
                times: [0, 0.25, 0.6, 0.92, 1],
                repeat: Infinity,
                repeatDelay: 0.8,
              }}
            />
            <motion.circle
              cx="70"
              cy="24"
              r="3.5"
              fill="#22d3ee"
              style={{ filter: "drop-shadow(0 0 5px rgba(34,211,238,.8))" }}
              initial={reduced ? { opacity: 1 } : { opacity: 0 }}
              animate={reduced ? undefined : { opacity: [0, 0, 1, 1, 0] }}
              transition={{
                duration: LOOP,
                times: [0, 0.58, 0.64, 0.92, 1],
                repeat: Infinity,
                repeatDelay: 0.8,
              }}
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
