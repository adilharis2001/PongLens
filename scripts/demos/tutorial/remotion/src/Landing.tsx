import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import cues from "./cues.json";
import voice from "./voice.json";
import { CYAN, EDGE, INK, MAGENTA } from "./theme";

/**
 * The landing video.
 *
 * Separate from Chapter because it is a different job: no chapter numbering,
 * no "6 of 9", and a section label that follows the story rather than a
 * fixed title. What it KEEPS from Chapter is the thing that makes a screen
 * recording look like a video at all — a device on a branded backdrop, a
 * caption carrying the spoken line, highlights on what is being talked
 * about, and a logo to open and close on. Stripping that layer is what left
 * the first cut looking like a raw capture.
 *
 * One composition serves both cuts. The geometry is derived from the
 * viewport the capture recorded (cues.json), so the phone gets a phone and
 * the desktop gets a window, and neither needs its own file to drift.
 */

type Cue =
  | { kind: "box"; t: number; end: number; label?: string; rect: { x: number; y: number; w: number; h: number } }
  | { kind: "tap"; t: number; end: number; x: number; y: number };

const CUES = (cues as { cues: Cue[] }).cues ?? [];
const VP = (cues as { viewport: { w: number; h: number } }).viewport;
const PORTRAIT = VP.h > VP.w;

/** Canvas, and where the device sits on it. */
export const CANVAS = PORTRAIT ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 };
const SCREEN_W = PORTRAIT ? 620 : 1380;
const SCREEN_H = Math.round((SCREEN_W * VP.h) / VP.w);
const SCREEN_X = Math.round((CANVAS.w - SCREEN_W) / 2);
const SCREEN_Y = PORTRAIT ? 250 : 150;
/** CSS px -> canvas px, so every recorded cue rect stays in CSS pixels. */
const S = SCREEN_W / VP.w;
const RADIUS = PORTRAIT ? 44 : 16;

export const FPS = 30;
export const INTRO_FRAMES = 40;
export const OUTRO_FRAMES = 64;
const BODY_FRAMES = Math.ceil((cues as { duration: number }).duration * FPS);
export const TOTAL_FRAMES = INTRO_FRAMES + BODY_FRAMES + OUTRO_FRAMES;

const ARENA = `radial-gradient(ellipse 70% 45% at 50% 4%, rgba(34,211,238,.16), transparent 62%),
   radial-gradient(ellipse 46% 38% at 86% 78%, ${MAGENTA}14, transparent 60%)`;

/** The lens ring, drawn rather than fetched so the render has no assets. */
const Logo: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="20" stroke={CYAN} strokeWidth="3.5" />
    <circle cx="24" cy="24" r="20" stroke="rgba(255,255,255,.12)" strokeWidth="1" />
  </svg>
);

