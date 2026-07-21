"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";

const STAGE_W = 800;
const STAGE_H = 500;

/**
 * Fast, flat rally. The table top sits at y=323; the ball (r=7) travels by
 * its center, so table bounces land at y=316. Racket contacts happen just
 * off each table end at (90,280) and (710,280). Each shot is a flat
 * parabola (quadratic halves, control = (midX, apexY)) with apex y=270 —
 * 31px above the net top (301), crossing the net at y~281:
 *
 *   C_L(90,280) -> A1(239,270) -> bounce far half B_R(560,316)
 *   -> C_R(710,280) [hold ~0.15s] -> A2(561,270)
 *   -> bounce near half B_L(240,316) -> C_L(90,280) [hold ~0.15s]
 */
const BALL_PATH = `path("M 90 280 Q 164.5 270 239 270 Q 399.5 270 560 316 Q 635 280 710 280 Q 635.5 270 561 270 Q 400.5 270 240 316 Q 165 280 90 280")`;

// offsetDistance keyframed at every apex, bounce, and racket contact
// (measured path lengths); repeated values = the ~0.15s racket-contact holds.
const DISTANCES = [
  "0%", "11.85%", "37.66%", "50%", "50%",
  "61.85%", "87.66%", "100%", "100%",
];
// ~0.8s per crossing (segment time proportional to horizontal distance —
// projectile x is linear in time) + 0.15s hold at each racket. Loop 1.9s.
const TIMES = [0, 0.101, 0.319, 0.421, 0.5, 0.601, 0.819, 0.921, 1];
// Rising halves decelerate into the apex; falling halves accelerate into the bounce.
const RISE: [number, number, number, number] = [0.33, 1, 0.68, 1]; // easeOut
const FALL: [number, number, number, number] = [0.32, 0, 0.67, 0]; // easeIn
const EASES: ([number, number, number, number] | "linear")[] = [
  RISE, FALL, RISE, "linear", RISE, FALL, RISE, "linear",
];
const DURATION = 1.9;

const BOUNCES = [
  { x: 560, t: 0.319 },
  { x: 240, t: 0.819 },
];
// Racket-contact flashes at each end of the rally.
const CONTACTS = [
  { x: 710, y: 280, t: 0.421 },
  { x: 90, y: 280, t: 0.921 },
];

// Subtle squash: ~60ms flatten at each table bounce.
const SQUASH_TIMES = [
  0,
  0.303, 0.319, 0.343,
  0.803, 0.819, 0.843,
  1,
];
const SCALE_Y = [1, 1, 0.85, 1, 1, 0.85, 1, 1];
const SCALE_X = [1, 1, 1.12, 1, 1, 1.12, 1, 1];

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

