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
import insertData from "./inserts.json";
import voice from "./voice.json";
import { CYAN, EDGE, INK } from "./theme";

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

/**
 * The device is as large as the page will let it be, rather than a number
 * somebody picked.
 *
 * It used to be a constant — 620 on a 1080 canvas, which left the phone at
 * 57% of the frame width with a fifth of the picture empty on either side.
 * Now the vertical budget is declared and the device takes what is left:
 *
 *   HEADER_BOTTOM   the section label and its progress hairline
 *   PAD             breathing room above and below the device
 *   CAPTION_H       reserved for the spoken line, at its worst
 *   CAPTION_BOTTOM  the caption's own margin off the canvas edge
 *
 * CAPTION_H is the number that matters and it is measured, not guessed:
 * every line in the script is rendered as a still and checked (see the note
 * on the caption below). Reserving it here rather than hoping is what lets
 * the device grow at all — the caption is the only thing it can collide
 * with, and the collision would be a sentence nobody gets to read.
 *
 * The portrait cut cannot fill its width no matter what: a phone screen is
 * 390x844, near enough 9:19.5, and the canvas is 9:16. Something has to be
 * empty, and empty at the sides beats cropping the app.
 */
const HEADER_BOTTOM = PORTRAIT ? 109 : 71;
const PAD = PORTRAIT ? 26 : 22;
const CAPTION_H = PORTRAIT ? 190 : 119;
const CAPTION_BOTTOM = 24;

const FIT_H = CANVAS.h - CAPTION_BOTTOM - CAPTION_H - PAD - (HEADER_BOTTOM + PAD);
const FIT_W = CANVAS.w - (PORTRAIT ? 96 : 120);
const SCREEN_W = Math.min(FIT_W, Math.round((FIT_H * VP.w) / VP.h));
const SCREEN_H = Math.round((SCREEN_W * VP.h) / VP.w);
const SCREEN_X = Math.round((CANVAS.w - SCREEN_W) / 2);
const SCREEN_Y = HEADER_BOTTOM + PAD + Math.round((FIT_H - SCREEN_H) / 2);
/** CSS px -> canvas px, so every recorded cue rect stays in CSS pixels. */
const S = SCREEN_W / VP.w;
const RADIUS = PORTRAIT ? 50 : 18;

export const FPS = 30;
export const INTRO_FRAMES = 40;
const BODY_FRAMES = Math.ceil((cues as { duration: number }).duration * FPS);

/**
 * The closing line is spoken over the LOGO, not over the last screen.
 *
 * It is the one line with no picture to prove, so it plays where the eye has
 * nothing else to do. That means its audio cannot live with the rest: the
 * body is a Sequence clipped to the capture, so anything scheduled past the
 * end of the recording is simply dropped. It rides the outro card instead,
 * and the card is made long enough to hold it.
 */
const OUTRO_LINE = voice.lines.find(
  (l) => (l as { beat?: string }).beat === "outro"
) as { id: string; dur: number } | undefined;
const OUTRO_LEAD = 12;
export const OUTRO_FRAMES = OUTRO_LINE
  ? OUTRO_LEAD + Math.ceil(OUTRO_LINE.dur * FPS) + 36
  : 64;
export const TOTAL_FRAMES = INTRO_FRAMES + BODY_FRAMES + OUTRO_FRAMES;

/**
 * No backdrop gradient, and that omission is the whole reason this video
 * sits on the landing page without an edge.
 *
 * The composition used to paint a cyan and magenta wash behind everything.
 * Inside a rectangle, on a page that is flat --color-ink, that wash IS the
 * rectangle: a tonal box with corners, however soft the gradient. Take it
 * out and the canvas is the exact colour the page is painted in, so the
 * device, the label and the caption are all anyone sees.
 *
 * The ambience did not disappear, it moved: src/app/page.tsx draws the same
 * glow behind the whole section, where it can spread past the video's edges
 * instead of stopping at them. The cost is the standalone file, now plain
 * black behind the device rather than lit. Worth it — the landing page is
 * where anyone will actually watch this.
 */

/** The lens ring, drawn rather than fetched so the render has no assets. */
const Logo: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="20" stroke={CYAN} strokeWidth="3.5" />
    <circle cx="24" cy="24" r="20" stroke="rgba(255,255,255,.12)" strokeWidth="1" />
  </svg>
);

