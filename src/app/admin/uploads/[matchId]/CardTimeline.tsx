"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  inferredBounceMarkerTitle,
  inferredBounceMarkers,
  type MissCard,
} from "../serveMiss";

/**
 * One card's four sensors, side by side on one clock.
 *
 * The ear, the ball detector, the bounces the pipeline called out of that
 * track, and the serve it anchored. Reading them apart is what makes a
 * refusal explainable: a knock in the audio with no dot under it is a
 * bounce the eye missed, a gap in the ball row under a loud passage is the
 * track breaking up, and a serve marker sitting a second off the first
 * bounce is a different fault from either.
 *
 * Nothing here is a judgement and nothing is editable. It shows what was
 * recorded; the verdicts are in the rules list beside it.
 *
 * THE CLOCK. Every time in a card — track, bounces, crossings, impacts —
 * is in SOURCE seconds. So is `t`, which ServeMissView has already read
 * back off the video. Seeking converts the other way, which is the one
 * thing `onSeek` does.
 */

/**
 * The strip is measured, not scaled.
 *
 * A viewBox stretched to fit would shrink the row labels with it — at the
 * 523px this pane gives it, a 9-unit label renders under 5px and cannot be
 * read. Measuring the container and drawing at 1 unit = 1 pixel keeps text
 * at 9px and a bounce dot at 4px radius on a laptop and on a phone alike.
 * Only the x axis changes width, which is the only thing that should.
 */
const PLOT_X = 56;
const RIGHT_PAD = 4;
const VIEW_H = 132;

/** Row geometry, top to bottom. */
const WAVE_TOP = 10;
const WAVE_BASE = 44;
const TICK_BOTTOM = 55;
const BALL_TOP = 66;
const BALL_H = 11;
const BOUNCE_Y = 95;
const SERVE_Y = 117;

const TONE = {
  audio: "#f59e0b",
  ball: "#22d3ee",
  onSurface: "#50ff78",
  offSurface: "#ff5050",
  crossing: "#64748b",
  serve: "#facc15",
  /** The two bounces the serve rule accepted, told apart from the rest. */
  serveBounce: "#e879f9",
  inferredHigh: "#38bdf8",
  inferredMedium: "#7dd3fc",
  inferredDiagnostic: "#64748b",
};

