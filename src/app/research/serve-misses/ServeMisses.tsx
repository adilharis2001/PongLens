"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { netSegmentFromQuad } from "../serve-accuracy/netDeath";

/** One bounce, in the picture and on the table. */
export interface MissBounce {
  t: number;
  x: number;
  y: number;
  u: number | null;
  v: number | null;
  onTable: boolean;
  onSurface: boolean;
}

export interface MissWhy {
  bounces: number;
  on_surface: number;
  pairs: number;
  rejects: Record<string, number>;
  reason: string;
  /** [t of first bounce, t of second, the rule that turned the pair away] */
  detail: [number, number, string][];
}

export interface MissCard {
  t0: number;
  t1: number;
  dur: number;
  track: [number, number, number][];
  bounces: MissBounce[];
  crossings: number[];
  why: MissWhy;
}

export interface MissMatch {
  key: string;
  title: string;
  video: string;
  dataUrl: string;
}

/** What Adil said about a card, watching it. Keyed `<match8>:<t0 to 2dp>`. */
export interface CardLabel {
  /** "missed" | "fair" | "unclear" — a plain string so the generated
   *  labels.json widens cleanly without a cast. */
  verdict: string;
  serve_at?: number;
  server?: string;
  outcome?: string;
  bounce_where?: string;
  ball_visible?: string;
  points_in_clip?: string;
  tracker?: string;
  note?: string;
}

export interface MatchFacts {
  cards: number;
  noServe: number;
  anchored: number;
  quad: string | null;
  neighbour: string | null;
}

export interface Labels {
  cards: Record<string, CardLabel>;
  matches: Record<string, MatchFacts>;
  counts: {
    labelled: number;
    described: number;
    missed: number;
    fair: number;
    noPoint: number;
  };
}

/** Adil's words for each outcome, so the page says what he saw. */
const OUTCOME: Record<string, string> = {
  rally: "served, came back, point played out",
  net_back: "service fault — hit the net, fell back on the server's side",
  net_over: "clipped the net but went over",
  long: "went off the far end without bouncing",
  wide: "went off the side",
  volleyed: "receiver hit it before it bounced",
  double_own: "bounced twice on the server's own half",
  toss_miss: "server tossed and missed the ball",
  knockup: "not a point — knock-up or warm-up",
  mid_rally: "no serve — clip opens mid-rally",
  retrieval: "no serve — the ball being passed between points",
  unsure: "he could not tell",
};

const NO_POINT = new Set(["retrieval", "knockup", "mid_rally"]);

interface MissData {
  key: string;
  w: number;
  h: number;
  duration: number;
  quad: number[][];
  net: number[][];
  prism: number[][];
  cards: MissCard[];
  total_cards: number;
  meta: Record<string, unknown>;
  reasons: Record<string, string>;
  /** attached client-side: the presigned review video for this match */
  videoSrc: string;
}

const TABLE_W_M = 1.525;
const TABLE_L_M = 2.74;

/** One colour per rule, held steady between the chips, the picture and the
 *  table map so a card can be read in any of the three. */
const TONE: Record<string, string> = {
  same_side: "#ff6b6b",
  too_far_apart: "#f59e0b",
  on_the_net_line: "#c084fc",
  off_surface: "#38bdf8",
  no_apex: "#34d399",
  backtracked: "#fb7185",
  rally_running: "#94a3b8",
  no_pair: "#64748b",
  would_have_passed: "#facc15",
};

function tone(reason: string) {
  return TONE[reason] ?? "#a1a1aa";
}

