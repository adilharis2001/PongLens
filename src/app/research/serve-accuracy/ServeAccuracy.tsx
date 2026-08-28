"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findDeadRuns } from "./deadRun";
import { ballDiedLoser, ballDiedReasonCopy, findBallDied } from "./ballDied";
import { findOffTable, offTableLoser, offTableWithheld } from "./offTable";
import { netSegment } from "./netDeath";
import { findNoReturn, noReturnLoser } from "./noReturn";
import {
  readPoint,
  rulesDisagree,
  type PointReading,
  type Tracks,
} from "./pointReading";
import { isRecovered } from "./segments";
import {
  classify,
  outcomeTotals,
  reasonSummary,
  type Bucketed,
  type Outcome,
} from "./buckets";
import { recoverServe, serverSideFor, type ServePair } from "./serveRepair";
import { activeTouch, touchList, type Touch } from "./touches";
import { finalExits, inPrism, prismPolygon, type Pt } from "./prism";
import {
  REJECTION_COPY,
  TABLE_L_M,
  TABLE_W_M,
  type DetectedEvent,
  type ServeAccuracyMatch,
  type ServeAccuracyRow,
  type TrackSlug,
} from "./serveAccuracyModel";

/**
 * Everything measured about a point, beside the video it was measured from.
 *
 * The page exists to answer one question: which of these numbers can be
 * shown to a player without embarrassment. So it shows the working — every
 * detected touch, where the table was thought to be, what the worker
 * called, and how fast the serve crossed — rather than only the parts that
 * survived a filter.
 *
 * What is NOT here, because it is not kept: the ball's position on every
 * frame. Production stores the touches it decided on, not the track they
 * came from.
 */

const CORNER_ORDER = ["A_near_1", "B_near_2", "C_far_2", "D_far_1"] as const;

/**
 * What every mark on this page means.
 *
 * Written down because it was not, and a page of unexplained colours is a
 * page nobody can check. Each entry names the colour, the shape and — the
 * part that actually matters — where the number came from.
 */
const LEGEND: {
  swatch: string;
  ring?: boolean;
  label: string;
  where: string;
}[] = [
  {
    swatch: "#ff2d95",
    ring: true,
    label: "Table outline, on the clip",
    where: "the four calibrated corners; everything else is measured against it",
  },
  {
    swatch: "#a78bfa",
    label: "Serve's first bounce",
    where: "on the server's own half",
  },
  {
    swatch: "#22d3ee",
    label: "Serve's landing",
    where: "on the receiver's half — this is the dot the serve map draws",
  },
  {
    swatch: "#f59e0b",
    ring: true,
    label: "Rally ending",
    where: "last shot with a landing, ungated and measured against nothing",
  },
  {
    swatch: "#22d3ee",
    ring: true,
    label: "Serve landing put back by the flights",
    where:
      "the detector found only one of the serve's two bounces; the ball's "
      + "own flight supplied the other",
  },
  {
    swatch: "#22d3ee",
    ring: true,
    label: "Landing put back by the flights",
    where:
      "the detector missed it; the ball's arc either side of the gap says it "
      + "was there",
  },
  {
    swatch: "#f472b6",
    label: "Racket contact",
    where: "a touch the reconstruction cast as a hit rather than a bounce",
  },
  {
    swatch: "#94a3b8",
    label: "Other bounce",
    where: "detected, numbered in time order, no part in the serve",
  },
  {
    swatch: "#ef4444",
    label: "Net or out",
    where: "how the reconstruction thought the ball left play",
  },
  {
    swatch: "#facc15",
    label: "Ball track",
    where: "BlurBall re-run on this clip; the fading tail is the last half second",
  },
  {
    swatch: "#38bdf8",
    ring: true,
    label: "Prism",
    where:
      "the table lifted 1.6 m, per end; a rally lives inside it and the ball "
      + "leaves once, when it is finally missed",
  },
  {
    swatch: "#f87171",
    label: "Ball outside the prism",
    where: "the track turns red the moment it is out of the volume",
  },
  {
    swatch: "#f472b6",
    ring: true,
    label: "Last landing",
    where:
      "the last bounce that actually landed on the table. Whoever's half it "
      + "is on plays the next shot, and if nothing lands after that shot, "
      + "they lost the point there",
  },
  {
    swatch: "#34d399",
    ring: true,
    label: "Ball died",
    where:
      "the ball bouncing itself out on one half — the point is over, and the "
      + "side it died on lost it. Two witnesses to the same thing: three or "
      + "more bounces with nobody hitting the ball, or the track turning at "
      + "the net and dropping twice. Where the ball was last seen says which "
      + "kind of ending it was — same end and that player put it into the "
      + "net, other end and they never got it back",
  },
];

/**
 * What the two rules together make of a point: the dead run where it
 * speaks, the off-table read otherwise, and null when neither will.
 * The filters, the counts and the row all ask this, so they cannot drift
 * apart on which rule won an argument.
 */
type Corners = ServeAccuracyMatch["corners"];
type SourceDims = ServeAccuracyMatch["source"];

/**
 * The page's one reading of a point, memoised per render pass.
 *
 * Every chip, counter and row asks through here, so they cannot disagree
 * about which rule won an argument or whether a point was repaired. The
 * cache matters: the reading runs the three rules twice and, when the
 * first pass refuses, splits the ball track into flights as well, and the
 * summary alone asks for it five times per point.
 */
const NO_TRACKS = {} as Tracks;
const readings = new WeakMap<Tracks, WeakMap<ServeAccuracyRow, PointReading>>();

function reading(
  row: ServeAccuracyRow,
  corners: Corners,
  tracks: Tracks | null,
  source: SourceDims,
): PointReading {
  // Keyed on the track file as well as the row. Half a megabyte of ball
  // positions arrives after the first render, and three of the rules read
  // it — a cache on the row alone would freeze every point at the answer
  // it had before the ball existed.
  const key = tracks ?? NO_TRACKS;
  let perRow = readings.get(key);
  if (!perRow) { perRow = new WeakMap(); readings.set(key, perRow); }
  const hit = perRow.get(row);
  if (hit) return hit;
  const made = readPoint(row, corners, tracks, source);
  perRow.set(row, made);
  return made;
}

