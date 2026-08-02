import React from "react";
import {
  AbsoluteFill,
  Sequence as RemotionSequence,
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
import { Bookend } from "./Bookend";
import cues from "./cues.json";
import voice from "./voice.json";
import {
  CANVAS,
  CYAN,
  EDGE,
  INK,
  MAGENTA,
  S,
  SCREEN_H,
  SCREEN_W,
  SCREEN_X,
  SCREEN_Y,
  VIEWPORT,
} from "./theme";

/**
 * OPTION B — the same capture and the same cue track as render-a, composed
 * in React instead of a filter graph.
 *
 * What the extra layer buys, all of it impossible in ffmpeg alone:
 *   - the picture pushes in on whatever the narration is talking about,
 *     and eases back out (spring, not a cut);
 *   - everything outside the target dims, so the eye has one place to go;
 *   - boxes, chips and the tap ripple animate in and out;
 *   - the phone sits in a device frame on a branded backdrop, with a
 *     chapter header and a progress bar for a six-chapter series.
 *
 * Cue rects stay in the app's CSS pixels the whole way down; only the
 * outermost wrapper scales them onto the canvas.
 */

type Rect = { x: number; y: number; w: number; h: number };
type Cue =
  | { kind: "box"; t: number; end: number; label?: string; rect: Rect }
  | { kind: "tap"; t: number; end: number; x: number; y: number };

const CUES = cues.cues as Cue[];

/**
 * The camera does not move.
 *
 * The push-in read well on a single small control and badly on everything
 * else. On real screens it cropped the very thing it was pointing at: a
 * section highlight ran past the edge with its own outline cut off, and a
 * stat row lost the label column so the numbers had nothing naming them.
 * Every workaround traded one crop for another.
 *
 * A highlight that does not fit is worse than no zoom, so the frame stays
 * still and the outline plus the dimming does the pointing. Kept as a
 * function rather than deleted so the decision stays visible.
 */
const CAMERA = { zoom: 1, tx: 0, ty: 0 };

/** 0 -> 1 -> 0 across a cue's life, eased in with a spring, out linearly. */
const useCueEnvelope = (cue: Cue) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const start = cue.t * fps;
  const end = cue.end * fps;
  const rise = spring({
    frame: frame - start,
    fps,
    config: { damping: 15, mass: 0.5, stiffness: 110 },
  });
  const fall = interpolate(frame, [end - 9, end], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return Math.min(rise, fall);
};

/** Static camera. Kept as a hook so the cue components stay unchanged. */
const useCamera = () => ({
  ...CAMERA,
  project: (p: { x: number; y: number }) => p,
});

const BoxCue: React.FC<{ cue: Extract<Cue, { kind: "box" }>; cam: ReturnType<typeof useCamera> }> = ({
  cue,
  cam,
}) => {
  const e = useCueEnvelope(cue);
  if (e <= 0.001) return null;

  const pad = 6;
  const tl = cam.project({ x: cue.rect.x - pad, y: cue.rect.y - pad });
  const w = (cue.rect.w + pad * 2) * cam.zoom;
  const h = (cue.rect.h + pad * 2) * cam.zoom;
  // Overshoot a touch on entry so the box lands rather than appears.
  const grow = interpolate(e, [0, 1], [1.06, 1]);
  // Chip placement, now that nothing moves under it. One rule: sit just
  // above the box when there is room below the app header, otherwise tuck
  // inside its top-left. Always left-aligned to the box and clamped to the
  // screen using an estimated width, so a chip can never hang off the edge
  // or drift to an unexplained corner.
  const chipW = (cue.label?.length ?? 0) * 7 + 26;
  // Above when there is room; inside only when the target is big enough to
  // swallow a chip; otherwise BELOW. The old fallback tucked the chip
  // inside every small target near the top of the screen, which is how the
  // player's star and note icons ended up covered by their own label.
  const labelAbove = tl.y >= 96;
  const labelInside = !labelAbove && h > 200;
  const labelTop = labelAbove ? tl.y - 31 : labelInside ? tl.y + 9 : tl.y + h + 11;
  const labelLeft = Math.min(
    Math.max(tl.x + (labelInside ? 9 : 0), 8),
    VIEWPORT.w - chipW - 8
  );

  return (
    <>
      {/* everything else recedes */}
      <div
        style={{
          position: "absolute",
          left: tl.x,
          top: tl.y,
          width: w,
          height: h,
          borderRadius: 12,
          boxShadow: `0 0 0 4000px rgba(6,6,12,${0.52 * e})`,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: tl.x,
          top: tl.y,
          width: w,
          height: h,
          borderRadius: 12,
          border: `2.4px solid ${CYAN}`,
          boxShadow: `0 0 ${18 * e}px rgba(34,211,238,.75), inset 0 0 ${
            14 * e
          }px rgba(34,211,238,.28)`,
          opacity: e,
          transform: `scale(${grow})`,
          transformOrigin: "center",
        }}
      />
      {cue.label ? (
        <div
          style={{
            position: "absolute",
            left: labelLeft,
            top: labelTop,
            transform: `translateY(${(1 - e) * (labelAbove ? 8 : -8)}px)`,
            opacity: e,
            background: CYAN,
            color: INK,
            fontSize: 13.5,
            fontWeight: 800,
            letterSpacing: -0.1,
            padding: "5px 11px",
            borderRadius: 999,
            whiteSpace: "nowrap",
            boxShadow: "0 6px 20px rgba(0,0,0,.45)",
          }}
        >
          {cue.label}
        </div>
      ) : null}
    </>
  );
};

const TapCue: React.FC<{ cue: Extract<Cue, { kind: "tap" }>; cam: ReturnType<typeof useCamera> }> = ({
  cue,
  cam,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = interpolate(frame, [cue.t * fps, cue.end * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (p <= 0 || p >= 1) return null;
  const at = cam.project(cue);
  const r = interpolate(p, [0, 1], [10, 40]);
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: at.x - r,
          top: at.y - r,
          width: r * 2,
          height: r * 2,
          borderRadius: "50%",
          border: `2.5px solid ${CYAN}`,
          opacity: 1 - p,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: at.x - 13,
          top: at.y - 13,
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "rgba(34,211,238,.4)",
          opacity: 1 - p * 0.7,
        }}
      />
    </>
  );
};

const Caption: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const line = voice.lines.find(
    (l) => frame >= (l.start - 0.15) * fps && frame <= (l.start + l.dur + 0.35) * fps
  );
  if (!line) return null;
  const start = line.start * fps;
  const end = (line.start + line.dur + 0.35) * fps;
  const o = interpolate(frame, [start - 4, start + 5, end - 7, end], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 96,
        right: 96,
        top: SCREEN_Y + SCREEN_H + 52,
        textAlign: "center",
        opacity: o,
        transform: `translateY(${(1 - o) * 8}px)`,
      }}
    >
      <span
        style={{
          display: "inline",
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
          background: "rgba(14,14,22,.92)",
          border: `1px solid ${EDGE}`,
          color: "#fafafa",
          fontSize: 37,
          lineHeight: 1.62,
          fontWeight: 600,
          padding: "9px 16px",
          borderRadius: 12,
        }}
      >
        {line.text}
      </span>
    </div>
  );
};

