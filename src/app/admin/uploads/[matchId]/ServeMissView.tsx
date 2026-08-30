"use client";

import { useEffect, useRef, useState } from "react";
import { CardTimeline } from "./CardTimeline";
import {
  TABLE_L_M,
  TABLE_W_M,
  reasonShort,
  reasonTone,
  type MissCard,
  type ServeMissData,
} from "../serveMiss";

/**
 * One card the assembler built without a serve, and why.
 *
 * The picture carries the table in pink, the net through the quad's true
 * centre in white, the play prism in cyan, the ball in yellow and every
 * bounce ringed — green where it landed on the playing surface, red where
 * it did not. The map beside it is the same bounces looking down on the
 * table, numbered in order, so "both on the same half" is something you can
 * SEE rather than take on trust.
 *
 * THE CLOCK. Everything in the diagnosis is in source seconds; the video is
 * the cut. `cutOffset` is added on the way in and never anywhere else, so
 * there is exactly one line in this file where the two clocks meet.
 */

export function ServeMissView({
  data,
  card,
  cutOffset,
  videoUrl,
}: {
  data: ServeMissData;
  card: MissCard;
  /** Seconds to add to a source time to reach the cut video. */
  cutOffset: number;
  videoUrl: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [t, setT] = useState(card.t0);
  const [playing, setPlaying] = useState(false);

  const cutT0 = card.t0 + cutOffset;
  const cutT1 = card.t1 + cutOffset;

  // Park the poster inside the card rather than at the top of the match.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const seek = () => {
      v.currentTime = cutT0;
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener("loadedmetadata", seek, { once: true });
    // A <video> removed from the document keeps playing, with sound.
    return () => {
      v.pause();
    };
  }, [cutT0]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c) return;
      const w = v.clientWidth;
      const h = v.clientHeight;
      if (!w || !h) return;
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      const sx = w / data.w;
      const sy = h / data.h;
      // THE one conversion: the video's clock, read back into the
      // assembler's. Everything below is source seconds.
      const now = v.currentTime - cutOffset;
      setT(now);

      if (!v.paused && now > card.t1) {
        v.pause();
        v.currentTime = cutT0;
      }

      // the play prism — how high above the table a ball may plausibly be
      ctx.beginPath();
      data.prism.forEach(([px, py], i) => {
        const X = px * sx;
        const Y = py * sy;
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      ctx.closePath();
      ctx.strokeStyle = "rgba(0,220,255,0.55)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // the table
      ctx.beginPath();
      data.quad.forEach(([px, py], i) => {
        const X = px * sx;
        const Y = py * sy;
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      ctx.closePath();
      ctx.strokeStyle = "#ff2d95";
      ctx.lineWidth = 2;
      ctx.stroke();

      // the net, through the quad's true centre
      ctx.beginPath();
      ctx.moveTo(data.net[0][0] * sx, data.net[0][1] * sy);
      ctx.lineTo(data.net[1][0] * sx, data.net[1][1] * sy);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#f8fafc";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);

      // the ball, the half second behind the playhead
      let prev: { x: number; y: number } | null = null;
      for (const [pt, fx, fy] of card.track) {
        const age = now - pt;
        if (age < 0 || age > 0.5) {
          prev = null;
          continue;
        }
        const X = fx * w;
        const Y = fy * h;
        const fade = 1 - age / 0.5;
        if (prev) {
          ctx.globalAlpha = 0.15 + 0.5 * fade;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(X, Y);
          ctx.strokeStyle = "#facc15";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.globalAlpha = 0.3 + 0.7 * fade;
        ctx.beginPath();
        ctx.arc(X, Y, age < 0.06 ? 4 : 2, 0, Math.PI * 2);
        ctx.fillStyle = "#facc15";
        ctx.fill();
        ctx.globalAlpha = 1;
        prev = { x: X, y: Y };
      }

      // every bounce, held a third of a second either side so a 30fps
      // event is visible at all
      for (const b of card.bounces) {
        const age = now - b.t;
        if (age < -0.34 || age > 0.34) continue;
        const fade = 1 - Math.abs(age) / 0.34;
        ctx.globalAlpha = 0.25 + 0.75 * fade;
        ctx.beginPath();
        ctx.arc(b.x * w, b.y * h, 5 + 8 * (1 - fade), 0, Math.PI * 2);
        ctx.strokeStyle = b.onSurface ? "#50ff78" : "#ff5050";
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [data, card, cutOffset, cutT0]);

  const why = card.why;

  return (
    <div className="mt-3 rounded-2xl border border-edge bg-surface-2/40 p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
      <div className="min-w-0 lg:flex-[2]">
      {/* Sized on the div, never the video: a media element has no
          intrinsic size until metadata arrives, and the canvas measures
          the video, so a self-sized video makes the overlay jump. */}
      <div
        className="relative overflow-hidden rounded-xl bg-black"
        style={{ aspectRatio: `${data.w} / ${data.h}` }}
      >
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            preload="metadata"
            playsInline
            muted
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            className="absolute inset-0 block h-full w-full"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-zinc-500">No video for this card.</p>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute left-0 top-0 h-full w-full"
        />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            if (v.paused) {
              if (v.currentTime < cutT0 || v.currentTime > cutT1) {
                v.currentTime = cutT0;
              }
              void v.play();
            } else v.pause();
          }}
          className="shrink-0 rounded-full border border-edge px-3 py-1 text-sm text-zinc-200 transition-colors hover:border-cyan-glow/40"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          aria-label="Scrub this card"
          min={card.t0}
          max={card.t1}
          step={0.04}
          value={Math.min(Math.max(t, card.t0), card.t1)}
          onChange={(e) => {
            const v = videoRef.current;
            if (v) v.currentTime = Number(e.target.value) + cutOffset;
          }}
          className="h-1 min-w-0 flex-1 accent-cyan-400"
        />
        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-zinc-500">
          {Math.max(0, t - card.t0).toFixed(1)}s / {card.dur.toFixed(1)}s
        </span>
      </div>

      {/* What each sensor recorded across the same seconds. Under the
          picture rather than beside it: the rows and the video share an
          x axis only if they share a width. */}
      <CardTimeline
        card={card}
        t={t}
        onSeek={(sourceSeconds) => {
          const v = videoRef.current;
          if (v) v.currentTime = sourceSeconds + cutOffset;
        }}
      />

      </div>

      <div className="flex min-w-0 flex-row gap-3 lg:flex-1">
        <div className="w-24 shrink-0 sm:w-32 lg:w-40">
          <Court card={card} t={t} />
        </div>
        <div className="min-w-0 flex-1">
          {typeof card.serve_s === "number" ? (
            <p className="text-sm text-zinc-300">
              Serve found {(card.serve_s - card.t0).toFixed(2)}s into the
              card. The rings are every bounce the detector saw — green on
              the playing surface, red off it — so the first bounce and
              where it landed can be checked against the picture.
            </p>
          ) : (
            <p className="text-sm text-zinc-300">
              {data.reasons[why.reason] ?? reasonShort(why.reason)}
            </p>
          )}
          <p className="mt-1 text-xs text-zinc-500">
            {why.bounces} bounce{why.bounces === 1 ? "" : "s"} in the card,{" "}
            {why.on_surface} on the table surface, {why.pairs} pair
            {why.pairs === 1 ? "" : "s"} tested.
            {card.crossings.length > 0 &&
              ` ${card.crossings.length} net crossing${card.crossings.length === 1 ? "" : "s"}.`}
          </p>
          {why.detail.length > 0 && (
            <ul className="mt-2 space-y-1">
              {why.detail.slice(0, 8).map(([a, b, rule], i) => (
                <li
                  key={`${a}-${b}-${i}`}
                  className="flex items-center gap-2 text-xs"
                >
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: reasonTone(rule) }}
                  />
                  <span className="tabular-nums text-zinc-500">
                    {(a - card.t0).toFixed(2)}s + {(b - a).toFixed(2)}s
                  </span>
                  <span className="min-w-0 text-zinc-400">
                    {reasonShort(rule)}
                  </span>
                </li>
              ))}
              {why.detail.length > 8 && (
                <li className="text-xs text-zinc-600">
                  and {why.detail.length - 8} more pairs
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

/** Where the bounces landed, looking down on the table. */
function Court({ card, t }: { card: MissCard; t: number }) {
  const VIEW_W = 150;
  const VIEW_H = 260;
  const TX = 25;
  const TY = 15;
  const TW = 100;
  const TH = 230;
  const xy = (u: number, v: number) => ({
    x: TX + (TW * u) / TABLE_W_M,
    y: TY + TH * (1 - v / TABLE_L_M),
  });
  const placed = card.bounces.filter((b) => b.u !== null && b.v !== null);
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full">
      <rect
        x={TX}
        y={TY}
        width={TW}
        height={TH}
        rx="3"
        fill="#0f2557"
        stroke="#cbd5e1"
        strokeWidth="1.5"
      />
      <line
        x1={TX}
        y1={TY + TH / 2}
        x2={TX + TW}
        y2={TY + TH / 2}
        stroke="#f8fafc"
        strokeWidth="1.75"
        strokeDasharray="4 2"
      />
      {placed.map((b, i) => {
        const p = xy(b.u as number, b.v as number);
        const live = Math.abs(t - b.t) < 0.34;
        return (
          <g key={`${b.t}-${i}`}>
            <title>
              {`${(b.t - card.t0).toFixed(2)}s into the card · `
                + `${b.u?.toFixed(2)}, ${b.v?.toFixed(2)} m · `
                + `${b.onSurface ? "on the surface" : "off the surface"}`}
            </title>
            <circle
              cx={p.x}
              cy={p.y}
              r={live ? 6 : 3.5}
              fill={b.onSurface ? "#50ff78" : "#ff5050"}
              fillOpacity={live ? 0.95 : 0.4}
              stroke="#0c1222"
              strokeWidth="0.75"
            />
            <text
              x={p.x}
              y={p.y - 5}
              textAnchor="middle"
              fontSize="6"
              fill="#94a3b8"
            >
              {i + 1}
            </text>
          </g>
        );
      })}
      <text x={TX} y={TY + TH + 11} fontSize="7" fill="#71717a">
        near end
      </text>
      <text x={TX} y={TY - 5} fontSize="7" fill="#71717a">
        far end
      </text>
    </svg>
  );
}
