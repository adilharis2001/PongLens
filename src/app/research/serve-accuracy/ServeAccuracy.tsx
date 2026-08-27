"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findDeadRuns } from "./deadRun";
import { ballDiedLoser, ballDiedReasonCopy, findBallDied } from "./ballDied";
import { findOffTable, offTableLoser, offTableWithheld } from "./offTable";
import { netSegment } from "./netDeath";
import { findNoReturn, noReturnLoser } from "./noReturn";
import {
  readPoint,
  readingIsWrong,
  rulesDisagree,
  type PointReading,
  type Tracks,
} from "./pointReading";
import { isRecovered } from "./segments";
import { recoverServe, serverSideFor, type ServePair } from "./serveRepair";
import { finalExits, inPrism, prismPolygon, type Pt } from "./prism";
import {
  REJECTION_COPY,
  TABLE_L_M,
  TABLE_W_M,
  summarise,
  type DetectedEvent,
  type ServeAccuracyMatch,
  type ServeAccuracyRow,
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

/** A serve that only exists because a bounce was put back. */
function serveWasRecovered(
  row: ServeAccuracyRow,
  corners: Corners,
  tracks: Tracks | null,
  source: SourceDims,
): boolean {
  return serveOf(row, corners, tracks, source)?.recovered != null;
}

function ruleVerdict(
  row: ServeAccuracyRow,
  corners: Corners,
  tracks: Tracks | null,
  source: SourceDims,
): "user" | "opponent" | null {
  return reading(row, corners, tracks, source).winner;
}

/** Which rule made the call, for grouping the mistakes by author. */
function decidingRule(
  row: ServeAccuracyRow,
  corners: Corners,
  tracks: Tracks | null,
  source: SourceDims,
): string | null {
  return reading(row, corners, tracks, source).rule;
}

/**
 * Why no call was made, in the words the row already shows. One bucket per
 * distinct reason, so the biggest pile can be opened on its own instead of
 * being scrolled past inside a single "held back" list.
 */
function noCallReason(
  row: ServeAccuracyRow,
  corners: Corners,
  tracks: Tracks | null,
  source: SourceDims,
): string | null {
  return reading(row, corners, tracks, source).refusal;
}

/** Fired, the point is scored, and it named the wrong player. */
function ruleIsWrong(
  row: ServeAccuracyRow,
  corners: Corners,
  tracks: Tracks | null,
  source: SourceDims,
): boolean {
  return readingIsWrong(row, reading(row, corners, tracks, source));
}

/** Two rules both spoke and named different winners. */
function disagrees(
  row: ServeAccuracyRow,
  corners: Corners,
  tracks: Tracks | null,
  source: SourceDims,
): boolean {
  return rulesDisagree(reading(row, corners, tracks, source));
}

/** A call that only exists because the flights put a missing event back. */
function ruleWasRepaired(
  row: ServeAccuracyRow,
  corners: Corners,
  tracks: Tracks | null,
  source: SourceDims,
): boolean {
  const r = reading(row, corners, tracks, source);
  return r.winner !== null && r.recovered.length > 0;
}

/** The off-table read found something and then refused to call it. */
function ruleHeldBack(
  row: ServeAccuracyRow,
  corners: Corners,
  tracks: Tracks | null,
  source: SourceDims,
): boolean {
  const r = reading(row, corners, tracks, source);
  return r.winner === null && r.refusal !== null && r.refusal !== "nothing to go on";
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
  }, [row.events, corners, source, showQuad, showPrism, prism, track]);

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

let tracksPromise: Promise<Tracks> | null = null;
/**
 * Half a megabyte of ball positions, code-split and fetched the first time
 * a clip is opened — the same shape crossing-review uses for its own track,
 * so it never lands in the initial bundle of a page you might only be
 * reading the summary of.
 */
