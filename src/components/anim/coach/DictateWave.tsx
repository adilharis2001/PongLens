"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * Speech becoming a written note: a live waveform under the section label,
 * and the sentence arriving a phrase at a time beside it.
 */
const BARS = [0.4, 0.75, 0.5, 1, 0.65, 0.9, 0.45, 0.8, 0.55];
const PHRASES = [
  "You block the first ball well,",
  "then take two steps back.",
  "Hold your ground.",
];

export function DictateWave() {
  const reduced = useReducedMotion();

  return (
    <div
      role="img"
      aria-label="A voice recording turning into written text"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12] px-8"
    >
      <div className="w-full max-w-[260px]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500">
            summary
          </span>
          {/* the recording */}
          <span className="flex h-8 items-center gap-[3px] rounded-full border border-edge bg-surface-2/80 px-3">
            {BARS.map((h, i) => (
              <motion.span
                key={i}
                className="w-[3px] rounded-full bg-cyan-glow"
                style={{ height: `${h * 16}px`, opacity: 0.85 }}
                animate={
                  reduced ? undefined : { scaleY: [0.35, 1, 0.55, 0.9, 0.35] }
                }
                transition={{
                  duration: 1.8,
                  repeat: Infinity,
                  delay: i * 0.08,
                  ease: "easeInOut",
                }}
              />
            ))}
          </span>
        </div>

        {/* the words landing */}
        <div className="mt-3 rounded-lg border border-edge bg-surface-2/80 px-3.5 py-3">
          <p className="text-[13px] leading-relaxed text-zinc-200">
            {PHRASES.map((phrase, i) => (
              <motion.span
                key={phrase}
                className="mr-1 inline"
                initial={reduced ? undefined : { opacity: 0 }}
                animate={reduced ? undefined : { opacity: [0, 1, 1, 0] }}
                // held for most of the loop: a card caught mid-clear reads
                // as an empty card, and stills are how this is usually seen
                transition={{
                  duration: 4.4,
                  times: [0, 0.08, 0.9, 1],
                  repeat: Infinity,
                  delay: i * 0.45,
                  ease: "easeOut",
                }}
              >
                {phrase}
              </motion.span>
            ))}
          </p>
        </div>
      </div>
    </div>
  );
}
