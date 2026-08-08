"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * The three numbers a coach owns. The values stay put and a focus ring
 * travels down the rows instead: a card that cycles its values reads as
 * broken in a still, and most people meet this page in a still.
 */
const ROWS = [
  { label: "price", value: "$50" },
  { label: "turnaround", value: "5 days" },
  { label: "at once", value: "4" },
];

export function TermsDial() {
  const reduced = useReducedMotion();

  return (
    <div
      role="img"
      aria-label="Price, turnaround and order limit, each set by the coach"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12] px-8"
    >
      <div className="w-full max-w-[260px] space-y-2.5">
        {ROWS.map((r, i) => (
          <motion.div
            key={r.label}
            className="flex items-center justify-between gap-3 rounded-lg border bg-surface-2/80 px-3.5 py-2.5"
            initial={false}
            animate={
              reduced
                ? { borderColor: "#262633" }
                : {
                    borderColor: [
                      "#262633",
                      "rgba(34,211,238,.55)",
                      "#262633",
                      "#262633",
                    ],
                    boxShadow: [
                      "0 0 0 rgba(34,211,238,0)",
                      "0 0 16px rgba(34,211,238,.22)",
                      "0 0 0 rgba(34,211,238,0)",
                      "0 0 0 rgba(34,211,238,0)",
                    ],
                  }
            }
            transition={{
              duration: 4.2,
              times: [0, 0.06, 0.3, 1],
              repeat: Infinity,
              delay: i * 1.4,
              ease: "easeInOut",
            }}
          >
            <span className="text-[11px] uppercase tracking-wider text-zinc-500">
              {r.label}
            </span>
            <span className="text-sm font-semibold tabular-nums text-cyan-glow">
              {r.value}
            </span>
          </motion.div>
        ))}
        <p className="pt-0.5 text-[11px] text-zinc-500">
          You receive about $42.50 after fees.
        </p>
      </div>
    </div>
  );
}