/** The card's own footage with the table, the net and the ball on it. */
function Picture({ d, card }: { d: MissData; card: MissCard }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [t, setT] = useState(card.t0);
  const [playing, setPlaying] = useState(false);

  // Seek into the card whenever the row changes, so the poster frame is
  // the card rather than the first frame of the whole match.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const seek = () => {
      v.currentTime = card.t0;
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener("loadedmetadata", seek, { once: true });
  }, [card.t0]);

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
      const sx = w / d.w;
      const sy = h / d.h;
      const now = v.currentTime;
      setT(now);

      // stop at the end of this card rather than running into the next
      if (!v.paused && now > card.t1) {
        v.pause();
        v.currentTime = card.t0;
      }

      ctx.beginPath();
      d.prism.forEach(([px, py], i) => {
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

      ctx.beginPath();
      d.quad.forEach(([px, py], i) => {
        const X = px * sx;
        const Y = py * sy;
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      ctx.closePath();
      ctx.strokeStyle = "#ff2d95";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Derived from the quad, not the payload's baked `net` — the worker
      // wrote the pixel midpoint of the sidelines until 2026-09-02, which
      // sits 30-41 cm into the near half under perspective.
      const seg = netSegmentFromQuad(d.quad);
      const [n1, n2] = seg ? [seg.e1, seg.e2] : d.net;
      ctx.beginPath();
      ctx.moveTo(n1[0] * sx, n1[1] * sy);
      ctx.lineTo(n2[0] * sx, n2[1] * sy);
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

      // every bounce in the card, held for a third of a second either side
      // so a 30fps event is visible at all
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
  }, [d, card]);

  return (
    <div>
      {/* The box is sized here, on the div, and the video fills it. A
          media element has no intrinsic size until its metadata arrives,
          so a bare `w-full` video is 300x150 until the file answers — and
          the overlay canvas, which measures the video, would be drawn at
          that size and then jump. */}
      <div
        className="relative overflow-hidden rounded bg-black"
        style={{ aspectRatio: `${d.w} / ${d.h}` }}
      >
        <video
          ref={videoRef}
          src={d.videoSrc}
          preload="metadata"
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className="absolute inset-0 block h-full w-full"
        />
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
              if (v.currentTime < card.t0 || v.currentTime > card.t1)
                v.currentTime = card.t0;
              void v.play();
            } else v.pause();
          }}
          className="rounded-full border border-zinc-700 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
        >
          {playing ? "Pause" : "Play the card"}
        </button>
        <input
          type="range"
          min={card.t0}
          max={card.t1}
          step={0.04}
          value={Math.min(Math.max(t, card.t0), card.t1)}
          onChange={(e) => {
            const v = videoRef.current;
            if (v) v.currentTime = Number(e.target.value);
          }}
          className="h-1 flex-1 accent-cyan-400"
        />
        <span className="w-28 shrink-0 text-right text-xs tabular-nums text-zinc-500">
          {(t - card.t0).toFixed(2)}s of {card.dur.toFixed(1)}s
        </span>
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
      <line
        x1={TX + TW / 2}
        y1={TY}
        x2={TX + TW / 2}
        y2={TY + TH}
        stroke="#cbd5e1"
        strokeOpacity="0.3"
        strokeWidth="0.75"
      />
      {placed.map((b, i) => {
        const p = xy(b.u as number, b.v as number);
        const live = Math.abs(t - b.t) < 0.34;
        return (
          <g key={`${b.t}-${i}`}>
            <title>
              {`${b.t.toFixed(2)}s · ${b.u?.toFixed(2)}, ${b.v?.toFixed(2)} m`
                + ` · ${b.onSurface ? "on the surface" : "off the surface"}`}
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

/** What Adil said about this card, watching it. Absent on most cards. */
function Verdict({ lab }: { lab?: CardLabel }) {
  if (!lab) return null;
  const noPoint = lab.outcome ? NO_POINT.has(lab.outcome) : false;
  const tint = noPoint
    ? { border: "#f59e0b", color: "#fbbf24", bg: "#f59e0b1a" }
    : lab.verdict === "missed"
      ? { border: "#4ade80", color: "#86efac", bg: "#4ade801a" }
      : lab.verdict === "fair"
        ? { border: "#f87171", color: "#fca5a5", bg: "#f871711a" }
        : { border: "#71717a", color: "#a1a1aa", bg: "#71717a1a" };
  const headline = noPoint
    ? "No point here at all"
    : lab.verdict === "missed"
      ? "A real serve the detector should have found"
      : lab.verdict === "fair"
        ? "Rightly refused"
        : "He could not tell";
  const bits: string[] = [];
  if (lab.outcome) bits.push(OUTCOME[lab.outcome] ?? lab.outcome);
  if (lab.server && lab.server !== "unsure")
    bits.push(`the ${lab.server} player served`);
  if (typeof lab.serve_at === "number")
    bits.push(`bat on ball ${lab.serve_at.toFixed(2)}s into the clip`);
  if (lab.ball_visible === "faint") bits.push("ball only faintly visible");
  if (lab.ball_visible === "occluded") bits.push("ball hidden behind a player");
  if (lab.points_in_clip === "two_plus") bits.push("two or more points in the clip");
  if (lab.tracker && lab.tracker !== "fine" && lab.tracker !== "unsure")
    bits.push(`ball trail: ${lab.tracker.replace(/_/g, " ")}`);
  return (
    <div
      className="mt-3 rounded-md border px-3 py-2"
      style={{ borderColor: tint.border, background: tint.bg }}
    >
      <p className="text-xs font-semibold" style={{ color: tint.color }}>
        {headline}
      </p>
      {bits.length > 0 && (
        <p className="mt-1 text-xs text-zinc-300">{bits.join(" · ")}</p>
      )}
      {lab.note && (
        <p className="mt-1.5 text-xs italic leading-relaxed text-zinc-400">
          &ldquo;{lab.note}&rdquo;
        </p>
      )}
    </div>
  );
}

function Row({
  d,
  card,
  n,
  lab,
}: {
  d: MissData;
  card: MissCard;
  n: number;
  lab?: CardLabel;
}) {
  const [t, setT] = useState(card.t0);
  const why = card.why;
  const label = d.reasons[why.reason] ?? why.reason;
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-zinc-100">
          Card {n} · {card.t0.toFixed(1)}s to {card.t1.toFixed(1)}s ·{" "}
          {card.dur.toFixed(1)}s
        </h3>
        <span
          className="rounded-full px-2 py-0.5 text-xs"
          style={{ background: `${tone(why.reason)}22`, color: tone(why.reason) }}
        >
          {label}
        </span>
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_170px]">
        <PictureWithClock d={d} card={card} onT={setT} />
        <div>
          <Court card={card} t={t} />
          <p className="mt-1 text-xs text-zinc-500">
            {why.bounces} bounce{why.bounces === 1 ? "" : "s"} in this card,{" "}
            {why.on_surface} on the surface, {why.pairs} pair
            {why.pairs === 1 ? "" : "s"} tested
          </p>
        </div>
      </div>
      {why.detail.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-zinc-500">Every pair the detector tried</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {why.detail.map(([ta, tb, rule], i) => (
              <span
                key={`${ta}-${tb}-${i}`}
                title={d.reasons[rule] ?? rule}
                className="rounded border px-1.5 py-0.5 text-[11px] tabular-nums"
                style={{ borderColor: `${tone(rule)}66`, color: tone(rule) }}
              >
                {ta.toFixed(1)}→{tb.toFixed(1)} {rule.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}
      <Verdict lab={lab} />
    </section>
  );
}

/** Picture plus a clock the court can read, without lifting video state. */
function PictureWithClock({
  d,
  card,
  onT,
}: {
  d: MissData;
  card: MissCard;
  onT: (t: number) => void;
}) {
  const wrap = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wrap.current?.querySelector("video");
    if (!el) return;
    const h = () => onT(el.currentTime);
    el.addEventListener("timeupdate", h);
    el.addEventListener("seeked", h);
    return () => {
      el.removeEventListener("timeupdate", h);
      el.removeEventListener("seeked", h);
    };
  }, [onT]);
  return (
    <div ref={wrap}>
      <Picture d={d} card={card} />
    </div>
  );
}

function MatchBlock({ m, labels }: { m: MissMatch; labels: Labels }) {
  const [d, setD] = useState<MissData | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const facts = labels.matches[m.key.slice(0, 8)];

  useEffect(() => {
    if (!open || d) return;
    let alive = true;
    fetch(m.dataUrl)
      .then((r) => r.json())
      .then((j) => {
        if (alive) setD({ ...j, videoSrc: m.video });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, d, m.dataUrl, m.video]);

  const tally = useMemo(() => {
    const out = new Map<string, number>();
    for (const c of d?.cards ?? [])
      out.set(c.why.reason, (out.get(c.why.reason) ?? 0) + 1);
    return [...out.entries()].sort((a, b) => b[1] - a[1]);
  }, [d]);

  const shown = (d?.cards ?? []).filter(
    (c) => filter === "all" || c.why.reason === filter,
  );

  return (
    <section className="rounded-lg border-l-4 border-zinc-600 bg-zinc-900/40 p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 text-left"
      >
        <h2 className="text-base font-semibold text-zinc-100">{m.title}</h2>
        {d ? (
          <span className="text-xs text-zinc-400">
            {d.cards.length} of {d.total_cards} cards had no serve
          </span>
        ) : (
          <span className="text-xs text-zinc-500">
            {open ? "loading…" : "open"}
          </span>
        )}
        {facts && (
          <span className="text-xs text-zinc-500">
            · {facts.anchored}% anchored
            {facts.quad && facts.quad !== "good" && (
              <span className="text-amber-400">
                {" "}
                · table drawn wrong ({facts.quad.replace(/_/g, " ")})
              </span>
            )}
            {facts.neighbour && facts.neighbour !== "none" && (
              <span> · {facts.neighbour} neighbouring table in shot</span>
            )}
          </span>
        )}
      </button>

      {d && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`rounded-full border px-3 py-1 text-xs ${
              filter === "all"
                ? "border-zinc-300 text-zinc-100"
                : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            All {d.cards.length}
          </button>
          {tally.map(([reason, count]) => (
            <button
              key={reason}
              type="button"
              title={d.reasons[reason] ?? reason}
              onClick={() => setFilter(reason)}
              className="rounded-full border px-3 py-1 text-xs"
              style={{
                borderColor: filter === reason ? tone(reason) : "#3f3f46",
                color: tone(reason),
                background: filter === reason ? `${tone(reason)}1a` : undefined,
              }}
            >
              {count} {reason.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      )}

      {d && (
        <div className="mt-4 space-y-5">
          {shown.map((c, i) => (
            <Row
              key={`${c.t0}-${c.t1}`}
              d={d}
              card={c}
              n={i + 1}
              lab={labels.cards[`${m.key.slice(0, 8)}:${c.t0.toFixed(2)}`]}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function ServeMisses({
  matches,
  labels,
}: {
  matches: MissMatch[];
  labels: Labels;
}) {
  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <h1 className="text-xl font-semibold text-zinc-100">Serve misses</h1>
      <p className="mt-2 max-w-prose text-sm text-zinc-400">
        Every card the assembler built without a serve, and the reason the
        detector gave for each one. A serve is accepted as a pair of bounces,
        so a card with no serve is a card where no pair passed. Six rules can
        turn a pair away, and the chip on each card names the one that did.
      </p>

      <section className="mt-6 rounded-lg border border-zinc-700 bg-zinc-900/60 p-4">
        <h2 className="text-sm font-semibold text-zinc-100">
          What we learned by watching these, 28–29 August
        </h2>
        <p className="mt-2 max-w-prose text-sm text-zinc-400">
          Adil watched all {labels.counts.labelled} of these cards and said, for
          each, whether a serve was really there:{" "}
          <b className="text-zinc-200">{labels.counts.missed}</b> yes,{" "}
          <b className="text-zinc-200">{labels.counts.fair}</b> rightly refused.
          He then described {labels.counts.described} of them in detail, marking
          the exact moment of bat-on-ball and who served. Those answers are on
          the cards below, and they overturned two things everyone believed.
        </p>
        <ul className="mt-3 max-w-prose space-y-2.5 text-sm text-zinc-400">
          <li>
            <b className="text-zinc-200">
              It is the serve&apos;s OWN first bounce that goes missing, not the
              second.
            </b>{" "}
            On the 28 cards where he named the server, 17 are missing the bounce
            on the server&apos;s own half. Everyone had assumed the opposite —
            that serves went long and never landed on the receiver&apos;s side.
            This matters beyond the clip: the placement map draws the second
            bounce but refuses to draw anything unless it also sees the first,
            so this exact bounce is what stops a dot appearing.
          </li>
          <li>
            <b className="text-zinc-200">
              A quarter of these cards contain no point at all.
            </b>{" "}
            They are the ball being lobbed back between points, or a player
            wiping the table. A lobbed ball bounces twice on opposite halves and
            looks exactly like a serve, which is why loosening any rule picks
            them up. Counting only cards that hold a real point, anchoring is
            about <b className="text-zinc-200">80%</b>, not the 75% this page
            used to imply.
          </li>
          <li>
            <b className="text-zinc-200">
              The &ldquo;ball travelled backwards&rdquo; rule measures how HIGH
              the ball went.
            </b>{" "}
            It works on a flat map of the table, and a ball in the air projects
            to a nonsense position, so a high toss reads as the ball flying
            backwards. Low serves score 0.09 m of &ldquo;backward travel&rdquo;;
            high ones score 1.17 m, against a 0.50 m limit.
          </li>
          <li>
            <b className="text-zinc-200">
              The reason chip is a rough sort, not a diagnosis.
            </b>{" "}
            It names the rule that refused the pair which got furthest through
            the six tests, and that pair is often not the serve — on the
            &ldquo;rally already running&rdquo; cards it sat a median of four
            seconds into the card. Trust the green and red panels below the
            chip; treat the chip itself as a filter.
          </li>
        </ul>
        <p className="mt-3 max-w-prose text-xs text-zinc-500">
          Eight of the nine tables were confirmed correctly drawn by eye. Only
          74542390 has its far end line too close to the camera, and it is the
          worst match here. Only 840b4635 has a whole neighbouring table in
          shot, and it is the best — so a bounce landing sideways off the table
          is, on seven of nine matches, not somebody else&apos;s ball.
        </p>
      </section>

      <p className="mt-6 max-w-prose text-sm text-zinc-400">
        On the picture: the table in pink, the net through the quad&apos;s true
        centre in white, the play prism in cyan, the ball in yellow, and every
        bounce ringed green where it landed on the playing surface and red
        where it did not. The map beside it is the same bounces looking down on
        the table, numbered in order, so &quot;both on the same half&quot; is
        something you can see rather than take on trust.
      </p>
      <p className="mt-3 max-w-prose text-sm text-zinc-400">
        The rules and their constants are imported from the detector rather
        than copied, and the list of cards is recomputed at the settings
        production is running right now rather than read from what was stored
        when the bundle was written. Before 29 August it was read from the
        bundle, so this page went on showing 41 cards whose serve production had
        already learned to find.
      </p>
      <div className="mt-6 space-y-6">
        {matches.map((m) => (
          <MatchBlock key={m.key} m={m} labels={labels} />
        ))}
      </div>
    </main>
  );
}