export function NeonBallHero({ background = false }: { background?: boolean }) {
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

  const pathTransition = {
    duration: DURATION,
    times: TIMES,
    ease: EASES,
    repeat: Infinity,
  } as const;
  const squashTransition = {
    duration: DURATION,
    times: SQUASH_TIMES,
    ease: "linear",
    repeat: Infinity,
  } as const;

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="A glowing table tennis ball rallying back and forth over a net at night"
      className={
        background
          ? "absolute inset-0 overflow-hidden"
          : "relative aspect-[8/5] w-full overflow-hidden rounded-2xl border border-edge shadow-2xl"
      }
      style={{ background: "#0a0a12" }}
    >
      <div
        className="absolute"
        style={
          background
            ? {
                // Full-bleed backdrop: span the container width, keep the
                // table + floor pinned to the bottom (sky crops from the top).
                left: "50%",
                bottom: 0,
                width: STAGE_W,
                height: STAGE_H,
                transform: `translateX(-50%) scale(${scale})`,
                transformOrigin: "bottom center",
              }
            : {
                left: 0,
                top: 0,
                width: STAGE_W,
                height: STAGE_H,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }
        }
      >
        {/* Arena backdrop: side-view table, net, faint floor grid */}
        <svg
          viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
          width={STAGE_W}
          height={STAGE_H}
          className="absolute inset-0"
          aria-hidden
        >
          {/* faint perspective floor grid, below the table */}
          <g stroke="#14141f" strokeWidth="1.5" fill="none">
            <line x1="0" y1="392" x2="800" y2="392" />
            <line x1="0" y1="422" x2="800" y2="422" />
            <line x1="-60" y1="500" x2="290" y2="345" />
            <line x1="150" y1="500" x2="355" y2="345" />
            <line x1="400" y1="500" x2="400" y2="345" />
            <line x1="650" y1="500" x2="445" y2="345" />
            <line x1="860" y1="500" x2="510" y2="345" />
          </g>
          {/* floor line */}
          <line x1="0" y1="452" x2="800" y2="452" stroke="#1e1e2c" strokeWidth="2" />

          {/* angled legs down to the floor */}
          <g stroke="#1a1a28" strokeWidth="9" strokeLinecap="round">
            <line x1="168" y1="336" x2="146" y2="450" />
            <line x1="632" y1="336" x2="654" y2="450" />
          </g>

          {/* table-top slab (side view) */}
          <rect
            x="120" y="323" width="560" height="14" rx="4"
            fill="#12121c" stroke="#232338" strokeWidth="1"
          />
          {/* subtle cyan top-edge highlight */}
          <line
            x1="125" y1="324" x2="675" y2="324"
            stroke="#22d3ee" strokeWidth="1.5" opacity="0.5"
            style={{ filter: "drop-shadow(0 0 4px rgba(34,211,238,.6))" }}
          />

          {/* center net on top of the table */}
          <line
            x1="400" y1="323" x2="400" y2="301"
            stroke="#e879f9" strokeWidth="3" strokeLinecap="round" opacity="0.6"
            style={{ filter: "drop-shadow(0 0 6px rgba(232,121,249,.8))" }}
          />
          <line
            x1="400" y1="322" x2="400" y2="302"
            stroke="rgba(224,242,254,.9)" strokeWidth="1.2"
          />
          <circle
            cx="400" cy="301" r="2.5" fill="#e879f9"
            style={{ filter: "drop-shadow(0 0 8px rgba(232,121,249,.9))" }}
          />
        </svg>

        {reduced ? (
          /* Static frame: ball skimming just above the net */
          <div style={{ ...ballStyle(14, 1), offsetDistance: "24.65%" }} />
        ) : (
          <>
            {/* trailing ghost */}
            <motion.div
              style={ballStyle(11, 0.35)}
              animate={{ offsetDistance: DISTANCES }}
              transition={{ ...pathTransition, delay: 0.05 }}
            />
            {/* the ball: ballistic path + squash at each bounce */}
            <motion.div
              style={ballStyle(14, 1)}
              animate={{
                offsetDistance: DISTANCES,
                scaleX: SCALE_X,
                scaleY: SCALE_Y,
              }}
              transition={{
                offsetDistance: pathTransition,
                scaleX: squashTransition,
                scaleY: squashTransition,
              }}
            />
            {/* bounce flashes on the table surface */}
            {BOUNCES.map(({ x, t }) => (
              <motion.div
                key={x}
                className="absolute"
                style={{
                  left: x - 24,
                  top: 316,
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
            {/* racket-contact flashes at each end of the rally */}
            {CONTACTS.map(({ x, y, t }) => (
              <motion.div
                key={x}
                className="absolute"
                style={{
                  left: x - 12,
                  top: y - 12,
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background:
                    "radial-gradient(circle, rgba(255,255,255,.95), rgba(232,121,249,.55) 45%, transparent 70%)",
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0, 0.9, 0, 0] }}
                transition={{
                  duration: DURATION,
                  times: [0, Math.max(0, t - 0.015), t, Math.min(1, t + 0.07), 1],
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