/** A held card at each end, so the video opens and closes on the brand. */
const Bookend: React.FC<{ mode: "intro" | "outro" }> = ({ mode }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const rise = spring({ frame, fps, config: { damping: 20, mass: 0.8 } });
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, mode === "outro" ? 1 : 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = PORTRAIT ? 1 : 1.15;
  return (
    <AbsoluteFill style={{ background: INK }}>
      <AbsoluteFill style={{ background: ARENA }} />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 30 * scale,
          opacity: out,
          transform: `translateY(${(1 - rise) * 18}px)`,
        }}
      >
        <Logo size={130 * scale} />
        <div
          style={{
            fontFamily: "Helvetica, Arial, sans-serif",
            fontSize: 76 * scale,
            fontWeight: 800,
            letterSpacing: -1.6,
            color: "#fff",
          }}
        >
          Pong<span style={{ color: CYAN }}>Lens</span>
        </div>
        {mode === "outro" && (
          <div
            style={{
              fontFamily: "Helvetica, Arial, sans-serif",
              fontSize: 30 * scale,
              color: "#9aa0ad",
              letterSpacing: 0.2,
            }}
          >
            Film the match once. Learn from it all season.
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** The section label above the device, and a progress hairline. */
const Header: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = frame / FPS;
  const line = voice.lines.find((l) => t >= l.start - 0.3 && t <= l.start + l.dur + 0.5);
  const label = (line as { label?: string } | undefined)?.label ?? "";
  const progress = frame / durationInFrames;
  const scale = PORTRAIT ? 1 : 0.82;

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: PORTRAIT ? 108 : 52,
          textAlign: "center",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 34 * scale,
            fontWeight: 700,
            letterSpacing: 5,
            textTransform: "uppercase",
            color: CYAN,
            // Fades rather than cuts, so a changing label is not a flicker.
            opacity: label ? 1 : 0,
            transition: "opacity .3s",
          }}
        >
          {label}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: SCREEN_X,
          width: SCREEN_W,
          top: PORTRAIT ? 178 : 104,
          height: 3,
          borderRadius: 3,
          background: "rgba(255,255,255,.09)",
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${progress * 100}%`, height: "100%", background: CYAN }} />
      </div>
    </>
  );
};

/** A ring around whatever is being talked about, with its name on a chip. */
const BoxCue: React.FC<{ cue: Extract<Cue, { kind: "box" }> }> = ({ cue }) => {
  const frame = useCurrentFrame();
  const start = cue.t * FPS;
  const end = cue.end * FPS;
  if (frame < start - 6 || frame > end + 6) return null;
  const rise = spring({ frame: frame - start, fps: FPS, config: { damping: 22, mass: 0.6 } });
  const fall = interpolate(frame, [end - 8, end], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const o = Math.min(rise, fall);

  const { x, y, w, h } = cue.rect;
  // The chip goes ABOVE the box, or below when the box is near the top of
  // the screen. Tucking it inside a short target covers the thing it names,
  // which is exactly how a label ended up sitting on the star and note icons.
  const above = y >= 96;
  const chipTop = above ? y - 31 : y + h + 11;

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: x - 6,
          top: y - 6,
          width: w + 12,
          height: h + 12,
          border: `2.5px solid ${CYAN}`,
          borderRadius: 14,
          boxShadow: `0 0 0 6px rgba(34,211,238,.10), 0 0 26px rgba(34,211,238,.35)`,
          opacity: o,
          transform: `scale(${0.985 + o * 0.015})`,
          transformOrigin: "center",
        }}
      />
      {cue.label && (
        <div
          style={{
            position: "absolute",
            left: x - 6,
            top: chipTop,
            padding: "4px 10px",
            borderRadius: 999,
            background: CYAN,
            color: INK,
            fontFamily: "Helvetica, Arial, sans-serif",
            fontSize: 13,
            fontWeight: 700,
            whiteSpace: "nowrap",
            opacity: o,
          }}
        >
          {cue.label}
        </div>
      )}
    </>
  );
};

/** The spoken line, on screen. A landing video is largely watched muted. */
const Caption: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const line = voice.lines.find((l) => t >= l.start - 0.15 && t <= l.start + l.dur + 0.35);
  if (!line) return null;
  const start = (line.start - 0.15) * FPS;
  const end = (line.start + line.dur + 0.35) * FPS;
  const o = interpolate(frame, [start, start + 5, end - 7, end], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = PORTRAIT ? 1 : 0.86;

  return (
    <div
      style={{
        position: "absolute",
        left: PORTRAIT ? 84 : 300,
        right: PORTRAIT ? 84 : 300,
        top: SCREEN_Y + SCREEN_H + (PORTRAIT ? 54 : 36),
        textAlign: "center",
        fontFamily: "Helvetica, Arial, sans-serif",
        fontSize: 40 * scale,
        lineHeight: 1.36,
        fontWeight: 600,
        color: "#e9ecf1",
        letterSpacing: -0.4,
        opacity: o,
        textWrap: "balance",
      }}
    >
      {line.text}
    </div>
  );
};

const Body: React.FC = () => (
  <AbsoluteFill style={{ background: INK, fontFamily: "Helvetica, Arial, sans-serif" }}>
    <AbsoluteFill style={{ background: ARENA }} />
    <Header />

    {/* the device shell */}
    <div
      style={{
        position: "absolute",
        left: SCREEN_X - 13,
        top: SCREEN_Y - 13,
        width: SCREEN_W + 26,
        height: SCREEN_H + 26,
        borderRadius: RADIUS + 12,
        background: "#05050a",
        border: `1px solid ${EDGE}`,
        boxShadow:
          "0 40px 90px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.04), 0 0 70px rgba(34,211,238,.12)",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: SCREEN_X,
        top: SCREEN_Y,
        width: SCREEN_W,
        height: SCREEN_H,
        borderRadius: RADIUS,
        overflow: "hidden",
      }}
    >
      {/* inside here everything is in the app's own CSS pixels */}
      <div
        style={{
          width: VP.w,
          height: VP.h,
          transform: `scale(${S})`,
          transformOrigin: "0 0",
          position: "relative",
        }}
      >
        <OffthreadVideo
          src={staticFile("chapter.mp4")}
          muted
          style={{ width: VP.w, height: VP.h, display: "block" }}
        />
        {CUES.map((cue, i) =>
          cue.kind === "box" ? <BoxCue key={i} cue={cue} /> : null
        )}
      </div>
    </div>

    <Caption />

    {voice.lines.map((l, i) => (
      <Sequence key={i} from={Math.round(l.start * FPS)}>
        <Audio src={staticFile(`audio/${l.id}.mp3`)} />
      </Sequence>
    ))}
  </AbsoluteFill>
);

export const Landing: React.FC = () => (
  <AbsoluteFill style={{ background: INK }}>
    <Sequence durationInFrames={INTRO_FRAMES}>
      <Bookend mode="intro" />
    </Sequence>
    <Sequence from={INTRO_FRAMES} durationInFrames={BODY_FRAMES}>
      <Body />
    </Sequence>
    <Sequence from={INTRO_FRAMES + BODY_FRAMES} durationInFrames={OUTRO_FRAMES}>
      <Bookend mode="outro" />
    </Sequence>
  </AbsoluteFill>
);