/**
 * The serve, rebuilt from the two bounces alone, with one supplied by the
 * ball's own flight where the detector missed it.
 *
 * Kept beside the reading rather than inside it because it answers a
 * different question: the rules above name a winner, this draws a dot on
 * the map. Cached the same way and for the same reason.
 */
const serves = new WeakMap<Tracks, WeakMap<ServeAccuracyRow, ServePair | null>>();

function serveOf(
  row: ServeAccuracyRow,
  corners: Corners,
  tracks: Tracks | null,
  source: SourceDims,
): ServePair | null {
  const key = tracks ?? NO_TRACKS;
  let perRow = serves.get(key);
  if (!perRow) { perRow = new WeakMap(); serves.set(key, perRow); }
  if (perRow.has(row)) return perRow.get(row) ?? null;
  const made = recoverServe(
    row.events,
    tracks?.[row.pointId] ?? null,
    corners,
    row.clipT0,
    source,
    serverSideFor(row.server, row.userPhysicalSide),
    row.userPhysicalSide,
  );
  perRow.set(row, made);
  return made;
}









function Legend() {
  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <p className="text-sm text-zinc-200">What the marks mean</p>
      <ul className="mt-2 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
        {LEGEND.map((item) => (
          <li key={item.label} className="flex items-start gap-2 text-xs">
            <span
              aria-hidden
              className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={
                item.ring
                  ? { border: `2px solid ${item.swatch}` }
                  : { background: item.swatch }
              }
            />
            <span>
              <span className="text-zinc-200">{item.label}</span>
              <span className="text-zinc-500"> — {item.where}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ROLE_TONE: Record<string, string> = {
  serve_first_bounce: "#a78bfa",
  serve_landing: "#22d3ee",
  landing: "#f59e0b",
  contact: "#f472b6",
};
const KIND_TONE: Record<string, string> = {
  bounce: "#94a3b8",
  contact: "#f472b6",
  net: "#ef4444",
  out: "#ef4444",
  impact: "#facc15",
};

function toneFor(e: DetectedEvent) {
  return (e.role && ROLE_TONE[e.role]) || KIND_TONE[e.kind] || "#94a3b8";
}

const HALF_COPY: Record<"yours" | "theirs", string> = {
  yours: "your half",
  theirs: "their half",
};

/**
 * The point's touches as a strip under the clip, lit as the video plays.
 *
 * The canvas already rings a touch for a third of a second as the playhead
 * passes it, which tells you something happened and not what. This says
 * which touch it is, keeps the one you are watching lit, and seeks back to
 * any of them so a bounce can be replayed without hunting the scrubber.
 */
function TouchStrip({
  touches,
  active,
  onSeek,
}: {
  touches: readonly Touch[];
  active: number;
  onSeek: (at: number) => void;
}) {
  if (touches.length === 0) {
    return (
      <p className="mt-2 text-xs text-zinc-500">
        No touches were detected in this point.
      </p>
    );
  }
  const named = touches.some((t) => t.fromServer);
  return (
    <div className="mt-2">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {touches.map((t, i) => (
          <button
            key={t.event.id}
            type="button"
            onClick={() => t.at !== null && onSeek(t.at)}
            disabled={t.at === null}
            className={
              "shrink-0 rounded-lg border px-2 py-1 text-left text-[11px] "
              + "transition-colors disabled:cursor-default "
              + (i === active
                ? "border-cyan-glow/70 bg-cyan-glow/10 text-zinc-100"
                : "border-edge text-zinc-300 hover:border-zinc-600")
            }
          >
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: toneFor(t.event) }}
              />
              <span className="whitespace-nowrap font-medium">{t.label}</span>
            </span>
            <span className="mt-0.5 block whitespace-nowrap tabular-nums text-zinc-500">
              {t.half ? HALF_COPY[t.half] : "not on the table"}
              {t.at !== null ? ` · ${t.at.toFixed(2)}s` : " · no clip time"}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">
        Which half a bounce landed on comes from the ball and the end you
        were on, so it holds whatever the rotation thinks.
        {named
          ? " The word “serve” comes from the rotation, so those two names"
            + " move with it."
          : ""}
      </p>
    </div>
  );
}

/** The clip with the calibrated table drawn on it and the touches marked. */
function Clip({
  url,
  row,
  corners,
  source,
  track,
}: {
  url: string;
  row: ServeAccuracyRow;
  corners: ServeAccuracyMatch["corners"];
  source: ServeAccuracyMatch["source"];
  track: readonly (readonly number[])[] | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showQuad, setShowQuad] = useState(true);
  const [showPrism, setShowPrism] = useState(true);
  // Which touch the playhead is on. Held in a ref as well as state so the
  // draw loop can compare without re-rendering: this runs every frame, and
  // setting state 60 times a second to store the same number would restart
  // the loop for nothing.
  const [activeTouchIdx, setActiveTouchIdx] = useState(-1);
  const activeTouchRef = useRef(-1);

  const touches = useMemo(
    () => touchList(row.events, row.userPhysicalSide),
    [row.events, row.userPhysicalSide],
  );

  // The draw loop below keeps the strip in step at frame rate, but it is a
  // requestAnimationFrame loop and the browser stops those whenever the
  // document is hidden — a background tab, or the embedded preview pane,
  // where the video plays on with the strip frozen. The video's own events
  // fire either way, so they carry the highlight and the loop only makes it
  // smooth. Seeking while paused arrives here too, which rAF alone misses.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      const lit = activeTouch(touches, video.currentTime);
      if (lit === activeTouchRef.current) return;
      activeTouchRef.current = lit;
      setActiveTouchIdx(lit);
    };
    const events = ["timeupdate", "seeked", "play", "pause", "loadedmetadata"];
    sync();
    for (const name of events) video.addEventListener(name, sync);
    return () => {
      for (const name of events) video.removeEventListener(name, sync);
    };
  }, [touches]);

  const seek = useCallback((at: number) => {
    const video = videoRef.current;
    if (!video) return;
    // Land a beat early: the ring holds for a third of a second either
    // side, so arriving just before it means watching it appear rather
    // than finding it already faded.
    video.currentTime = Math.max(0, at - 0.35);
    void video.play().catch(() => {});
  }, []);

  const prism = useMemo<Pt[] | null>(
    () => (corners ? prismPolygon(corners) : null),
    [corners],
  );
  /** When the ball left the volume for good, in clip seconds. */
  const exits = useMemo(
    () =>
      prism && track && source
        ? finalExits(track, prism, source.width, source.height)
        : [],
    [prism, track, source],
  );

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !source) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = video.clientWidth;
      const h = video.clientHeight;
      if (w === 0 || h === 0) return;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      const sx = w / source.width;
      const sy = h / source.height;

      if (showPrism && prism) {
        ctx.beginPath();
        prism.forEach(([px, py], i) => {
          const X = px * sx;
          const Y = py * sy;
          if (i === 0) ctx.moveTo(X, Y);
          else ctx.lineTo(X, Y);
        });
        ctx.closePath();
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (showQuad && corners) {
        const pts = CORNER_ORDER.map((k) => corners[k]).filter(Boolean);
        if (pts.length === 4) {
          ctx.beginPath();
          pts.forEach(([px, py], i) => {
            const X = px * sx;
            const Y = py * sy;
            if (i === 0) ctx.moveTo(X, Y);
            else ctx.lineTo(X, Y);
          });
          ctx.closePath();
          ctx.strokeStyle = "#ff2d95";
          ctx.lineWidth = 2;
          ctx.stroke();
          // The net line, projected properly. The pixel midpoint of the
          // sidelines is NOT where the net is: perspective compresses the
          // far half, so the real net sits nearer the far end. The quad's
          // diagonals meet at the table's true centre, and the net runs
          // through it. Adil caught the drawn line sitting off the
          // physical net on the Julian match; this is the fix.
          const seg = netSegment(corners);
          const l = seg ? seg.e1 : [0, 0];
          const r = seg ? seg.e2 : [0, 0];
          ctx.beginPath();
          ctx.moveTo(l[0] * sx, l[1] * sy);
          ctx.lineTo(r[0] * sx, r[1] * sy);
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = "#f8fafc";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      const now = video.currentTime;

      const lit = activeTouch(touches, now);
      if (lit !== activeTouchRef.current) {
        activeTouchRef.current = lit;
        setActiveTouchIdx(lit);
      }

      // The ball itself, the half second behind the playhead. Fractions of
      // the frame rather than pixels, so it survives any element size.
      if (track) {
        let prev: { x: number; y: number } | null = null;
        for (const [t, fx, fy, conf] of track) {
          const age = now - t;
          if (age < 0 || age > 0.5) { prev = null; continue; }
          const X = fx * w;
          const Y = fy * h;
          const fade = 1 - age / 0.5;
          const inside =
            prism && source
              ? inPrism(prism, fx * source.width, fy * source.height)
              : true;
          const tone = inside ? "#facc15" : "#f87171";
          if (prev) {
            ctx.globalAlpha = 0.15 + 0.5 * fade;
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(X, Y);
            ctx.strokeStyle = tone;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          ctx.globalAlpha = 0.3 + 0.7 * fade;
          ctx.beginPath();
          ctx.arc(X, Y, age < 0.06 ? 4 : 2, 0, Math.PI * 2);
          ctx.fillStyle = tone;
          ctx.fill();
          ctx.globalAlpha = 1;
          prev = { x: X, y: Y };
          void conf;
        }
      }

      // Touches near the playhead. A marker holds for a third of a second
      // either side so a 30fps event is visible at all.
      for (const e of row.events) {
        if (e.clipT === null || e.x === null || e.y === null) continue;
        const age = now - e.clipT;
        if (age < -0.34 || age > 0.34) continue;
        const fade = 1 - Math.abs(age) / 0.34;
        ctx.globalAlpha = 0.25 + 0.75 * fade;
        ctx.beginPath();
        ctx.arc(e.x * sx, e.y * sy, 5 + 7 * (1 - fade), 0, Math.PI * 2);
        ctx.strokeStyle = toneFor(e);
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [row.events, corners, source, showQuad, showPrism, prism, track, touches]);

  return (
    <div>
      <div className="relative">
        <video
          ref={videoRef}
          src={url}
          controls
          playsInline
          preload="metadata"
          className="w-full rounded-lg bg-black"
        />
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
      </div>
      <TouchStrip touches={touches} active={activeTouchIdx} onSeek={seek} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowQuad((q) => !q)}
          className="rounded-full border border-edge px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200"
        >
          {showQuad ? "Hide the table" : "Show the table"}
        </button>
        <button
          type="button"
          onClick={() => setShowPrism((q) => !q)}
          className="rounded-full border border-edge px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200"
        >
          {showPrism ? "Hide the prism" : "Show the prism"}
        </button>
        {exits.length > 0 && (
          <span className="text-xs text-zinc-500">
            Ball leaves for good at{" "}
            {exits.map((e) => `${e.toFixed(2)}s`).join(", ")}
            {videoRef.current ? "" : ""}
          </span>
        )}
        {exits.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const v = videoRef.current;
              if (v) v.currentTime = Math.max(0, exits[exits.length - 1] - 1);
            }}
            className="rounded-full border border-edge px-3 py-1 text-xs text-sky-300/80 hover:text-sky-200"
          >
            Jump to the exit
          </button>
        )}
      </div>
    </div>
  );
}

const VIEW_W = 170;
const VIEW_H = 258;
const TX = 26;
const TY = 26;
const TW = 118;
const TH = 202;

/** Every touch that projected onto the table, in the map's own frame. */
function Court(
  { row, corners, events, serve }:
  { row: ServeAccuracyRow; corners: Corners; events: DetectedEvent[];
    serve: ServePair | null },
) {
  const xy = (u: number, v: number) => ({
    x: TX + (TW * u) / TABLE_W_M,
    y: TY + TH * (1 - v / TABLE_L_M),
  });
  const bounces = events.filter(
    (e) => e.kind === "bounce" && e.nu !== null && e.nv !== null,
  );
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full">
      <rect
        x={TX}
        y={TY}
        width={TW}
        height={TH}
        rx="4"
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
      <line
        x1={TX + TW / 2}
        y1={TY}
        x2={TX + TW / 2}
        y2={TY + TH}
        stroke="#cbd5e1"
        strokeOpacity="0.35"
        strokeWidth="0.75"
      />
      {bounces.map((e, i) => {
        const p = xy(e.nu as number, e.nv as number);
        const isServe =
          e.role === "serve_landing" || e.role === "serve_first_bounce";
        return (
          <g key={e.id}>
            <title>
              {isRecovered(e)
                ? `landing put back by the flights · ${e.t.toFixed(2)}s`
                : `${e.kind}${e.role ? ` · ${e.role.replace(/_/g, " ")}` : ""} · `
                  + `${e.t.toFixed(2)}s · vis ${e.visual.toFixed(2)}`}
            </title>
            <circle
              cx={p.x}
              cy={p.y}
              r={isServe ? 5 : 3.5}
              fill={isRecovered(e) ? "none" : toneFor(e)}
              fillOpacity={isServe ? 0.9 : 0.45}
              stroke={isRecovered(e) ? "#22d3ee" : "#0c1222"}
              strokeWidth={isRecovered(e) ? 1.25 : 0.75}
              strokeDasharray={isRecovered(e) ? "2 1.5" : undefined}
            />
            {!isServe && (
              <text
                x={p.x}
                y={p.y - 5}
                textAnchor="middle"
                fontSize="6"
                fill="#71717a"
              >
                {i + 1}
              </text>
            )}
          </g>
        );
      })}
      {row.final && (
        <circle
          cx={xy(row.final.u, row.final.v).x}
          cy={xy(row.final.u, row.final.v).y}
          r="7"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="1.75"
        />
      )}
      {(() => {
        const call = findOffTable(events, corners ? { corners } : null);
        if (!call || !call.trusted) return null;
        const e = call.lastLanding;
        if (e.nu === null || e.nv === null) return null;
        const p = xy(e.nu, e.nv);
        return (
          <g>
            <title>
              {`last landing on the table — ${call.struckBy} plays the next shot`}
            </title>
            <circle
              cx={p.x}
              cy={p.y}
              r="9"
              fill="none"
              stroke="#f472b6"
              strokeWidth="1.5"
              strokeDasharray="3 2"
            />
          </g>
        );
      })()}
      {serve?.recovered != null
        && serve.landing.nu !== null && serve.landing.nv !== null && (() => {
        const p = xy(serve.landing.nu as number, serve.landing.nv as number);
        return (
          <g>
            <title>
              {"serve landing, put back by the ball's flight — "
                + `${(serve.landing.clipT ?? 0).toFixed(2)}s`}
            </title>
            <circle
              cx={p.x} cy={p.y} r="6.5"
              fill="none" stroke="#22d3ee" strokeWidth="2.25"
            />
            <circle cx={p.x} cy={p.y} r="11" fill="none"
              stroke="#22d3ee" strokeWidth="1" strokeDasharray="3 2.5" />
          </g>
        );
      })()}
      {findDeadRuns(events).map((run) => {
        const pts = run.events
          .filter((e) => e.nu !== null && e.nv !== null)
          .map((e) => xy(e.nu as number, e.nv as number));
        if (pts.length < 2) return null;
        return (
          <g key={run.startsAt}>
            <title>
              {`dead run: ${run.events.length} bounces, `
                + `${run.metresFromNet.toFixed(2)} m from the net`}
            </title>
            <polyline
              points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="#34d399"
              strokeWidth="1.75"
              strokeOpacity="0.9"
            />
            <circle
              cx={pts[0].x}
              cy={pts[0].y}
              r="6"
              fill="none"
              stroke="#34d399"
              strokeWidth="1.5"
            />
          </g>
        );
      })}
      <text x={VIEW_W / 2} y={14} textAnchor="middle" fontSize="8" fill="#71717a">
        them
      </text>
      <text
        x={VIEW_W / 2}
        y={VIEW_H - 8}
        textAnchor="middle"
        fontSize="8"
        fill="#71717a"
      >
        you
      </text>
    </svg>
  );
}