/**
 * How far the wordmark sits under the lens ring, before the 1.15x landscape
 * scale.
 *
 * It was 30, which is a normal lockup gap and the wrong number here. The
 * first frame of this video is also the poster on the landing page, and the
 * landing page draws a play button over the ring — so whatever space is
 * left between the ring and the wordmark is the only clearance that button
 * has. At 30 the button's edge sat on the "L" of PongLens.
 *
 * This is the poster's job showing through into the video's brand card. The
 * card is airier for it, which is no loss; a lockup with room in it does not
 * look like a mistake, and a play button touching a wordmark does.
 */
const LOCKUP_GAP = 150;

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
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: LOCKUP_GAP * scale,
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
            {(voice as { tagline?: string }).tagline ??
              "Film the match once. Learn from it all year."}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * The sections, in order, with the slice of the video each one owns.
 *
 * Derived from the labels in the narration rather than declared: a section
 * is a run of consecutive lines that share a label, and it lasts from the
 * start of its first line to the start of the next section's.
 *
 * This exists because of one piece of feedback. A developer watching the
 * cut said it showed every feature but gave him no way to orient himself —
 * "is that step 1 or 3, of 2 or of 3" — and he never registered the labels
 * at all. Ten labels over two minutes is a rolling caption, not a
 * structure. Grouped into seven and drawn as segments, the same hairline
 * that was already there answers the question he was asking: how many
 * sections there are, and which one this is.
 *
 * Deliberately NOT numbered. "3 of 7" on a landing video reads as a
 * tutorial, which is a promise of effort rather than of value.
 */
const SECTIONS = (() => {
  const out: { label: string; start: number; end: number }[] = [];
  for (const l of voice.lines) {
    const label = (l as { label?: string }).label ?? "";
    const last = out[out.length - 1];
    if (last && last.label === label) last.end = l.start + l.dur;
    else out.push({ label, start: l.start, end: l.start + l.dur });
  }
  // The unlabelled opening and close are real time and get their own
  // segments; leaving them out would make the bar lie about where you are.
  return out;
})();

/**
 * A one-second title in the silence before each section.
 *
 * The label above the device was not doing the job. Two people watched the
 * cut and neither registered it, and the honest reading is that a small line
 * of type above a moving screen is not where anyone is looking. So the
 * section announces itself where nothing else is competing: the gap between
 * two sentences, with the picture covered.
 *
 * It costs no runtime. Every card sits inside silence the script already
 * had, which is why the boundary pauses in chapters/landing.json are set to
 * two seconds. It also covers the navigation that happens in exactly those
 * gaps, so the page load that used to be a dark frame is now behind a title.
 *
 * Short on purpose. This is a landing video, not a chapter list: long enough
 * to read three words, gone before it feels like an interruption.
 */
const CARD_HEAD = 0.05;
const CARD_TAIL = 0.15;
const TITLE_MAX = 1.4;
const CARD_MIN = 0.6;

/** How far a separator's card runs either side of the line spoken over it.
 *  Declared up here rather than beside the component because the section
 *  cards below are computed against these at module load. */
const SEPARATOR_LEAD = 0.45;
const SEPARATOR_TAIL = 0.7;

/**
 * The separators, and how long each one holds.
 *
 * A separator is spoken over its own card; a section card sits in silence.
 * Put one straight after the other — which is what the intro script does,
 * because the first section of each half begins the moment the half is
 * announced — and you get two full-frame titles back to back with no
 * picture between them. It reads as the video stuttering rather than as
 * two announcements.
 *
 * So the separator simply stays up until the next sentence starts, and the
 * section card that would have followed it is dropped. One announcement,
 * one hold, then the screen. The hold is not wasted either: it is the same
 * window the capture uses to load the next page, and extending it means
 * that load has cover for as long as it needs rather than for the fixed
 * 0.7s tail.
 */
const SEPARATORS = voice.lines
  .map((l, i) => {
    const sep = (l as { separator?: string }).separator;
    if (!sep) return null;
    const next = voice.lines[i + 1];
    return {
      label: sep,
      from: l.start - SEPARATOR_LEAD,
      // Whichever is later: its own tail, or the moment the next line
      // starts. The second is what stops the gap being uncovered once the
      // section card is dropped.
      to: Math.max(
        l.start + l.dur + SEPARATOR_TAIL,
        next ? next.start - CARD_TAIL : 0
      ),
    };
  })
  .filter((s): s is { label: string; from: number; to: number } => s !== null);

