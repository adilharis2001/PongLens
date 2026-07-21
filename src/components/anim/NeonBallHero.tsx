"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";

const STAGE_W = 800;
const STAGE_H = 500;

const BALL_PATH = `path("M -30 230 Q 120 30 250 230 Q 350 90 440 230 Q 510 140 570 230 Q 615 175 660 230 Q 700 205 760 230")`;
const DISTANCES = ["0%", "34%", "62%", "81%", "93%", "100%"];
const TIMES = [0, 0.34, 0.62, 0.81, 0.93, 1];
// Fast off the bounce, hang at the apex, fast into the next bounce.
const HANG: [number, number, number, number] = [0.3, 0.7, 0.7, 0.3];
const EASES = [HANG, HANG, HANG, HANG, HANG];
const DURATION = 4.2;
const BOUNCES = [
  { x: 250, t: 0.34 },
  { x: 440, t: 0.62 },
  { x: 570, t: 0.81 },
  { x: 660, t: 0.93 },
];

const NEON_GLOW =
  "0 0 6px #67e8f9, 0 0 18px #22d3ee, 0 0 48px rgba(34,211,238,.45)";

function ballStyle(size: number, opacity: number): CSSProperties {
  return {
    position: "absolute",
    top: 0,
    left: 0,
    width: size,
    height: size,
    borderRadius: "50%",
    background: "radial-gradient(circle at 35% 35%, #ffffff, #22d3ee 75%)",
    boxShadow: NEON_GLOW,
    opacity,
    offsetPath: BALL_PATH,
    offsetRotate: "0deg",
  };
}

export function NeonBallHero() {
  const reduced = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setScale(entry.contentRect.width / STAGE_W),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const loop = {
    duration: DURATION,
    times: TIMES,
    ease: EASES,
    repeat: Infinity,
  } as const;

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="A table tennis ball tracing a glowing arc over a table at night"
      className="relative aspect-[8/5] w-full overflow-hidden rounded-2xl border border-edge shadow-2xl"
      style={{ background: "#0a0a12" }}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          width: STAGE_W,
          height: STAGE_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {/* Arena backdrop: table surface, net post, faint perspective grid */}
        <svg
          viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
          width={STAGE_W}
          height={STAGE_H}
          className="absolute inset-0"
          aria-hidden
        >
          {/* perspective grid receding below the table surface */}
          <g stroke="#1a1a28" strokeWidth="1.5" fill="none">
            <line x1="0" y1="290" x2="800" y2="290" />
            <line x1="0" y1="360" x2="800" y2="360" />
            <line x1="0" y1="450" x2="800" y2="450" />
            <line x1="-60" y1="500" x2="330" y2="240" />
            <line x1="170" y1="500" x2="380" y2="240" />
            <line x1="400" y1="500" x2="400" y2="240" />
            <line x1="630" y1="500" x2="420" y2="240" />
            <line x1="860" y1="500" x2="470" y2="240" />
          </g>
          {/* table surface line */}
          <line x1="0" y1="237" x2="800" y2="237" stroke="#2a3550" strokeWidth="3" />
          <line x1="0" y1="240" x2="800" y2="240" stroke="#141824" strokeWidth="4" />
          {/* net post with a sparing magenta glow */}
          <line
            x1="398" y1="237" x2="398" y2="194"
            stroke="#e879f9" strokeWidth="3" strokeLinecap="round"
            style={{ filter: "drop-shadow(0 0 6px rgba(232,121,249,.8))" }}
          />
          <circle cx="398" cy="194" r="3" fill="#e879f9"
            style={{ filter: "drop-shadow(0 0 8px rgba(232,121,249,.9))" }} />
        </svg>

        {reduced ? (
          /* Static final frame: ball resting mid-flight above the table */
          <div style={{ ...ballStyle(14, 1), offsetDistance: "48%" }} />
        ) : (
          <>
            {/* trailing ghost */}
            <motion.div
              style={ballStyle(11, 0.35)}
              animate={{ offsetDistance: DISTANCES }}
              transition={{ ...loop, delay: 0.06 }}
            />
            {/* the ball */}
            <motion.div
              style={ballStyle(14, 1)}
              animate={{ offsetDistance: DISTANCES }}
              transition={loop}
            />
            {/* bounce flashes at each landing point */}
            {BOUNCES.map(({ x, t }) => (
              <motion.div
                key={x}
                className="absolute"
                style={{
                  left: x - 24,
                  top: 226,
                  width: 48,
                  height: 14,
                  borderRadius: "50%",
                  background:
                    "radial-gradient(ellipse, rgba(103,232,249,.85), transparent 70%)",
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0, 0.9, 0, 0] }}
                transition={{
                  duration: DURATION,
                  times: [0, Math.max(0, t - 0.02), t, Math.min(1, t + 0.08), 1],
                  ease: "linear",
                  repeat: Infinity,
                }}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