/**
 * One import per match, written out rather than built from the slug.
 *
 * A template literal inside `import()` gives the bundler a directory to
 * guess at, and it answers by shipping every file in it. Naming each one
 * keeps the six track files in six chunks, so opening Chris fetches 426KB
 * instead of two megabytes.
 */
const TRACK_FILES: Record<TrackSlug, () => Promise<{ default: unknown }>> = {
  chris: () => import("./tracks/chris.json"),
  julian: () => import("./tracks/julian.json"),
  rowel: () => import("./tracks/rowel.json"),
  ishan: () => import("./tracks/ishan.json"),
  prabhas: () => import("./tracks/prabhas.json"),
  anton: () => import("./tracks/anton.json"),
};

const tracksPromises = new Map<TrackSlug, Promise<Tracks>>();
/**
 * A match's ball positions, code-split and fetched when that match is
 * opened — the same shape crossing-review uses for its own track, so it
 * never lands in the initial bundle of a page you might only be reading
 * the summary of.
 */
function loadTracks(slug: TrackSlug): Promise<Tracks> {
  let p = tracksPromises.get(slug);
  if (!p) {
    p = TRACK_FILES[slug]()
      .then((mod) => mod.default as unknown as Tracks)
      .catch(() => ({}) as Tracks);
    tracksPromises.set(slug, p);
  }
  return p;
}

