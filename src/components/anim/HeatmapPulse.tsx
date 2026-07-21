"use client";

import { motion, useReducedMotion } from "motion/react";

// Bounce points as % of the table box; cyan = your side, amber = opponent's
const DOTS = [
  { x: 14, y: 26, c: "#22d3ee" },
  { x: 24, y: 68, c: "#22d3ee" },
  { x: 36, y: 40, c: "#22d3ee" },
  { x: 18, y: 48, c: "#22d3ee" },
  { x: 40, y: 76, c: "#22d3ee" },
  { x: 62, y: 30, c: "#f59e0b" },
  { x: 78, y: 58, c: "#f59e0b" },
  { x: 86, y: 26, c: "#f59e0b" },
  { x: 68, y: 74, c: "#f59e0b" },
];

export function HeatmapPulse() {
  const reduced = useReducedMotion();
  return (
    <div
      role="img"
      aria-label="Top-down table with glowing bounce-point heatmap"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12]"
    >
      <div className="relative h-[56%] w-[74%] rounded-md border-2 border-[#cbd5e1] bg-[#0f2557]">
        {/* center line along the length of the table */}
        <div className="absolute left-0 top-1/2 h-px w-full bg-[#cbd5e1]/50" />
        {/* net, dashed, across the middle */}
        <div className="absolute left-1/2 top-[-7%] h-[114%] border-l-2 border-dashed border-[#cbd5e1]/80" />
        {DOTS.map((d, i) => (
          <motion.div
            key={i}
            className="absolute h-3 w-3 rounded-full"
            style={{
              left: `${d.x}%`,
              top: `${d.y}%`,
              margin: -6,
              background: d.c,
              boxShadow: `0 0 12px ${d.c}`,
              opacity: reduced ? 0.9 : undefined,
            }}
            initial={reduced ? undefined : { scale: 0, opacity: 0 }}
            animate={reduced ? undefined : { scale: 1, opacity: 0.9 }}
            transition={{
              duration: 0.5,
              delay: i * 0.15,
              repeat: Infinity,
              repeatDelay: 1.5,
            }}
          />
        ))}
      </div>
    </div>
  );
}