const overlapsSeparator = (from: number, to: number) =>
  SEPARATORS.some((s) => from < s.to && to > s.from);

/**
 * The card COVERS the whole gap; the title only shows for part of it.
 *
 * Those are two different jobs and conflating them was a bug. When the card
 * was sized to the title — about a second and a half before the next line —
 * every section leaked: the flow changes screen the moment the previous
 * line ends, so the Score Keeper was on screen a second before the card
 * saying "Score the match", and the player was up two and a half seconds
 * before "Playback". Measured across all seven, the leak ran from 0.35s to
 * 2.6s.
 *
 * So the cover starts as soon as the previous line stops and runs until the
 * next one starts. Nothing the flow does in the silence can be seen, which
 * is a guarantee rather than a set of seven separately-tuned lead times.
 * The title then sits in the middle of that cover for up to 1.4s, so a long
 * transition reads as a held beat rather than as a long title.
 */
const SECTION_CARDS = SECTIONS.map((s, i) => {
  const prevEnd = i > 0 ? SECTIONS[i - 1].end : 0;
  const from = prevEnd + CARD_HEAD;
  const to = s.start - CARD_TAIL;
  const span = Math.max(0, to - from);
  const show = Math.min(TITLE_MAX, Math.max(0, span - 0.3));
  const titleFrom = from + (span - show) / 2;
  return { label: s.label, from, to, titleFrom, titleTo: titleFrom + show };
})
  .filter((c) => c.label && c.to - c.from >= CARD_MIN)
  // A separator has already announced this one and is still holding.
  .filter((c) => !overlapsSeparator(c.from, c.to));

const SectionCard: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const card = SECTION_CARDS.find((c) => t >= c.from && t <= c.to);
  if (!card) return null;

  const start = card.from * FPS;
  const end = card.to * FPS;
  // Fast in, fast out. A slow fade on a one-second card is all fade.
  const o = interpolate(frame, [start, start + 4, end - 5, end], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // The title has its own window inside the cover.
  const tStart = card.titleFrom * FPS;
  const tEnd = card.titleTo * FPS;
  const titleO = interpolate(frame, [tStart, tStart + 4, tEnd - 4, tEnd], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rise = spring({
    frame: frame - tStart,
    fps: FPS,
    config: { damping: 26, mass: 0.5 },
  });
  const scale = PORTRAIT ? 1 : 1.05;

  return (
    <AbsoluteFill
      style={{
        background: INK,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 22 * scale,
        opacity: o,
      }}
    >
      <div
        style={{
          opacity: titleO,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 22 * scale,
        }}
      >
      <div
        style={{
          width: 88 * scale,
          height: 3,
          borderRadius: 3,
          background: CYAN,
          transform: `scaleX(${rise})`,
        }}
      />
      <div
        style={{
          fontFamily: "Helvetica, Arial, sans-serif",
          fontSize: 68 * scale,
          fontWeight: 700,
          letterSpacing: -1.2,
          color: "#fff",
          transform: `translateY(${(1 - rise) * 10}px)`,
        }}
      >
        {card.label}
      </div>
      </div>
    </AbsoluteFill>
  );
};

/** The section label above the device, and the progress hairline. */
const Header: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = frame / FPS;
  const line = voice.lines.find((l) => t >= l.start - 0.3 && t <= l.start + l.dur + 0.5);
  const label = (line as { label?: string } | undefined)?.label ?? "";
  const progress = frame / durationInFrames;
  const scale = PORTRAIT ? 1 : 0.82;

  // Segment widths are proportional to real time, so a long section looks
  // long. The body is what the bar measures: the bookends are not part of
  // the story and a segment for them would be a segment nobody is in.
  const GAP = 4;
  const played = progress * durationInFrames / FPS;

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: PORTRAIT ? 54 : 30,
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

      {/* One segment per section, widths proportional to real time.
          The segment you are in fills as you cross it; the ones behind are
          solid and the ones ahead are dim. Nothing is numbered and nothing
          is labelled, so it reads as "how far in am I" rather than as a
          checklist. */}
      <div
        style={{
          position: "absolute",
          left: SCREEN_X,
          width: SCREEN_W,
          top: PORTRAIT ? 106 : 68,
          height: 3,
          display: "flex",
          gap: GAP,
        }}
      >
        {SECTIONS.map((s, i) => {
          const span = s.end - s.start;
          const done = played >= s.end;
          const fill = done
            ? 1
            : played <= s.start
              ? 0
              : (played - s.start) / span;
          return (
            <div
              key={i}
              style={{
                // flexGrow by duration, so the widths add up to the bar no
                // matter how the sections are cut.
                flexGrow: span,
                flexBasis: 0,
                height: "100%",
                borderRadius: 3,
                background: "rgba(255,255,255,.09)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.max(0, Math.min(1, fill)) * 100}%`,
                  height: "100%",
                  borderRadius: 3,
                  background: CYAN,
                  // The section you are in is the bright one; the ones
                  // behind stay lit but step back, so the eye lands on
                  // where you are rather than on everywhere you have been.
                  opacity: done ? 0.45 : 1,
                }}
              />
            </div>
          );
        })}
      </div>
    </>
  );
};