function loadTracks(): Promise<Tracks> {
  tracksPromise ??= import("./tracks.json")
    .then((mod) => mod.default as unknown as Tracks)
    .catch(() => ({}) as Tracks);
  return tracksPromise;
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
      setTrack((await loadTracks())[row.pointId] ?? null);
      setUrl(data.url);
      setState("idle");
    } catch {
      setState("error");
    }
  }, [match.matchId, row.pointId, url]);

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
          Point {row.idx}
          <span className="ml-2 font-normal text-zinc-500">game {row.game}</span>
        </p>
        <p className="text-xs text-zinc-400">
          {row.server === "user" ? "You" : opponent} served
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
      {row.serve === null && row.rejection !== null && (
        <p className="mt-1 text-xs text-amber-300/80">
          No serve drawn. {REJECTION_COPY[row.rejection]}
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

export function ServeAccuracy({ matches }: { matches: ServeAccuracyMatch[] }) {
  const [active, setActive] = useState(matches[0].matchId);
  const [only, setOnly] = useState<
    string
  >("all");
  // The verdict counts need every track, not just the open clip's, so the
  // whole file loads once up front. Still code-split out of the bundle.
  const [allTracks, setAllTracks] = useState<Tracks | null>(null);
  useEffect(() => {
    void loadTracks().then(setAllTracks);
  }, []);
  const match = matches.find((m) => m.matchId === active) ?? matches[0];
  const stats = useMemo(() => summarise(match.rows), [match]);
  const rows = useMemo(
    () =>
      match.rows.filter((r) =>
        only === "all" ? true
          : only === "drawn" ? r.serve !== null
            : only === "refused" ? r.serve === null
              : only === "deadrun"
                ? decidingRule(r, match.corners, allTracks, match.source) === "ball died"
                : only === "offtable"
                  ? decidingRule(r, match.corners, allTracks, match.source) === "off table"
                  : only === "noreturn"
                    ? decidingRule(r, match.corners, allTracks, match.source) === "no return"
                  : only === "repaired"
                    ? ruleWasRepaired(r, match.corners, allTracks, match.source)
                  : only === "serverepair"
                    ? serveWasRecovered(r, match.corners, allTracks, match.source)
                  : only === "disagree"
                    ? disagrees(r, match.corners, allTracks, match.source)
                  : only.startsWith("wrongby:")
                    ? ruleIsWrong(r, match.corners, allTracks, match.source)
                      && decidingRule(r, match.corners, allTracks, match.source)
                        === only.slice(8)
                  : only.startsWith("why:")
                    ? noCallReason(r, match.corners, allTracks, match.source)
                      === only.slice(4)
                  : only === "wrong"
                    ? ruleIsWrong(r, match.corners, allTracks, match.source)
                    : only === "heldback"
                      ? ruleHeldBack(r, match.corners, allTracks, match.source)
                      : only === "nocall"
                        ? ruleVerdict(r, match.corners, allTracks, match.source) === null
                      : r.winner !== null
                        && r.computed?.winner != null
                        && r.computed.winner !== r.winner,
      ),
    [match, only, allTracks],
  );
  const disagreed = stats.callCompared - stats.callAgreed;
  const serveRecovered = useMemo(
    () => match.rows.filter(
      (r) => serveWasRecovered(r, match.corners, allTracks, match.source),
    ).length,
    [match, allTracks],
  );
  const repairedCount = useMemo(
    () => match.rows.filter(
      (r) => ruleWasRepaired(r, match.corners, allTracks, match.source),
    ).length,
    [match, allTracks],
  );
  const ruleWrong = useMemo(
    () => match.rows.filter(
      (r) => ruleIsWrong(r, match.corners, allTracks, match.source),
    ).length,
    [match, allTracks],
  );
  const heldBack = useMemo(
    () => match.rows.filter(
      (r) => ruleHeldBack(r, match.corners, allTracks, match.source),
    ).length,
    [match, allTracks],
  );
  const disagreeCount = useMemo(
    () => match.rows.filter(
      (r) => disagrees(r, match.corners, allTracks, match.source),
    ).length,
    [match, allTracks],
  );
  /** The mistakes, grouped by the rule that made them. */
  const wrongByRule = useMemo(() => {
    const out = new Map<string, number>();
    for (const r of match.rows) {
      if (!ruleIsWrong(r, match.corners, allTracks, match.source)) continue;
      const who = decidingRule(r, match.corners, allTracks, match.source);
      if (who) out.set(who, (out.get(who) ?? 0) + 1);
    }
    return [...out.entries()].sort((a, b) => b[1] - a[1]);
  }, [match, allTracks]);
  /** Every reason a point went uncalled, biggest pile first. */
  const noCallReasons = useMemo(() => {
    const out = new Map<string, number>();
    for (const r of match.rows) {
      const why = noCallReason(r, match.corners, allTracks, match.source);
      if (why) out.set(why, (out.get(why) ?? 0) + 1);
    }
    return [...out.entries()].sort((a, b) => b[1] - a[1]);
  }, [match, allTracks]);
  const noCall = useMemo(
    () => match.rows.filter(
      (r) => ruleVerdict(r, match.corners, allTracks, match.source) === null,
    ).length,
    [match, allTracks],
  );
  /**
   * How each rule scores against Adil's own taps, on the points it decides.
   *
   * One pass over the readings rather than three re-derivations of the
   * chain, so a repaired call is counted by the rule that made it and the
   * chips add up to the verdict the row shows.
   */
  const scores = useMemo(() => {
    const zero = () => ({ fires: 0, right: 0, workerRight: 0, byTurn: 0, repaired: 0 });
    const out: Record<string, ReturnType<typeof zero>> = {
      "ball died": zero(), "off table": zero(), "no return": zero(),
    };
    for (const r of match.rows) {
      const read = reading(r, match.corners, allTracks, match.source);
      if (read.rule === null || r.winner === null) continue;
      const s = out[read.rule];
      s.fires += 1;
      if (read.winner === r.winner) s.right += 1;
      if (r.computed?.winner === r.winner) s.workerRight += 1;
      if (read.recovered.length) s.repaired += 1;
      if (read.rule === "ball died") {
        const died = findBallDied(read.events, allTracks?.[r.pointId] ?? null,
          match.corners, r.clipT0, match.source, r.userPhysicalSide);
        if (died?.via === "turn") s.byTurn += 1;
      }
    }
    return out;
  }, [match, allTracks]);
  const runScore = scores["ball died"];
  const offScore = scores["off table"];
  const noReturnScore = scores["no return"];
  const repairedTotal = runScore.repaired + offScore.repaired + noReturnScore.repaired;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">Serve accuracy</h1>
      <p className="mt-2 max-w-3xl text-sm text-zinc-400">
        Everything measured about each point, beside the video it was measured
        from. The pink outline is where the table was calibrated to. Rings on
        the clip are detected touches as they happen, and the yellow trail is
        the ball itself. On the small court every bounce that projected onto
        the table is plotted, with the serve&apos;s two in colour. Production
        stores only the touches it decided on, so the trail comes from
        re-running BlurBall over these clips: it is a fresh track, not the one
        the reconstruction actually read.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {matches.map((m) => (
          <button
            key={m.matchId}
            type="button"
            onClick={() => setActive(m.matchId)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              m.matchId === active
                ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                : "border-edge bg-surface-2/40 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-edge bg-surface p-4">
          <p className="text-sm text-zinc-200">
            Serves drawn for {stats.drawn} of {stats.total}. A rally ending for{" "}
            {stats.withFinal}. {stats.events} touches detected in all.
          </p>
          <p className="mt-2 text-sm text-zinc-200">
            The worker&apos;s own call matched your tap on{" "}
            <span className="tabular-nums">{stats.callAgreed}</span> of{" "}
            <span className="tabular-nums">{stats.callCompared}</span> scored
            points.
          </p>
          <p className="mt-2 text-sm text-zinc-200">
            Serve speed measurable on{" "}
            <span className="tabular-nums">{stats.speedCount}</span>, median{" "}
            <span className="tabular-nums">
              {stats.speedMedian ? `${stats.speedMedian.toFixed(0)} km/h` : "n/a"}
            </span>
            .
          </p>
          <p className="mt-2 text-sm text-zinc-200">
            The ball died on the table on{" "}
            <span className="tabular-nums">{runScore.fires}</span> scored
            points, and the side it died on lost it{" "}
            <span className="tabular-nums">{runScore.right}</span> times. The
            worker was right on{" "}
            <span className="tabular-nums">{runScore.workerRight}</span> of the
            same points. Its bounces were the witness on all but{" "}
            <span className="tabular-nums">{runScore.byTurn}</span>, where the
            ball turned at the net and dropped only twice.
          </p>
          <p className="mt-2 text-sm text-zinc-200">
            The ball left the table on{" "}
            <span className="tabular-nums">{offScore.fires}</span> more, where
            the ball&rsquo;s path into that last shot was clean enough to
            follow, and that named the winner right{" "}
            <span className="tabular-nums">{offScore.right}</span> times
            against the worker&rsquo;s{" "}
            <span className="tabular-nums">{offScore.workerRight}</span>.
          </p>
          <p className="mt-2 text-sm text-zinc-200">
            And on{" "}
            <span className="tabular-nums">{noReturnScore.fires}</span> more
            the track shows the ball never coming back over the net after the
            last landing, which named the winner right{" "}
            <span className="tabular-nums">{noReturnScore.right}</span> times
            against the worker&rsquo;s{" "}
            <span className="tabular-nums">{noReturnScore.workerRight}</span>.
          </p>
          <p className="mt-2 text-sm text-zinc-200">
            <span className="tabular-nums">{repairedTotal}</span> of those
            calls only exist because the ball&rsquo;s track was read as
            flights and the events it was missing were put back. Where the
            rules answer from what the worker recorded, nothing is repaired,
            so no call already being made can change.
          </p>
          <p className="mt-2 text-[11px] text-zinc-500">
            Calibration: {match.calibrationSource ?? "unknown"}.
          </p>
        </div>
        <div className="rounded-xl border border-edge bg-surface p-4">
          <p className="text-sm text-zinc-200">Why a serve was not drawn</p>
          <ul className="mt-2 space-y-1">
            {stats.reasons.map(([reason, count]) => (
              <li key={reason} className="text-xs text-zinc-500">
                <span className="tabular-nums text-zinc-400">{count}</span>
                {" · "}
                {REJECTION_COPY[reason]}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-3">
        <Legend />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ["all", `All ${match.rows.length}`],
            ["drawn", `Serve drawn ${stats.drawn}`],
            ["refused", `Refused ${match.rows.length - stats.drawn}`],
            ["disagreed", `Worker disagreed ${disagreed}`],
            ["deadrun", `Ball died ${runScore.fires}`],
            ["offtable", `Off table ${offScore.fires}`],
            ["wrong", `We called it wrong ${ruleWrong}`],
            ["disagree", `Rules disagree ${disagreeCount}`],
            ["repaired", `Repaired ${repairedCount}`],
            ["serverepair", `Serve recovered ${serveRecovered}`],
            ["heldback", `Held back ${heldBack}`],
            ["noreturn", `No return ${noReturnScore.fires}`],
            ["nocall", `No call ${noCall}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setOnly(key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              only === key
                ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                : "border-edge bg-surface-2/40 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {wrongByRule.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">
            Which rule got it wrong
          </span>
          {wrongByRule.map(([name, count]) => (
            <button
              key={name}
              type="button"
              onClick={() => setOnly(`wrongby:${name}`)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                only === `wrongby:${name}`
                  ? "border-amber-300/60 bg-amber-300/15 text-amber-200"
                  : "border-edge bg-surface-2/40 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {name} {count}
            </button>
          ))}
        </div>
      )}

      {noCallReasons.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">
            Why it made no call
          </span>
          {noCallReasons.map(([why, count]) => (
            <button
              key={why}
              type="button"
              onClick={() => setOnly(`why:${why}`)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                only === `why:${why}`
                  ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                  : "border-edge bg-surface-2/40 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {why} {count}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <Row key={row.pointId} row={row} match={match} tracks={allTracks} />
        ))}
      </div>
    </main>
  );
}