function Row({
  row,
  match,
  tracks,
}: {
  row: ServeAccuracyRow;
  match: ServeAccuracyMatch;
  tracks: Tracks | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [track, setTrack] = useState<readonly (readonly number[])[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const load = useCallback(async () => {
    if (url) return;
    setState("loading");
    try {
      const res = await fetch("/api/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId: match.matchId,
          pointId: row.pointId,
        }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.url) throw new Error("no url");
      setTrack((await loadTracks(match.slug))[row.pointId] ?? null);
      setUrl(data.url);
      setState("idle");
    } catch {
      setState("error");
    }
  }, [match.matchId, match.slug, row.pointId, url]);

  const opponent = match.opponent;
  const tapped =
    row.isLet ? "let"
      : row.winner === null ? "unscored"
        : row.winner === "user" ? "you" : opponent;
  const computed =
    row.computed?.winner === null || row.computed === null ? null
      : row.computed.winner === "user" ? "you" : opponent;
  const agree = computed !== null && row.winner !== null
    ? row.computed?.winner === row.winner
    : null;
  // The reading decides which events the rules see: the recorded ones, or
  // those plus what the flights put back where the first pass refused.
  const read = reading(row, match.corners, tracks, match.source);
  const serve = serveOf(row, match.corners, tracks, match.source);
  const events = read.events;
  const deadRuns = findDeadRuns(events);
  const died = findBallDied(
    events,
    tracks?.[row.pointId] ?? null,
    match.corners,
    row.clipT0,
    match.source,
    row.userPhysicalSide,
  );
  const diedLoser = ballDiedLoser(died, row.userPhysicalSide);
  const runVerdict =
    diedLoser === null ? null : diedLoser === "user" ? "opponent" : "user";
  const runAgrees =
    runVerdict !== null && row.winner !== null ? runVerdict === row.winner : null;
  const offTable = findOffTable(
    events,
    match.corners ? { corners: match.corners } : null,
  );
  const noRet = findNoReturn(
    events,
    tracks?.[row.pointId] ?? null,
    match.corners,
    row.clipT0,
    match.source,
  );
  const noRetLoser = noReturnLoser(noRet, row.userPhysicalSide);
  const noRetVerdict =
    noRetLoser === null ? null : noRetLoser === "user" ? "opponent" : "user";
  const noRetAgrees =
    noRetVerdict !== null && row.winner !== null
      ? noRetVerdict === row.winner
      : null;
  const offLoser = offTableLoser(offTable, row.userPhysicalSide);
  const offVerdict =
    offLoser === null ? null : offLoser === "user" ? "opponent" : "user";
  const offAgrees =
    offVerdict !== null && row.winner !== null ? offVerdict === row.winner : null;
  const withheld = read.refusal ?? offTableWithheld(offTable);
  const bounces = row.events.filter((e) => e.kind === "bounce").length;
  const projected = row.events.filter(
    (e) => e.kind === "bounce" && e.nu !== null,
  ).length;

  return (
    <div className="rounded-xl border border-edge bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold text-zinc-100">
          <span className="text-cyan-glow">{match.label}</span>
          <span className="ml-2">point {row.idx}</span>
          <span className="ml-2 font-normal text-zinc-500">game {row.game}</span>
        </p>
        <p className="text-xs text-zinc-400">
          {row.server === null
            ? "server unknown"
            : `${row.server === "user" ? "You" : opponent} served`}
        </p>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_170px]">
        <div>
          {url ? (
            <Clip
              url={url}
              row={row}
              corners={match.corners}
              source={match.source}
              track={track}
            />
          ) : (
            <button
              type="button"
              onClick={() => void load()}
              disabled={state === "loading"}
              className="flex aspect-video w-full items-center justify-center rounded-lg border border-edge bg-ink/60 text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-60"
            >
              {state === "loading"
                ? "Loading"
                : state === "error"
                  ? "Clip unavailable"
                  : "Play the point"}
            </button>
          )}
        </div>
        <Court
          row={row}
          corners={match.corners}
          events={events}
          serve={serveOf(row, match.corners, tracks, match.source)}
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-zinc-500">You tapped</dt>
          <dd className="text-zinc-200">{tapped}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Worker called</dt>
          <dd
            className={
              agree === null ? "text-zinc-300"
                : agree ? "text-emerald-300" : "text-amber-300"
            }
          >
            {computed ?? "no call"}
            {row.computed?.how ? ` · ${row.computed.how}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Serve speed</dt>
          <dd className="text-zinc-200 tabular-nums">
            {row.speed
              ? `${row.speed.kmh.toFixed(0)} km/h`
                + ` · ${row.speed.metres.toFixed(2)} m in ${row.speed.frames}f`
              : "not measurable"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Touches</dt>
          <dd className="text-zinc-200 tabular-nums">
            {bounces} bounces, {projected} on the table
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Rally length</dt>
          <dd className="text-zinc-200 tabular-nums">
            {row.rally.hits ?? "?"} hits · {row.rally.shots} shots ·{" "}
            {row.rally.contacts} contacts
            {row.rally.seconds !== null
              ? ` · ${row.rally.seconds.toFixed(1)}s`
              : ""}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Dead run</dt>
          <dd className="text-zinc-200">
            {deadRuns.length === 0
              ? "none"
              : died === null || died.via === "bounces"
                ? `${deadRuns[deadRuns.length - 1].events.length} bounces, `
                  + `${deadRuns[deadRuns.length - 1].metresFromNet.toFixed(2)} m `
                  + "from the net"
                : `turned at the net, ${died.turn?.distM.toFixed(2)} m out`}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Serve</dt>
          <dd className={serve?.recovered ? "text-cyan-glow" : "text-zinc-200"}>
            {serve === null
              ? "not reconstructed"
              : serve.recovered === null
                ? "both bounces detected"
                : `${serve.recovered === "landing" ? "the landing"
                  : serve.recovered === "first" ? "the first bounce"
                  : "both bounces"} put back from the ball's flight`}
            {serve && serve.landing.u !== null && serve.landing.v !== null && (
              <span className="text-zinc-500">
                {` · lands ${(serve.landing.v as number) < TABLE_L_M / 2 === (row.userPhysicalSide === "near")
                  ? "your" : "their"} half`}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Put back by the flights</dt>
          <dd className={read.recovered.length ? "text-cyan-glow" : "text-zinc-500"}>
            {read.recovered.length === 0
              ? "nothing missing"
              : read.recovered
                .map((e) => `${e.kind === "bounce" ? "landing" : "touch"} at `
                  + `${(e.clipT ?? 0).toFixed(2)}s`
                  + (e.kind === "bounce" && e.v !== null
                    ? ` on ${(e.v < TABLE_L_M / 2) === (row.userPhysicalSide === "near")
                      ? "your" : "their"} half`
                    : ""))
                .join(", ")}
            {read.trust && !read.trust.trusted && (
              <span className="text-zinc-500">
                {" — "}
                {read.trust.fullAlternation
                  ? "but the ball was never seen leaving, so the call is withheld"
                  : "but the rally still has a hole, so the call is withheld"}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Ball died says</dt>
          <dd
            className={
              runVerdict === null ? "text-zinc-500"
                : runAgrees ? "text-emerald-300" : "text-amber-300"
            }
          >
            {runVerdict === null || died === null
              ? "no call"
              : `${runVerdict === "user" ? "you" : opponent} won · `
                + `${runVerdict === "user" ? opponent : "you"} `
                + ballDiedReasonCopy(died)}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Server</dt>
          <dd className={row.server === null ? "text-amber-300" : "text-zinc-200"}>
            {row.server === null
              ? "unknown — no first server on this match"
              : `${row.server === "user" ? "you" : opponent} · `
                + `counted out from game ${row.game}`}
            {row.server !== null && (
              <>
                {" · "}
                <a
                  href={`/match/${match.matchId}`}
                  className="text-sky-300/80 underline decoration-dotted hover:text-sky-200"
                >
                  fix it on the match
                </a>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Last landing</dt>
          <dd className="text-zinc-200">
            {offTable === null
              ? "none on the table"
              : `${offTable.struckBy === row.userPhysicalSide ? "your" : "their"} half`
                + `, ${offTable.shotsAfter} shot`
                + `${offTable.shotsAfter === 1 ? "" : "s"} after`
                + (offTable.endedBy ? " · floor bounce seen" : "")}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Off table says</dt>
          <dd
            className={
              offVerdict === null ? "text-zinc-500"
                : offAgrees ? "text-emerald-300" : "text-amber-300"
            }
          >
            {offVerdict !== null && offTable !== null
              ? `${offVerdict === "user" ? "you" : opponent} won · `
                + `${offVerdict === "user" ? opponent : "you"} `
                + (offTable.via === "unreturned"
                  ? "never returned it"
                  : "missed the table")
              : withheld === null ? "no call" : `held back — ${withheld}`}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">No return says</dt>
          <dd
            className={
              noRetVerdict === null ? "text-zinc-500"
                : noRetAgrees ? "text-emerald-300" : "text-amber-300"
            }
          >
            {noRetVerdict === null
              ? "no call"
              : `${noRetVerdict === "user" ? "you" : opponent} won · the ball `
                + "never came back over the net"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Ball track</dt>
          <dd className="text-zinc-200 tabular-nums">
            {track ? `${track.length} frames` : "load the clip"}
          </dd>
        </div>
      </dl>

      {row.computed?.reason && (
        <p className="mt-1 text-[11px] text-zinc-500">
          Worker&apos;s reason: {row.computed.reason}
          {row.computed.hits !== null ? ` · ${row.computed.hits} hits` : ""}
        </p>
      )}
      {(() => {
        // The final call: everything above, settled into one line. This is
        // the whole page in a sentence, so it says what happened rather
        // than which rule said it, and it is the only place the reading is
        // put next to the tap without a rule's name attached.
        const them = opponent;
        const disagree = rulesDisagree(read);
        if (read.winner === null) {
          return (
            <div className="mt-3 border-t border-edge pt-2.5">
              <p className="text-sm text-zinc-500">
                No call.
                <span className="text-zinc-600">{` ${read.refusal ?? ""}`}</span>
              </p>
            </div>
          );
        }
        const won = read.winner === "user" ? "You" : them;
        const lost = read.winner === "user" ? them : "you";
        const agrees = row.winner === null ? null : read.winner === row.winner;
        return (
          <div className="mt-3 border-t border-edge pt-2.5">
            <p className="text-sm">
              <span
                className={
                  agrees === null ? "text-zinc-200"
                    : agrees ? "text-emerald-300" : "text-amber-300"
                }
              >
                {`${won} won`}
              </span>
              <span className="text-zinc-300">{` · ${lost} ${read.why}`}</span>
              {agrees === false && (
                <span className="text-amber-300/80">
                  {` · you tapped ${row.winner === "user" ? "yourself" : them}`}
                </span>
              )}
              {disagree && (
                <span className="text-zinc-500">
                  {` · ${read.verdicts.map((v) => v.name).join(" and ")} disagree`}
                </span>
              )}
            </p>
          </div>
        );
      })()}
      {row.serve === null && (
        <p className="mt-1 text-xs text-amber-300/80">
          No serve drawn.{" "}
          {row.rejection !== null
            ? REJECTION_COPY[row.rejection]
            : row.userPhysicalSide === null
              ? "This match never recorded which end you were on, so a "
                + "bounce cannot be given to a player."
              : "The reconstruction gave no reason."}
          {serve?.recovered != null && (
            <span className="text-cyan-glow">
              {" The ball's own flight supplies the missing bounce, and the "}
              {"serve above is drawn from that. Production still refuses it."}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/** One point, with the reading already made and bucketed. */
interface Entry {
  match: ServeAccuracyMatch;
  row: ServeAccuracyRow;
  read: PointReading;
  bucket: Bucketed;
}

const OUTCOME_COPY: Record<Outcome, string> = {
  right: "matched your tap",
  wrong: "named the other player",
  unchecked: "called, but you never scored the point",
  nocall: "no call",
};

/**
 * Everything measured about every point, on one page.
 *
 * Organised by REASON rather than by match, because the reason is what you
 * are investigating and the match is an accident of which day it was. A
 * question like "what do we get wrong when the ball leaves the table" was
 * previously six tabs and six counts to add up by hand; here it is one row
 * of a table.
 *
 * The tables are the drill-down: a reason's name filters to that reason,
 * and its right/wrong counts filter to that reason AND that outcome, so
 * "show me the ones we got wrong here" is one click on the number.
 */
export function ServeAccuracy({ matches }: { matches: ServeAccuracyMatch[] }) {
  const [reason, setReason] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | "all">("all");
  const [matchId, setMatchId] = useState<string | null>(null);
  const [flag, setFlag] = useState<string | null>(null);

  /**
   * Every match's tracks, not just the open one's.
   *
   * Pooling the points means every verdict has to exist at once, so all six
   * files load together — about two megabytes, in parallel, once. The page
   * counts nothing until they are all in rather than showing numbers that
   * climb as they arrive, which would read as a bug.
   */
  const [tracksBySlug, setTracksBySlug] =
    useState<Partial<Record<TrackSlug, Tracks>> | null>(null);
  const slugKey = matches.map((m) => m.slug).join(",");
  useEffect(() => {
    let live = true;
    void Promise.all(
      matches.map((m) => loadTracks(m.slug).then((t) => [m.slug, t] as const)),
    ).then((pairs) => {
      if (live) setTracksBySlug(Object.fromEntries(pairs));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugKey]);

  const entries = useMemo<Entry[]>(() => {
    if (!tracksBySlug) return [];
    const out: Entry[] = [];
    for (const m of matches) {
      const tracks = tracksBySlug[m.slug] ?? null;
      for (const row of m.rows) {
        const read = reading(row, m.corners, tracks, m.source);
        out.push({ match: m, row, read, bucket: classify(row, read) });
      }
    }
    return out;
  }, [matches, tracksBySlug]);

  /** Does this point carry the extra flag currently selected. */
  const hasFlag = useCallback((e: Entry) => {
    if (flag === null) return true;
    if (flag === "repaired") return e.read.recovered.length > 0;
    if (flag === "serverecovered") {
      return serveOf(e.row, e.match.corners,
        tracksBySlug?.[e.match.slug] ?? null, e.match.source)?.recovered != null;
    }
    if (flag === "disagree") return rulesDisagree(e.read);
    if (flag === "workerwrong") {
      return e.row.winner !== null && e.row.computed?.winner != null
        && e.row.computed.winner !== e.row.winner;
    }
    if (flag === "servedrawn") return e.row.serve !== null;
    return true;
  }, [flag, tracksBySlug]);

  /** The population the TABLES describe: narrowed by match and flag, but
   *  not by reason or outcome, or picking one would empty the table that
   *  the pick was made from. */
  const pool = useMemo(
    () => entries.filter(
      (e) => (matchId === null || e.match.matchId === matchId) && hasFlag(e)),
    [entries, matchId, hasFlag],
  );

  const shown = useMemo(
    () => pool.filter(
      (e) => (reason === null || e.bucket.reason === reason)
        && (outcome === "all" || e.bucket.outcome === outcome)),
    [pool, reason, outcome],
  );

  const totals = useMemo(
    () => outcomeTotals(pool.map((e) => e.bucket)), [pool]);

  /** One line per ending we call, and one per reason we refuse. */
  const byReason = useMemo(
    () => reasonSummary(pool.map((e) => e.bucket)), [pool]);

  const flagCounts = useMemo(() => {
    const base = entries.filter(
      (e) => matchId === null || e.match.matchId === matchId);
    const n = (f: string) => {
      const keep = (e: Entry) =>
        f === "repaired" ? e.read.recovered.length > 0
          : f === "serverecovered"
            ? serveOf(e.row, e.match.corners,
                tracksBySlug?.[e.match.slug] ?? null, e.match.source)?.recovered != null
            : f === "disagree" ? rulesDisagree(e.read)
              : f === "workerwrong"
                ? e.row.winner !== null && e.row.computed?.winner != null
                  && e.row.computed.winner !== e.row.winner
                : f === "servedrawn" ? e.row.serve !== null : false;
      return base.filter(keep).length;
    };
    return {
      repaired: n("repaired"), serverecovered: n("serverecovered"),
      disagree: n("disagree"), workerwrong: n("workerwrong"),
      servedrawn: n("servedrawn"),
    };
  }, [entries, matchId, tracksBySlug]);

  /** Cautions only for the matches actually in view. */
  const cautions = useMemo(
    () => matches.filter(
      (m) => m.caution && (matchId === null || m.matchId === matchId)),
    [matches, matchId],
  );

  const loading = tracksBySlug === null;
  const clear = () => { setReason(null); setOutcome("all"); setFlag(null); };
  const filtered = reason !== null || outcome !== "all" || flag !== null
    || matchId !== null;

  const pill = (on: boolean, tone: "cyan" | "amber" = "cyan") =>
    `rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
      on
        ? tone === "amber"
          ? "border-amber-300/60 bg-amber-300/15 text-amber-200"
          : "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
        : "border-edge bg-surface-2/40 text-zinc-400 hover:text-zinc-200"
    }`;

  const num = (v: number, on: boolean, tone: "cyan" | "amber" | "zinc",
               onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      disabled={v === 0}
      className={`w-full rounded px-2 py-0.5 text-right tabular-nums transition-colors ${
        v === 0
          ? "cursor-default text-zinc-600"
          : on
            ? tone === "amber"
              ? "bg-amber-300/20 text-amber-200"
              : "bg-cyan-glow/20 text-cyan-glow"
            : tone === "amber"
              ? "text-amber-300/90 hover:bg-amber-300/10"
              : tone === "cyan"
                ? "text-cyan-glow/90 hover:bg-cyan-glow/10"
                : "text-zinc-300 hover:bg-surface-2"
      }`}
    >
      {v}
    </button>
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">Serve accuracy</h1>
      <p className="mt-2 max-w-3xl text-sm text-zinc-400">
        Every point from every match in one list, grouped by what happened at
        the end of it rather than by which match it came from. The tables
        below are the filters: a reason narrows to that reason, and the
        numbers beside it narrow to that reason and that outcome together.
      </p>

      {loading ? (
        <p className="mt-6 text-sm text-zinc-500">
          Reading the ball tracks for all {matches.length} matches…
        </p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(
              [
                ["all", "points", totals.all, "zinc"],
                ["right", "we got right", totals.right, "cyan"],
                ["wrong", "we got wrong", totals.wrong, "amber"],
                ["nocall", "no call at all", totals.nocall, "zinc"],
                ["unchecked", "called, never scored", totals.unchecked, "zinc"],
              ] as const
            ).map(([key, label, value, tone]) => (
              <button
                key={key}
                type="button"
                onClick={() => setOutcome(key === "all" ? "all" : key as Outcome)}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  (key === "all" ? outcome === "all" : outcome === key)
                    ? "border-cyan-glow/60 bg-cyan-glow/10"
                    : "border-edge bg-surface hover:border-zinc-600"
                }`}
              >
                <span className={`block text-xl font-semibold tabular-nums ${
                  tone === "amber" ? "text-amber-300"
                    : tone === "cyan" ? "text-cyan-glow" : "text-zinc-100"
                }`}>
                  {value}
                </span>
                <span className="text-[11px] text-zinc-500">{label}</span>
              </button>
            ))}
          </div>

          <h2 className="mt-7 text-sm font-semibold text-zinc-200">
            Endings we call
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Click a reason for all of its points, or a number for just those.
          </p>
          <div className="mt-2 overflow-x-auto rounded-xl border border-edge">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-surface-2/40 text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">how it ended</th>
                  <th className="px-2 py-2 text-right font-medium">points</th>
                  <th className="px-2 py-2 text-right font-medium">right</th>
                  <th className="px-2 py-2 text-right font-medium">wrong</th>
                  <th className="px-2 py-2 text-right font-medium">not scored</th>
                  <th className="px-3 py-2 text-right font-medium">accuracy</th>
                </tr>
              </thead>
              <tbody>
                {byReason.called.map((c) => {
                  const judged = c.right + c.wrong;
                  const on = reason === c.reason;
                  return (
                    <tr key={c.reason}
                        className={`border-t border-edge ${on ? "bg-cyan-glow/5" : ""}`}>
                      <td className="px-3 py-1.5">
                        <button
                          type="button"
                          onClick={() => { setReason(on ? null : c.reason); setOutcome("all"); }}
                          className={`text-left transition-colors ${
                            on ? "text-cyan-glow" : "text-zinc-200 hover:text-cyan-glow"}`}
                        >
                          {c.reason}
                        </button>
                      </td>
                      <td className="px-2 py-1.5">
                        {num(c.points, on && outcome === "all", "zinc",
                          () => { setReason(c.reason); setOutcome("all"); })}
                      </td>
                      <td className="px-2 py-1.5">
                        {num(c.right, on && outcome === "right", "cyan",
                          () => { setReason(c.reason); setOutcome("right"); })}
                      </td>
                      <td className="px-2 py-1.5">
                        {num(c.wrong, on && outcome === "wrong", "amber",
                          () => { setReason(c.reason); setOutcome("wrong"); })}
                      </td>
                      <td className="px-2 py-1.5">
                        {num(c.unchecked, on && outcome === "unchecked", "zinc",
                          () => { setReason(c.reason); setOutcome("unchecked"); })}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-zinc-400">
                        {judged ? `${Math.round((100 * c.right) / judged)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
                {byReason.called.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-3 text-xs text-zinc-500">
                    No calls in this selection.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <h2 className="mt-7 text-sm font-semibold text-zinc-200">
            Why we make no call
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            The population to shrink. Each of these is a point we could not
            name a winner for.
          </p>
          <div className="mt-2 overflow-x-auto rounded-xl border border-edge">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="bg-surface-2/40 text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">why it said nothing</th>
                  <th className="px-2 py-2 text-right font-medium">points</th>
                  <th className="px-3 py-2 text-right font-medium">share</th>
                </tr>
              </thead>
              <tbody>
                {byReason.refused.map((c) => {
                  const on = reason === c.reason;
                  return (
                    <tr key={c.reason}
                        className={`border-t border-edge ${on ? "bg-cyan-glow/5" : ""}`}>
                      <td className="px-3 py-1.5">
                        <button
                          type="button"
                          onClick={() => { setReason(on ? null : c.reason); setOutcome("all"); }}
                          className={`text-left transition-colors ${
                            on ? "text-cyan-glow" : "text-zinc-200 hover:text-cyan-glow"}`}
                        >
                          {c.reason}
                        </button>
                      </td>
                      <td className="px-2 py-1.5">
                        {num(c.points, on, "zinc",
                          () => { setReason(c.reason); setOutcome("all"); })}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-zinc-400">
                        {totals.nocall
                          ? `${Math.round((100 * c.points) / totals.nocall)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
                {byReason.refused.length === 0 && (
                  <tr><td colSpan={3} className="px-3 py-3 text-xs text-zinc-500">
                    Every point in this selection got a call.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">
              Match
            </span>
            <button type="button" onClick={() => setMatchId(null)}
                    className={pill(matchId === null)}>
              All {matches.length}
            </button>
            {matches.map((m) => (
              <button key={m.matchId} type="button"
                      onClick={() => setMatchId(matchId === m.matchId ? null : m.matchId)}
                      className={pill(matchId === m.matchId)}>
                {m.label}
                <span className="ml-2 font-normal opacity-60 tabular-nums">
                  {m.rows.length}
                </span>
                {m.caution && <span className="ml-1.5 text-amber-300">•</span>}
              </button>
            ))}
          </div>

          <p className="mt-2 text-xs text-zinc-500">
            Every row&apos;s server is counted out, not seen: who served point
            one, then two serves each, swapping first server at every game.
            Nothing in the video is consulted. So it drifts two ways — a wrong
            first server flips the whole match at once, and a game that ends
            in the wrong place flips everything after it, which is why the
            first point of a game is where a wrong name usually shows up. The
            right and wrong counts above do not depend on any of this: the
            three rules read the ball against the end you were on and never
            ask who served.
            {" "}
            {matches.filter((m) => m.firstServerSource !== "user").length > 0 && (
              <span className="text-amber-300">
                Nobody confirmed who served first on{" "}
                {matches.filter((m) => m.firstServerSource !== "user")
                  .map((m) => m.label).join(" and ")}
                , so those rotations start from a guess.
              </span>
            )}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">
              Also
            </span>
            {(
              [
                ["servedrawn", "Serve drawn", flagCounts.servedrawn],
                ["repaired", "Repaired", flagCounts.repaired],
                ["serverecovered", "Serve recovered", flagCounts.serverecovered],
                ["disagree", "Rules disagree", flagCounts.disagree],
                ["workerwrong", "Worker disagreed", flagCounts.workerwrong],
              ] as const
            ).map(([key, label, count]) => (
              <button key={key} type="button"
                      onClick={() => setFlag(flag === key ? null : key)}
                      className={pill(flag === key)}>
                {label} <span className="tabular-nums opacity-70">{count}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-edge pt-3">
            <p className="text-sm text-zinc-300">
              Showing <span className="tabular-nums text-zinc-100">{shown.length}</span>
              {" "}of {totals.all}
              {reason !== null && <> · <span className="text-cyan-glow">{reason}</span></>}
              {outcome !== "all" && <> · {OUTCOME_COPY[outcome]}</>}
              {matchId !== null && <> · {matches.find((m) => m.matchId === matchId)?.label}</>}
            </p>
            {filtered && (
              <button type="button" onClick={() => { clear(); setMatchId(null); }}
                      className="rounded-full border border-edge px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200">
                Clear filters
              </button>
            )}
          </div>

          {cautions.map((m) => (
            <p key={m.matchId}
               className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/5 px-4 py-3 text-sm text-amber-100/90">
              <span className="font-semibold">{m.label}:</span> {m.caution}
            </p>
          ))}

          <div className="mt-3">
            <Legend />
          </div>

          <div className="mt-4 space-y-3">
            {shown.map((e) => (
              <Row key={e.row.pointId} row={e.row} match={e.match}
                   tracks={tracksBySlug?.[e.match.slug] ?? null} />
            ))}
            {shown.length === 0 && (
              <p className="rounded-xl border border-edge bg-surface p-4 text-sm text-zinc-500">
                Nothing matches those filters.
              </p>
            )}
          </div>
        </>
      )}
    </main>
  );
}