/**
 * A held card that divides the video into sections.
 *
 * The player half and the coach half of the intro video are two different
 * products to anyone watching, and running one into the other with nothing
 * between them reads as the video losing its place. A line in the script
 * carries `separator`, and for as long as that line is spoken the card
 * covers the device.
 *
 * Covering the device is the point, not a side effect. The capture uses
 * exactly this window to sign out of the player's account and in as the
 * coach, which is four seconds of login screens and redirects that nobody
 * should have to watch.
 *
 * Drawn under Header and Caption, so the progress hairline keeps running
 * across the top and the spoken line still reads at the bottom. The video
 * pauses on a title; it does not stop.
 *
 * It also stands in for the section card that would otherwise follow it,
 * holding until the next sentence begins — see SEPARATORS above for why
 * two cards in a row was the wrong answer.
 */
const Separator: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const card = SEPARATORS.find((s) => t >= s.from && t <= s.to);
  if (!card) return null;

  const start = card.from * FPS;
  const end = card.to * FPS;
  const o = interpolate(frame, [start, start + 10, end - 10, end], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rise = spring({
    frame: frame - start,
    fps: FPS,
    config: { damping: 22, mass: 0.7 },
  });
  const scale = PORTRAIT ? 1 : 1.1;

  return (
    <AbsoluteFill
      style={{
        background: INK,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 26 * scale,
        opacity: o,
      }}
    >
      <div
        style={{
          width: 110 * scale,
          height: 3,
          borderRadius: 3,
          background: CYAN,
          transform: `scaleX(${rise})`,
        }}
      />
      <div
        style={{
          fontFamily: "Helvetica, Arial, sans-serif",
          fontSize: 78 * scale,
          fontWeight: 700,
          letterSpacing: -1.4,
          color: "#fff",
          transform: `translateY(${(1 - rise) * 14}px)`,
        }}
      >
        {card.label}
      </div>
    </AbsoluteFill>
  );
};

/**
 * Footage this pipeline cannot shoot, held in a device of its own.
 *
 * Everything else in this video is one continuous Playwright capture of the
 * WEB app, and that is the whole reason the picture stays honest: re-run the
 * capture after a UI change and every shot moves with it. The recorder is a
 * native iOS screen. Playwright cannot reach it, at any viewport, ever.
 *
 * So it arrives as a separate file with its own window, drawn over the main
 * device while it plays. Two things fall out of that, and both are wanted:
 *
 * IT IS LANDSCAPE. You turn the phone sideways to film a match, so the
 * insert is a phone on its side rather than the upright one the rest of the
 * video uses. The shape IS the message; forcing it upright would be a lie
 * about how the feature is used.
 *
 * IT SERVES BOTH CUTS. The desktop cut has no recorder to show — this is a
 * phone-only feature — and a landscape phone on the 16:9 backdrop is a
 * better answer than pretending a browser can do it.
 *
 * Sized off the canvas rather than off the main device, because the main
 * device is a portrait phone on one cut and a laptop on the other, and this
 * wants to look the same in both.
 */
type Insert = { src: string; from: number; to: number; w: number; h: number };
const INSERTS: Insert[] = (insertData as { inserts?: Insert[] }).inserts ?? [];