export function CardTimeline({
  card,
  t,
  onSeek,
}: {
  card: MissCard;
  /** The playhead, in source seconds. */
  t: number;
  onSeek: (sourceSeconds: number) => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(box);
    setWidth(Math.round(box.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);

  const plotW = Math.max(80, width - PLOT_X - RIGHT_PAD);
  const span = Math.max(card.dur, 0.1);
  const x = (time: number) =>
    PLOT_X + ((time - card.t0) / span) * plotW;

  const audio = card.audio ?? null;
  const seen = card.seen ?? null;

  // Everything except the playhead depends only on the card, and the
  // playhead moves sixty times a second. Built once per card so a frame
  // costs one line rather than a thousand.
  const body = useMemo(() => {
    const px = (time: number) =>
      PLOT_X + ((time - card.t0) / span) * plotW;
    const inferred = inferredBounceMarkers(card);

    let wavePath = "";
    if (audio && audio.wave.length) {
      const stride = Math.max(1, Math.ceil(audio.wave.length / Math.max(1, plotW)));
      const pts: string[] = [];
      for (let i = 0; i < audio.wave.length; i += stride) {
        // Peak of the group, never the mean: a knock is one bin loud and
        // averaging it away is exactly what this row is for.
        let peak = 0;
        for (let j = i; j < Math.min(i + stride, audio.wave.length); j++) {
          if (audio.wave[j] > peak) peak = audio.wave[j];
        }
        const t0 = audio.t0 + i * audio.bin;
        const y = WAVE_BASE - (peak / 100) * (WAVE_BASE - WAVE_TOP);
        pts.push(`${px(t0).toFixed(1)},${y.toFixed(1)}`);
      }
      if (pts.length) {
        const first = pts[0].split(",")[0];
        const last = pts[pts.length - 1].split(",")[0];
        wavePath =
          `M${first},${WAVE_BASE} L` +
          pts.join(" L") +
          ` L${last},${WAVE_BASE} Z`;
      }
    }

    return (
      <>
        {/* the audio envelope */}
        {wavePath && <path d={wavePath} fill="#1e3a4a" stroke="none" />}
        <line
          x1={PLOT_X}
          x2={PLOT_X + plotW}
          y1={WAVE_BASE}
          y2={WAVE_BASE}
          stroke="#1e293b"
        />
        {audio?.impacts.map(([time, conf], i) => (
          <line
            key={`a${i}`}
            x1={px(time)}
            x2={px(time)}
            y1={WAVE_BASE}
            y2={TICK_BOTTOM}
            stroke={TONE.audio}
            strokeWidth="1.5"
            // A peak that barely cleared the threshold and one that
            // cleared it fivefold are not the same event.
            strokeOpacity={Math.min(1, 0.35 + conf / 6)}
          />
        ))}
        {!audio && (
          <text x={PLOT_X} y={WAVE_BASE - 4} fontSize="10" fill="#3f3f46">
            not measured on this match
          </text>
        )}

        {/* where the ball detector was holding the ball */}
        <line
          x1={PLOT_X}
          x2={PLOT_X + plotW}
          y1={BALL_TOP + BALL_H / 2}
          y2={BALL_TOP + BALL_H / 2}
          stroke="#1e293b"
        />
        {seen?.map(([a, b], i) => (
          <rect
            key={`s${i}`}
            x={px(a)}
            // A single detection is a real reading and must not vanish
            // into a zero-width rectangle.
            width={Math.max(1, px(b) - px(a))}
            y={BALL_TOP}
            height={BALL_H}
            rx="1.5"
            fill={TONE.ball}
            fillOpacity="0.75"
          />
        ))}
        {!seen && (
          <text x={PLOT_X} y={BALL_TOP + BALL_H} fontSize="10" fill="#3f3f46">
            not recorded
          </text>
        )}

        {/* every bounce, and the net crossings under them */}
        <line
          x1={PLOT_X}
          x2={PLOT_X + plotW}
          y1={BOUNCE_Y}
          y2={BOUNCE_Y}
          stroke="#1e293b"
        />
        {card.crossings.map((time, i) => (
          <line
            key={`c${i}`}
            x1={px(time)}
            x2={px(time)}
            y1={BOUNCE_Y + 2}
            y2={BOUNCE_Y + 9}
            stroke={TONE.crossing}
            strokeWidth="1"
          />
        ))}
        {card.bounces.map((b, i) => {
          const isServe = (card.serve_bounces ?? []).some(
            (st) => Math.abs(st - b.t) < 0.02
          );
          return (
            <circle
              key={`b${i}`}
              cx={px(b.t)}
              cy={BOUNCE_Y}
              r={isServe ? 5 : 4}
              fill={
                isServe
                  ? TONE.serveBounce
                  : b.onSurface
                    ? TONE.onSurface
                    : TONE.offSurface
              }
              fillOpacity="0.95"
            >
              <title>
                {`${(b.t - card.t0).toFixed(2)}s · ${
                  b.onSurface ? "on the playing surface" : "off the surface"
                }${isServe ? " · the serve" : ""}`}
              </title>
            </circle>
          );
        })}
        {inferred.map((marker) => {
          const centerX = px(marker.t);
          const markerY = BOUNCE_Y - 12;
          const tone =
            marker.preferred !== "latent_bounce"
              ? TONE.inferredDiagnostic
              : marker.tier === "high"
              ? TONE.inferredHigh
              : marker.tier === "medium"
                ? TONE.inferredMedium
                : TONE.inferredDiagnostic;
          return (
            <g key={`ib-${marker.id}`}>
              <title>{inferredBounceMarkerTitle(marker, card.t0)}</title>
              <line
                x1={px(marker.interval[0])}
                x2={px(marker.interval[1])}
                y1={markerY}
                y2={markerY}
                stroke={tone}
                strokeWidth="2"
                strokeOpacity={marker.tier === "diagnostic" ? 0.45 : 0.8}
              />
              <path
                d={`M ${centerX} ${markerY - 4} L ${centerX + 4} ${markerY} L ${centerX} ${markerY + 4} L ${centerX - 4} ${markerY} Z`}
                fill={
                  marker.preferred === "latent_bounce" && marker.tier === "high"
                    ? tone
                    : "#0c1222"
                }
                stroke={tone}
                strokeWidth="1.5"
                strokeOpacity={marker.tier === "diagnostic" ? 0.6 : 1}
              />
            </g>
          );
        })}

        {/* the serve, if one was anchored */}
        <line
          x1={PLOT_X}
          x2={PLOT_X + plotW}
          y1={SERVE_Y}
          y2={SERVE_Y}
          stroke="#1e293b"
        />
        {typeof card.serve_s === "number" ? (
          <>
            {/* through every row: what the ear and the ball were doing at
                the moment of contact is the question being asked. */}
            <line
              x1={px(card.serve_s)}
              x2={px(card.serve_s)}
              y1={WAVE_TOP}
              y2={SERVE_Y}
              stroke={TONE.serve}
              strokeOpacity="0.35"
              strokeWidth="1.5"
            />
            <circle
              cx={px(card.serve_s)}
              cy={SERVE_Y}
              r="5"
              fill={TONE.serve}
            />
          </>
        ) : (
          <text x={PLOT_X} y={SERVE_Y + 4} fontSize="10" fill="#3f3f46">
            none found in this card
          </text>
        )}

        <text x="4" y={WAVE_BASE - 2} fontSize="9" fill="#71717a">
          HEARD
        </text>
        <text x="4" y={BALL_TOP + BALL_H} fontSize="9" fill="#71717a">
          BALL
        </text>
        <text x="4" y={BOUNCE_Y + 3} fontSize="9" fill="#71717a">
          BOUNCES
        </text>
        <text x="4" y={SERVE_Y + 3} fontSize="9" fill="#71717a">
          SERVE
        </text>
      </>
    );
  }, [card, audio, seen, span, plotW]);

  const seek = (clientX: number) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box?.width) return;
    // One unit is one pixel, so this is a subtraction rather than a ratio.
    const frac = (clientX - box.left - PLOT_X) / plotW;
    onSeek(card.t0 + Math.min(1, Math.max(0, frac)) * span);
  };

  return (
    <div ref={boxRef} className="mt-2" style={{ minHeight: VIEW_H }}>
      {width > 0 && (
      <svg
        width={width}
        height={VIEW_H}
        viewBox={`0 0 ${width} ${VIEW_H}`}
        className="block cursor-pointer touch-none select-none"
        role="img"
        aria-label="What the microphone, the ball detector and the pipeline recorded across this card"
        onPointerDown={(e) => {
          // Seek FIRST. Capturing the pointer is what makes a drag keep
          // working past the edge of the strip, but it throws when the
          // pointer id is not one the browser is tracking, and doing it
          // first threw the tap away with it.
          seek(e.clientX);
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // A tap that cannot be captured still seeks; only the drag is lost.
          }
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) seek(e.clientX);
        }}
      >
        {body}
        <line
          x1={x(Math.min(Math.max(t, card.t0), card.t1))}
          x2={x(Math.min(Math.max(t, card.t0), card.t1))}
          y1={WAVE_TOP - 4}
          y2={SERVE_Y + 8}
          stroke="#f8fafc"
          strokeWidth="1.5"
        />
      </svg>
      )}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        <span>
          <i className="mr-1 inline-block h-2.5 w-0.5 align-middle bg-amber-500" />
          impact heard
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2.5 align-middle rounded-sm bg-cyan-glow/75" />
          ball held
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 align-middle rounded-full bg-[#e879f9]" />
          the serve&rsquo;s two bounces
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 align-middle rounded-full bg-[#50ff78]" />
          bounce on the table
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 align-middle rounded-full bg-[#ff5050]" />
          off the surface
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rotate-45 align-middle border border-sky-400 bg-sky-400" />
          latent bounce preferred
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rotate-45 align-middle border border-slate-500" />
          continuous or unclear
        </span>
        <span>
          <i className="mr-1 inline-block h-2.5 w-0.5 align-middle bg-slate-500" />
          net crossing
        </span>
      </div>
    </div>
  );
}
