"use client";

import { motion, useReducedMotion } from "motion/react";

// The journal filling up: three entries slide into the feed one after
// another (match note, lesson, practice), and the lesson breaks out an
// indented takeaway row — the journal's signature move.
const LOOP = 6;

const ENTRIES = [
  { at: 0.08, chip: "#22d3ee", bars: ["100%", "72%"] }, // match note
  { at: 0.3, chip: "#fbbf24", bars: ["88%"] }, // lesson (+ takeaway below)
  { at: 0.62, chip: "#e879f9", bars: ["100%", "55%"] }, // practice
];

function appear(reduced: boolean | null, at: number) {
  return {
    initial: reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 },
    animate: reduced
      ? undefined
      : { opacity: [0, 0, 1, 1, 0], y: [10, 10, 0, 0, 0] },
    transition: {
      duration: LOOP,
      times: [0, at, at + 0.06, 0.93, 1],
      repeat: Infinity,
      repeatDelay: 0.8,
    },
  };
}

export function JournalFeed() {
  const reduced = useReducedMotion();
  return (
    <div
      role="img"
      aria-label="Journal entries collecting: a match note, a lesson with a takeaway, and a practice entry"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12] px-8"
    >
      <div className="w-full max-w-[250px] space-y-2">
        {ENTRIES.map((e, i) => (
          <div key={i}>
            <motion.div
              {...appear(reduced, e.at)}
              className="rounded-md border border-edge bg-surface-2/80 px-2.5 py-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-1.5 w-7 shrink-0 rounded-full"
                  style={{ background: e.chip, opacity: 0.75 }}
                />
                <span className="h-1 w-10 rounded-full bg-zinc-700" />
              </div>
              <div className="mt-2 space-y-1.5">
                {e.bars.map((w, j) => (
                  <span
                    key={j}
                    className="block h-1.5 rounded-full bg-zinc-500/60"
                    style={{ width: w }}
                  />
                ))}
              </div>
            </motion.div>
            {/* the lesson's takeaway, indented under it */}
            {i === 1 && (
              <motion.div
                {...appear(reduced, e.at + 0.14)}
                className="ml-6 mt-1.5 flex items-center gap-2 rounded-md border border-edge bg-surface-2/60 px-2.5 py-1.5"
              >
                <svg viewBox="0 0 10 8" className="h-2 w-2.5 shrink-0" aria-hidden>
                  <path
                    d="M1 4 L3.8 6.5 L9 1"
                    fill="none"
                    stroke="#22d3ee"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span
                  className="h-1.5 rounded-full bg-zinc-500/60"
                  style={{ width: "70%" }}
                />
              </motion.div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