/**
 * One Sequence per insert, and that is not a tidiness choice.
 *
 * OffthreadVideo reads the clock of the Sequence it sits in. Rendered bare
 * inside Body, an insert placed at 21.6s asked a seven-second clip for its
 * 21.6-second mark — so it never played from the beginning, and the beat
 * opened somewhere arbitrary in the middle of a rally. Wrapping each insert
 * in its own Sequence restarts that clock at zero, which is the whole
 * reason the clip can be cut to open on a serve.
 */
const InsertClip: React.FC = () => (
  <>
    {INSERTS.map((clip, i) => (
      <Sequence
        key={i}
        from={Math.round(clip.from * FPS)}
        durationInFrames={Math.max(1, Math.round((clip.to - clip.from) * FPS))}
      >
        <InsertBody clip={clip} />
      </Sequence>
    ))}
  </>
);

const InsertBody: React.FC<{ clip: Insert }> = ({ clip }) => {
  const frame = useCurrentFrame();
  const total = Math.max(1, Math.round((clip.to - clip.from) * FPS));
  // Slower than a section card's cut: this is a change of device, not a
  // change of subject, and a hard cut to a different shape reads as a fault.
  const o = interpolate(frame, [0, 8, total - 8, total], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rise = spring({ frame, fps: FPS, config: { damping: 24, mass: 0.7 } });

  const ratio = clip.w / clip.h;
  const width = Math.round(Math.min(CANVAS.w - (PORTRAIT ? 84 : 520), 1400));
  const height = Math.round(width / ratio);
  const left = Math.round((CANVAS.w - width) / 2);
  // Centred on the device area rather than on the canvas, so the caption
  // below it keeps the room it was given.
  const top = Math.round(SCREEN_Y + (SCREEN_H - height) / 2);
  const radius = PORTRAIT ? 34 : 30;

  return (
    <AbsoluteFill style={{ background: INK, opacity: o }}>
      <div
        style={{
          position: "absolute",
          left: left - 12,
          top: top - 12,
          width: width + 24,
          height: height + 24,
          borderRadius: radius + 11,
          background: "#05050a",
          border: `1px solid ${EDGE}`,
          boxShadow:
            "0 40px 90px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.04), 0 0 70px rgba(34,211,238,.12)",
          transform: `translateY(${(1 - rise) * 14}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left,
          top,
          width,
          height,
          borderRadius: radius,
          overflow: "hidden",
          transform: `translateY(${(1 - rise) * 14}px)`,
        }}
      >
        <OffthreadVideo
          src={staticFile(clip.src)}
          muted
          style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
        />
      </div>
    </AbsoluteFill>
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
  // A small square target gets a circle, not a rounded square. Ringing a
  // 36px icon with the section-sized radius reads as a box drawn around
  // nothing; the microphone beat was pointing at two of them and the ring
  // looked like a mistake.
  const iconish = w <= 64 && h <= 64 && Math.abs(w - h) <= 10;
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
          borderRadius: iconish ? 999 : 14,
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
        // Wider than it was: the caption used to be 1320px on a 1920 canvas,
        // which put the longest line of narration about seventy pixels over
        // the two-line mark.
        left: PORTRAIT ? 44 : 130,
        right: PORTRAIT ? 44 : 130,
        // Anchored to the BOTTOM, not to the device. Pinned under the device
        // it grew downward, and the third line of the longest line in the
        // script fell off the canvas — a sentence the viewer simply never
        // got to read. From here it grows up into the gap instead, which is
        // where subtitles live anyway.
        bottom: CAPTION_BOTTOM,
        textAlign: "center",
        fontFamily: "Helvetica, Arial, sans-serif",
        // A floor under the longest lines, so growing upward can never reach
        // the device either.
        fontSize: (line.text.length > 120 ? 34 : 40) * scale,
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

    {/* Over the device, under the header and the caption. The insert goes
        under the cards too: a section title has to win over a clip the same
        way it wins over the app. */}
    <InsertClip />
    <Separator />
    <SectionCard />
    <Header />
    <Caption />

    {voice.lines
      .filter((l) => (l as { beat?: string }).beat !== "outro")
      .map((l, i) => (
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
      {OUTRO_LINE && (
        <Sequence from={OUTRO_LEAD}>
          <Audio src={staticFile(`audio/${OUTRO_LINE.id}.mp3`)} />
        </Sequence>
      )}
    </Sequence>
  </AbsoluteFill>
);
