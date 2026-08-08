"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * Three starting points, one of them picked. The selection moves along the
 * row so no single template reads as the recommended one.
 */
export function TemplateStack() {
  const reduced = useReducedMotion();
  const cards = ["Serve", "Receive", "Full match"];

  return (
    <div
      role="img"
      aria-label="Three review templates with one selected"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12] px-8"
    >
      <div className="flex w-full max-w-[260px] gap-2.5">
        {cards.map((name, i) => (
          <motion.div
            key={name}
            className="flex-1 rounded-lg border bg-surface-2/80 p-2.5"
            initial={false}
            animate={
              reduced
                ? { borderColor: "rgba(34,211,238,.55)" }
                : {
                    borderColor: [
                      "#262633",
                      "rgba(34,211,238,.55)",
                      "#262633",
                      "#262633",
                    ],
                    y: [0, -4, 0, 0],
                  }
            }
            // Each card holds the selection for its full third of the
            // loop, so one of the three is always the chosen one.
            transition={{
              duration: 4.2,
              times: [0, 0.02, 0.31, 0.35],
              repeat: Infinity,
              delay: i * 1.4,
              ease: "easeInOut",
            }}
          >
            <p className="truncate text-[11px] font-medium text-zinc-200">
              {name}
            </p>
            {/* the sections it starts you with */}
            <div className="mt-2 space-y-1">
              {[0, 1, 2].map((b) => (
                <div
                  key={b}
                  className="h-1 rounded-full bg-zinc-600/70"
                  style={{ width: ["100%", "80%", "60%"][b] }}
                />
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
