import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { CYAN, INK, MAGENTA } from "./theme";

/**
 * The card that opens and closes every chapter.
 *
 * It exists so the first frame of a file is always PongLens rather than
 * whatever the app happened to be showing — thumbnails, scrubbers and
 * autoplaying previews all take their still from frame zero.
 *
 * The mark is rebuilt as SVG rather than scaled from icon-512.png so it
 * stays crisp at 1080 wide, and it is the app's own glyph: a cyan lens ring
 * with a glint arc, no centre dot (src/components/Logo.tsx).
 */
export const Lens: React.FC<{ size: number; stroke?: number }> = ({
  size,
  stroke = 2.5,
}) => (
  <svg viewBox="0 0 32 32" width={size} height={size} fill="none">
    <circle cx="16" cy="16" r="12" stroke={CYAN} strokeWidth={stroke} opacity={0.95} />
    <path
      d="M8.86 11.88 A8.25 8.25 0 0 1 18.14 8.03"
      stroke={CYAN}
      strokeWidth={stroke * 0.8}
      strokeLinecap="round"
      opacity={0.5}
    />
  </svg>
);

export const Bookend: React.FC<{ mode: "intro" | "outro"; title?: string }> = ({
  mode,
  title,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const rise = spring({ frame, fps, config: { damping: 18, mass: 0.7 } });
  // The intro hands over with a fade; the outro simply holds.
  const out =
    mode === "intro"
      ? interpolate(frame, [durationInFrames - 7, durationInFrames], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  return (
    <AbsoluteFill
      style={{
        background: INK,
        opacity: out,
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Helvetica, Arial, sans-serif",
      }}
    >
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 45% at 50% 40%, rgba(34,211,238,.18), transparent 62%),
             radial-gradient(ellipse 46% 38% at 84% 78%, ${MAGENTA}14, transparent 60%)`,
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          transform: `scale(${interpolate(rise, [0, 1], [0.9, 1])})`,
          opacity: rise,
        }}
      >
        <Lens size={mode === "outro" ? 300 : 240} stroke={2.2} />
        <div
          style={{
            marginTop: 44,
            fontSize: mode === "outro" ? 92 : 76,
            fontWeight: 800,
            letterSpacing: -2,
            color: "#fafafa",
          }}
        >
          Pong<span style={{ color: CYAN }}>Lens</span>
        </div>
        {title ? (
          <div
            style={{
              marginTop: 22,
              fontSize: 34,
              fontWeight: 600,
              letterSpacing: 0.5,
              color: "#a1a1aa",
            }}
          >
            {title}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
