"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
}: {
  url: string;
  row: ServeAccuracyRow;
  corners: ServeAccuracyMatch["corners"];
  source: ServeAccuracyMatch["source"];
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showQuad, setShowQuad] = useState(true);

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
          // The net line, halfway down each sideline.
          const mid = (a: number[], b: number[]) =>
            [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
          const l = mid(pts[0], pts[3]);
          const r = mid(pts[1], pts[2]);
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

      // Touches near the playhead. A marker holds for a third of a second
      // either side so a 30fps event is visible at all.
      const now = video.currentTime;
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
  }, [row.events, corners, source, showQuad]);

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
      <button
        type="button"
        onClick={() => setShowQuad((q) => !q)}
        className="mt-2 rounded-full border border-edge px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200"
      >
        {showQuad ? "Hide the table outline" : "Show the table outline"}
      </button>
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
function Court({ row }: { row: ServeAccuracyRow }) {
  const xy = (u: number, v: number) => ({
    x: TX + (TW * u) / TABLE_W_M,
    y: TY + TH * (1 - v / TABLE_L_M),
  });
  const bounces = row.events.filter(
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
              {`${e.kind}${e.role ? ` · ${e.role.replace(/_/g, " ")}` : ""} · `
                + `${e.t.toFixed(2)}s · vis ${e.visual.toFixed(2)}`}
            </title>
            <circle
              cx={p.x}
              cy={p.y}
              r={isServe ? 5 : 3.5}
              fill={toneFor(e)}
              fillOpacity={isServe ? 0.9 : 0.45}
              stroke="#0c1222"
              strokeWidth="0.75"
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

function Row({
  row,
  match,
}: {
  row: ServeAccuracyRow;
  match: ServeAccuracyMatch;
}) {
  const [url, setUrl] = useState<string | null>(null);
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
        <Court row={row} />
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
        </p>
      )}
    </div>
  );
}

export function ServeAccuracy({ matches }: { matches: ServeAccuracyMatch[] }) {
  const [active, setActive] = useState(matches[0].matchId);
  const [only, setOnly] = useState<"all" | "drawn" | "refused" | "disagreed">(
    "all",
  );
  const match = matches.find((m) => m.matchId === active) ?? matches[0];
  const stats = useMemo(() => summarise(match.rows), [match]);
  const rows = useMemo(
    () =>
      match.rows.filter((r) =>
        only === "all" ? true
          : only === "drawn" ? r.serve !== null
            : only === "refused" ? r.serve === null
              : r.winner !== null
                && r.computed?.winner != null
                && r.computed.winner !== r.winner,
      ),
    [match, only],
  );
  const disagreed = stats.callCompared - stats.callAgreed;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">Serve accuracy</h1>
      <p className="mt-2 max-w-3xl text-sm text-zinc-400">
        Everything measured about each point, beside the video it was measured
        from. The pink outline is where the table was calibrated to. Rings on
        the clip are detected touches as they happen. On the small court every
        bounce that projected onto the table is plotted, with the serve&apos;s
        two in colour. The ball&apos;s position on every frame is not kept in
        production, so what you see are the touches, not the track.
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

      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ["all", `All ${match.rows.length}`],
            ["drawn", `Serve drawn ${stats.drawn}`],
            ["refused", `Refused ${match.rows.length - stats.drawn}`],
            ["disagreed", `Worker disagreed ${disagreed}`],
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

      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <Row key={row.pointId} row={row} match={match} />
        ))}
      </div>
    </main>
  );
}
