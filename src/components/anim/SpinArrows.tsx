"use client";

import { motion, useReducedMotion } from "motion/react";

const BALL_GLOW =
  "0 0 6px #67e8f9, 0 0 18px #22d3ee, 0 0 48px rgba(34,211,238,.45)";

export function SpinArrows() {
  const reduced = useReducedMotion();
  const orbit = { transformBox: "fill-box", transformOrigin: "center" } as const;
  return (
    <div
      role="img"
      aria-label="Glowing ball with spin-arrow trails"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12]"
    >
      <div
        className="h-9 w-9 rounded-full"
        style={{
          background: "radial-gradient(circle at 35% 35%, #ffffff, #22d3ee 75%)",
          boxShadow: BALL_GLOW,
        }}
      />
      <svg viewBox="0 0 200 200" className="absolute h-52 w-52" fill="none" aria-hidden>
        <defs>
          <marker id="spin-c" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="#22d3ee" />
          </marker>
          <marker id="spin-m" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="#e879f9" />
          </marker>
        </defs>
        {/* cyan arc orbiting clockwise */}
        <motion.g style={orbit} animate={reduced ? undefined : { rotate: 360 }}
          transition={{ duration: 3, ease: "linear", repeat: Infinity }}>
          <circle cx="100" cy="100" r="56" />
          <path d="M 44 100 A 56 56 0 0 1 156 100" stroke="#22d3ee" strokeWidth="3.5"
            strokeLinecap="round" markerEnd="url(#spin-c)"
            style={{ filter: "drop-shadow(0 0 5px rgba(34,211,238,.7))" }} />
        </motion.g>
        {/* magenta arc counter-rotating, slower */}
        <motion.g style={orbit} animate={reduced ? undefined : { rotate: -360 }}
          transition={{ duration: 5, ease: "linear", repeat: Infinity }}>
          <circle cx="100" cy="100" r="76" />
          <path d="M 176 100 A 76 76 0 0 1 24 100" stroke="#e879f9" strokeWidth="3"
            strokeLinecap="round" markerEnd="url(#spin-m)"
            style={{ filter: "drop-shadow(0 0 5px rgba(232,121,249,.7))" }} />
        </motion.g>
      </svg>
    </div>
  );
}
