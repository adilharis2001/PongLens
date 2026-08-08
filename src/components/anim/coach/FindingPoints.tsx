"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * A written pattern with the rallies it is about. The two linked points
 * pulse in turn; the other clips stay dim, which is what makes the link
 * read as a choice the coach made.
 */
const CLIPS = [
  { label: "4", linked: true },
  { label: "9", linked: false },
  { label: "18", linked: true },
  { label: "23", linked: false },
];

export function FindingPoints() {
  const reduced = useReducedMotion();

  return (
    <div
      role="img"
      aria-label="A written pattern linked to two points of a match"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12] px-8"
    >
      <div className="w-full max-w-[260px]">
        {/* the pattern itself */}
        <div className="rounded-lg border border-edge bg-surface-2/80 px-3.5 py-3">
          <p className="text-[13px] font-medium leading-tight text-zinc-200">
            The long serve is landing where he wants it
          </p>
          <div className="mt-2.5 space-y-1.5">
            <div className="h-1.5 w-full rounded-full bg-zinc-600/70" />
            <div className="h-1.5 w-4/5 rounded-full bg-zinc-600/70" />
          </div>
        </div>

        {/* the clips it points at */}
        <div className="mt-3 flex gap-2">
          {CLIPS.map((c, i) => (
            <motion.div
              key={c.label}
              className="flex h-10 flex-1 items-center justify-center rounded-md border text-xs font-semibold tabular-nums"
              style={{
                borderColor: c.linked
                  ? "rgba(34,211,238,.5)"
                  : "var(--color-edge)",
                background: c.linked
                  ? "rgba(34,211,238,.12)"
                  : "rgba(27,27,38,.8)",
                color: c.linked ? "#22d3ee" : "#52525b",
              }}
              animate={
                reduced || !c.linked
                  ? undefined
                  : {
                      boxShadow: [
                        "0 0 0 rgba(34,211,238,0)",
                        "0 0 16px rgba(34,211,238,.5)",
                        "0 0 0 rgba(34,211,238,0)",
                      ],
                    }
              }
              transition={{
                duration: 1.6,
                repeat: Infinity,
                repeatDelay: 1.2,
                delay: i === 0 ? 0 : 1.4,
                ease: "easeInOut",
              }}
            >
              {c.label}
            </motion.div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">
          Two points linked to this pattern.
        </p>
      </div>
    </div>
  );
}
