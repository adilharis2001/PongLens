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
        {/* ball paths: a serve crossing the net, and the return */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden
        >
          <motion.path
            d="M14 26 Q 48 10 78 58"
            fill="none"
            stroke="#22d3ee"
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.7"
            style={{ filter: "drop-shadow(0 0 3px rgba(34,211,238,.6))" }}
            initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
            animate={reduced ? undefined : { pathLength: [0, 1, 1, 0] }}
            transition={{
              duration: 3.6,
              times: [0.05, 0.3, 0.9, 1],
              repeat: Infinity,
              repeatDelay: 0.8,
            }}
          />
          <motion.path
            d="M78 58 Q 50 85 24 68"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.7"
            style={{ filter: "drop-shadow(0 0 3px rgba(245,158,11,.6))" }}
            initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
            animate={reduced ? undefined : { pathLength: [0, 0, 1, 1, 0] }}
            transition={{
              duration: 3.6,
              times: [0, 0.32, 0.55, 0.9, 1],
              repeat: Infinity,
              repeatDelay: 0.8,
            }}
          />
        </svg>
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
              duration: 0.4,
              delay: i * 0.08,
              repeat: Infinity,
              repeatDelay: 1,
            }}
          />
        ))}
      </div>
    </div>
  );
}