const Header: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const intro = spring({ frame, fps, config: { damping: 18, mass: 0.7 } });
  const progress = frame / durationInFrames;
  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 84,
          left: 0,
          right: 0,
          textAlign: "center",
          opacity: intro,
          transform: `translateY(${(1 - intro) * -14}px)`,
        }}
      >
        <div
          style={{
            display: "inline-block",
            color: CYAN,
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: 3,
            border: `1px solid rgba(34,211,238,.35)`,
            borderRadius: 999,
            padding: "6px 18px",
          }}
        >
          {String(voice.subtitle ?? "").toUpperCase()}
        </div>
        <div
          style={{
            marginTop: 16,
            color: "#fafafa",
            fontSize: 60,
            fontWeight: 800,
            letterSpacing: -1.4,
          }}
        >
          {voice.title}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 96,
          right: 96,
          bottom: 74,
          height: 5,
          borderRadius: 999,
          background: "rgba(255,255,255,.09)",
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            borderRadius: 999,
            background: CYAN,
            boxShadow: `0 0 14px rgba(34,211,238,.7)`,
          }}
        />
      </div>
    </>
  );
};

const ChapterBody: React.FC = () => {
  const cam = useCamera();

  return (
    <AbsoluteFill style={{ background: INK, fontFamily: "Helvetica, Arial, sans-serif" }}>
      {/* the app's own arena backdrop */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 45% at 50% 4%, rgba(34,211,238,.16), transparent 62%),
             radial-gradient(ellipse 46% 38% at 86% 78%, ${MAGENTA}14, transparent 60%)`,
        }}
      />

      <Header />

      {/* device */}
      <div
        style={{
          position: "absolute",
          left: SCREEN_X - 13,
          top: SCREEN_Y - 13,
          width: SCREEN_W + 26,
          height: SCREEN_H + 26,
          borderRadius: 54,
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
          borderRadius: 42,
          overflow: "hidden",
        }}
      >
        {/* everything inside works in the app's own CSS pixels */}
        <div
          style={{
            width: VIEWPORT.w,
            height: VIEWPORT.h,
            transform: `scale(${S})`,
            transformOrigin: "0 0",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.zoom})`,
              transformOrigin: "0 0",
            }}
          >
            <OffthreadVideo
              src={staticFile("chapter.mp4")}
              muted
              style={{ width: VIEWPORT.w, height: VIEWPORT.h, display: "block" }}
            />
          </div>

          {CUES.map((cue, i) =>
            cue.kind === "box" ? (
              <BoxCue key={i} cue={cue} cam={cam} />
            ) : (
              <TapCue key={i} cue={cue} cam={cam} />
            )
          )}
        </div>
      </div>

      <Caption />

      {voice.lines.map((l, i) => (
        <Sequence key={i} from={Math.round(l.start * 30)}>
          <Audio src={staticFile(`audio/${l.id}.mp3`)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

/**
 * The finished chapter: a branded card, the chapter itself, then the mark.
 *
 * The body sits inside a Sequence, so every cue time, caption time and audio
 * offset stays measured from the START OF THE CHAPTER rather than the start
 * of the file — the bookends are added without re-timing anything.
 */
export const INTRO_FRAMES = 36;
export const OUTRO_FRAMES = 54;

export const Chapter: React.FC = () => (
  <AbsoluteFill style={{ background: INK }}>
    <RemotionSequence from={INTRO_FRAMES}>
      <ChapterBody />
    </RemotionSequence>
    <RemotionSequence durationInFrames={INTRO_FRAMES}>
      <Bookend mode="intro" title={voice.title} />
    </RemotionSequence>
    <RemotionSequence from={INTRO_FRAMES + Math.ceil(cues.duration * 30)}>
      <Bookend mode="outro" />
    </RemotionSequence>
  </AbsoluteFill>
);
