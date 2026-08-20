"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";

export interface FullMatchNote {
  readonly case_id: string;
  readonly verdict: string | null;
  readonly note: string | null;
}

export interface FullMatchLabel {
  readonly id: string;
  readonly match_key: string;
  readonly kind: "serve" | "end" | "let";
  readonly t_s: number;
  readonly winner: "me" | "opponent" | null;
  readonly end_kind: "far" | "near" | "net" | "table" | "side" | null;
}

const END_KINDS: readonly {
  key: string;
  value: NonNullable<FullMatchLabel["end_kind"]>;
  label: string;
}[] = [
  { key: "f", value: "far", label: "F — far side" },
  { key: "n", value: "near", label: "N — near side" },
  { key: "t", value: "net", label: "T — died at the net" },
  { key: "d", value: "table", label: "D — died on the table" },
  { key: "r", value: "side", label: "R — rolled off the side" },
];


interface FullData {
  key: string;
  duration: number;
  w: number;
  h: number;
  quad: number[][];
  net: number[][];
  /** The play prism: the image region vertically above the table. */
  prism?: number[][];
  track: number[][]; // [t, x, y, inPrism]
  bounces: number[][]; // [t, x, y, onTable]
  crossings: number[];
  serves: number[];
  dense: number[][]; // [t0, t1]
  cards: (number | null)[][]; // [t0, t1, serve_s|null]
  /** The global-segmentation cards, held out from their own tuning. */
  newcards?: number[][]; // [t0, t1]
  newscore?: {
    n: number; clean: number; clipped: number;
    fused: number; split: number; lost: number;
  };
  presence: number[][]; // [t, near, far]
}

const KEYS = ["koko", "terry", "tripp_rc"] as const;
const TITLES: Record<string, string> = {
  koko: "Koko",
  terry: "Terry",
  tripp_rc: "Tripp",
};
const RATES = [0.25, 0.5, 1, 1.5] as const;
const TRAIL_S = 0.7;
const ZOOM_S = 30; // zoom band width in seconds

/** First index in `arr` (sorted by row[0]) with time >= t. */
function lowerBound(arr: number[][], t: number): number {
  let lo = 0,
    hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid][0] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function Overlay({ d, t, show }: { d: FullData; t: number; show: boolean }) {
  if (!show) return null;
  const a = lowerBound(d.track, t - TRAIL_S);
  const b = lowerBound(d.track, t + 0.02);
  const trail = d.track.slice(a, b);
  const head = trail.length ? trail[trail.length - 1] : null;
  const ba = lowerBound(d.bounces, t - 0.05);
  const bb = lowerBound(d.bounces, t + 1.2);
  return (
    <svg
      viewBox={`0 0 ${d.w} ${d.h}`}
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {d.prism ? (
        // the play prism: the region vertically above the table. Motion
        // outside it no longer counts as evidence; the trail turns grey
        // out there so the ignoring is visible.
        <polygon
          points={d.prism.map((p) => p.join(",")).join(" ")}
          fill="rgba(0,200,255,0.06)"
          stroke="rgba(0,220,255,0.7)"
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />
      ) : null}
      <polygon
        points={d.quad.map((p) => p.join(",")).join(" ")}
        fill="none"
        stroke="rgba(255,255,255,0.85)"
        strokeWidth={2}
      />
      <line
        x1={d.net[0][0]}
        y1={d.net[0][1]}
        x2={d.net[1][0]}
        y2={d.net[1][1]}
        stroke="#ff3ca0"
        strokeWidth={2}
      />
      {trail.map((p, i) => (
        <circle
          key={i}
          cx={p[1]}
          cy={p[2]}
          r={3}
          fill={p[3] ? "#78c8ff" : "#6a6a74"}
          opacity={Math.max(0.1, 1 - (t - p[0]) / TRAIL_S)}
        />
      ))}
      {head ? (
        <circle
          cx={head[1]}
          cy={head[2]}
          r={5}
          fill={head[3] ? "#fff" : "#8a8a94"}
          stroke={head[3] ? "#0096ff" : "#6a6a74"}
          strokeWidth={2}
        />
      ) : null}
      {d.bounces.slice(ba, bb).map((p, i) => {
        const age = t - p[0];
        if (age < -0.05) return null;
        return (
          <circle
            key={i}
            cx={p[1]}
            cy={p[2]}
            r={5}
            fill={p[3] ? "#50ff78" : "#ff5050"}
            opacity={Math.max(0, 1 - age / 1.2)}
          />
        );
      })}
    </svg>
  );
}

/** The zoomed timeline: ±15s of every signal, redrawn as the video plays. */
function drawZoom(
  cv: HTMLCanvasElement,
  d: FullData,
  t: number,
  labels: readonly FullMatchLabel[] = [],
) {
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const W = cv.width,
    H = cv.height;
  const t0 = Math.max(0, Math.min(t - ZOOM_S / 2, d.duration - ZOOM_S));
  const X = (s: number) => ((s - t0) / ZOOM_S) * W;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#101014";
  ctx.fillRect(0, 0, W, H);

  // lane guide text
  const lanes: [string, number][] = [
    ["now", 6],
    ["new", 30],
    ["serves", 56],
    ["cross", 74],
    ["bounce", 92],
    ["ball", 110],
    ["near", 124],
    ["far", 138],
  ];
  ctx.font = "10px system-ui";
  ctx.fillStyle = "#606070";
  for (const [name, y] of lanes) ctx.fillText(name, 4, y + 10);

  // cards with serve anchors
  for (const [a, b, sv] of d.cards) {
    if ((b as number) < t0 || (a as number) > t0 + ZOOM_S) continue;
    ctx.fillStyle = "rgba(90,140,255,0.35)";
    ctx.fillRect(X(a as number), 6, X(b as number) - X(a as number), 20);
    ctx.strokeStyle = "#5a8cff";
    ctx.strokeRect(X(a as number), 6, X(b as number) - X(a as number), 20);
    if (sv != null) {
      ctx.fillStyle = "#ffdc00";
      ctx.fillRect(X(sv as number) - 1, 6, 2, 20);
    }
  }
  // the new segmentation's cards
  for (const [a, b] of d.newcards ?? []) {
    if (b < t0 || a > t0 + ZOOM_S) continue;
    ctx.fillStyle = "rgba(160,110,255,0.35)";
    ctx.fillRect(X(a), 30, X(b) - X(a), 20);
    ctx.strokeStyle = "#a06eff";
    ctx.strokeRect(X(a), 30, X(b) - X(a), 20);
  }
  // serve calls
  ctx.fillStyle = "#ffdc00";
  for (const s of d.serves)
    if (s >= t0 && s <= t0 + ZOOM_S) ctx.fillRect(X(s) - 1, 56, 2, 14);
  // crossings
  ctx.fillStyle = "#ffb43c";
  for (const s of d.crossings)
    if (s >= t0 && s <= t0 + ZOOM_S) ctx.fillRect(X(s), 74, 1.5, 14);
  // bounces
  for (const p of d.bounces) {
    if (p[0] < t0 || p[0] > t0 + ZOOM_S) continue;
    ctx.fillStyle = p[3] ? "#50ff78" : "#ff5050";
    ctx.fillRect(X(p[0]) - 1, 92, 2.5, 12);
  }
  // dense ball motion
  ctx.fillStyle = "rgba(120,200,255,0.5)";
  for (const [a, b] of d.dense) {
    if (b < t0 || a > t0 + ZOOM_S) continue;
    ctx.fillRect(X(a), 110, X(b) - X(a), 10);
  }
  // presence
  for (const [pt, nearOn, farOn] of d.presence) {
    if (pt < t0 || pt > t0 + ZOOM_S) continue;
    if (nearOn) {
      ctx.fillStyle = "rgba(120,255,160,0.6)";
      ctx.fillRect(X(pt), 124, 2, 10);
    }
    if (farOn) {
      ctx.fillStyle = "rgba(255,120,220,0.6)";
      ctx.fillRect(X(pt), 138, 2, 10);
    }
  }
  // his marks: serve = cyan, end = orange, full height so they read at a
  // glance against every lane at once
  for (const l of labels) {
    if (l.t_s < t0 || l.t_s > t0 + ZOOM_S) continue;
    ctx.fillStyle =
      l.kind === "serve" ? "#00ffcc"
      : l.kind === "let" ? "#9090ff"
      : "#ff8800";
    ctx.fillRect(X(l.t_s) - 1, 0, 2, H - 6);
    if (l.kind === "end" && l.winner) {
      ctx.font = "10px system-ui";
      ctx.fillText(l.winner === "me" ? "me" : "opp", X(l.t_s) + 3, 10);
    }
  }
  // playhead
  ctx.fillStyle = "#fff";
  ctx.fillRect(X(t) - 1, 0, 2, H);
  // second ticks
  ctx.fillStyle = "#3a3a44";
  for (let s = Math.ceil(t0); s <= t0 + ZOOM_S; s++)
    ctx.fillRect(X(s), H - 4, 1, 4);
}

/** The whole-match overview strip, drawn once. */
function drawOverview(cv: HTMLCanvasElement, d: FullData) {
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const W = cv.width,
    H = cv.height;
  const X = (s: number) => (s / d.duration) * W;
  ctx.fillStyle = "#101014";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(120,200,255,0.4)";
  for (const [a, b] of d.dense)
    ctx.fillRect(X(a), 18, Math.max(1, X(b) - X(a)), 8);
  ctx.fillStyle = "rgba(90,140,255,0.5)";
  for (const [a, b] of d.cards)
    ctx.fillRect(X(a as number), 2, Math.max(1, X(b as number) - X(a as number)), 6);
  ctx.fillStyle = "rgba(160,110,255,0.6)";
  for (const [a, b] of d.newcards ?? [])
    ctx.fillRect(X(a), 10, Math.max(1, X(b) - X(a)), 6);
  ctx.fillStyle = "#ffdc00";
  for (const s of d.serves) ctx.fillRect(X(s), 2, 1.5, 6);
}

function MatchPanel({
  dataUrl,
  video,
  title,
  note,
  onNote,
  state,
  labels,
  onMark,
  onDelete,
  onTag,
  onTagWinner,
  active,
  onActivate,
}: {
  dataUrl: string;
  video: string;
  title: string;
  note: string;
  onNote: (v: string) => void;
  state: "idle" | "saving" | "saved" | "error";
  labels: readonly FullMatchLabel[];
  onMark: (kind: FullMatchLabel["kind"],
           winner: "me" | "opponent" | null,
           t: number,
           endKind: FullMatchLabel["end_kind"]) => void;
  onDelete: (id: string) => void;
  onTag: (endKind: NonNullable<FullMatchLabel["end_kind"]>) => void;
  onTagWinner: (winner: "me" | "opponent") => void;
  active: boolean;
  onActivate: () => void;
}) {
  const [d, setD] = useState<FullData | null>(null);
  const ref = useRef<HTMLVideoElement | null>(null);
  const zoomRef = useRef<HTMLCanvasElement | null>(null);
  const overRef = useRef<HTMLCanvasElement | null>(null);
  const [t, setT] = useState(0);
  const [show, setShow] = useState(true);
  const [rate, setRate] = useState<number>(1);

  useEffect(() => {
    let alive = true;
    fetch(dataUrl)
      .then((r) => r.json())
      .then((j) => {
        if (alive) setD(j);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [dataUrl]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = ref.current;
      if (v) {
        setT(v.currentTime);
        if (d && zoomRef.current)
          drawZoom(zoomRef.current, d, v.currentTime, labels);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [d, labels]);

  // Marking keys, Keep-score muscle memory: B = serve start, arrows call
  // the winner (which is also the point's end), E = end with no winner,
  // U = undo the last mark, comma/period nudge the playhead 0.15s.
  // Scoped to the panel wrapper so two matches on one page cannot both
  // hear a key; ignored while typing in the notes box.
  // Keys are GLOBAL to the page and routed to the active panel — the one
  // whose video last played or was last touched. The first version
  // listened on the panel and required keyboard focus, which the browser
  // quietly drops the moment the video's native controls are clicked
  // (Safari never grants it at all), so B and E "did nothing" while the
  // video played. No focus, no fragility: window keydown, one listener,
  // the active panel answers.
  const onKey = useCallback((e: KeyboardEvent) => {
    if (
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLInputElement
    )
      return;
    const v = ref.current;
    if (!v) return;
    const k = e.key.toLowerCase();

    // Nothing pauses, nothing pops up: E drops an end mark and play goes
    // on; the ball-location letters (and, optionally, the winner arrows)
    // tag the LAST end whenever he gets to them.
    if (k === "b" || k === "s") {
      onMark("serve", null, v.currentTime, null);
    } else if (k === "e") {
      onMark("end", null, v.currentTime, null);
    } else if (k === "l") {
      onMark("let", null, v.currentTime, null);
    } else if (END_KINDS.some((x) => x.key === k)) {
      onTag(END_KINDS.find((x) => x.key === k)!.value);
    } else if (e.key === "ArrowLeft") {
      onTagWinner("me");
    } else if (e.key === "ArrowRight") {
      onTagWinner("opponent");
    } else if (k === "u") {
      const last = labels[labels.length - 1];
      if (last) onDelete(last.id);
    } else if (k === ",") {
      v.currentTime = Math.max(0, v.currentTime - 0.15);
    } else if (k === ".") {
      v.currentTime = v.currentTime + 0.15;
    } else if (k === " ") {
      if (v.paused) void v.play();
      else v.pause();
    } else {
      return;
    }
    // capture-phase interception: stop the event before the focused
    // <video> can act on it natively (space would double-toggle, and some
    // browsers swallow keys on a focused media element entirely)
    e.preventDefault();
    e.stopPropagation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels, onMark, onTag, onTagWinner, onDelete]);

  useEffect(() => {
    if (!active) return;
    // CAPTURE, not bubble: with focus on the video element, keydown may
    // never bubble back out (his report: shortcuts dead while the video
    // holds focus, alive when the body does). Capture runs window-first,
    // so it cannot be starved by whatever the media element does.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, onKey]);

  useEffect(() => {
    if (d && overRef.current) drawOverview(overRef.current, d);
  }, [d]);

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate;
  }, [rate]);

  const seekZoom = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!d || !ref.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t0 = Math.max(0, Math.min(t - ZOOM_S / 2, d.duration - ZOOM_S));
    ref.current.currentTime = t0 + ((e.clientX - r.left) / r.width) * ZOOM_S;
  };
  const seekOver = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!d || !ref.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    ref.current.currentTime = ((e.clientX - r.left) / r.width) * d.duration;
  };

  return (
    <section
      onMouseDown={onActivate}
      className={`rounded-lg border-l-4 bg-zinc-900/60 p-4 ${
        active ? "border-cyan-500" : "border-zinc-600"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
        {d ? (
          <span className="text-xs text-zinc-400">
            {d.serves.length} serves · {d.cards.length} cards ·{" "}
            {d.crossings.length} crossings · {d.bounces.length} bounces
          </span>
        ) : null}
        {d?.newscore ? (
          <span className="text-xs text-violet-300">
            new cards: {d.newscore.clean}/{d.newscore.n} on their own (
            {Math.round((100 * d.newscore.clean) / d.newscore.n)}%) ·{" "}
            {d.newscore.split} split · {d.newscore.fused} fused ·{" "}
            {d.newscore.clipped} clipped · {d.newscore.lost} lost
          </span>
        ) : (
          <span className="text-xs text-zinc-500">loading signals…</span>
        )}
      </div>

      <div className="relative mt-3 w-full max-w-[960px]">
        <video
          ref={ref}
          src={video}
          playsInline
          controls
          preload="metadata"
          onPlay={(ev) => {
            ev.currentTarget.blur();
            onActivate();
          }}
          className="block w-full rounded"
        />
        {d ? <Overlay d={d} t={t} show={show} /> : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {RATES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRate(r)}
            className={`rounded-full border px-3 py-1 text-xs ${
              rate === r
                ? "border-cyan-400 text-cyan-300"
                : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            {r}x
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          {show ? "Hide overlay" : "Show overlay"}
        </button>
        <span className="ml-1 text-xs tabular-nums text-zinc-500">
          {Math.floor(t / 60)}:{(t % 60).toFixed(1).padStart(4, "0")}
        </span>
      </div>

      <p className="mt-3 text-xs text-zinc-500">
        30-second window around the playhead — click anywhere on it to seek
      </p>
      <canvas
        ref={zoomRef}
        width={960}
        height={152}
        onClick={seekZoom}
        className="mt-1 w-full max-w-[960px] cursor-crosshair rounded"
      />
      <p className="mt-2 text-xs text-zinc-500">whole match — click to jump</p>
      <canvas
        ref={overRef}
        width={960}
        height={30}
        onClick={seekOver}
        className="mt-1 w-full max-w-[960px] cursor-crosshair rounded"
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            ref.current &&
            onMark("serve", null, ref.current.currentTime, null)
          }
          className="rounded-full border border-teal-500 px-3 py-1 text-sm text-teal-300 hover:bg-teal-950"
        >
          Serve start (B)
        </button>
        <button
          type="button"
          onClick={() =>
            ref.current &&
            onMark("end", null, ref.current.currentTime, null)
          }
          className="rounded-full border border-orange-600 px-3 py-1 text-sm text-orange-300 hover:bg-orange-950"
        >
          Point end (E)
        </button>
        <button
          type="button"
          onClick={() =>
            ref.current &&
            onMark("let", null, ref.current.currentTime, null)
          }
          className="rounded-full border border-zinc-600 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
        >
          Let (L)
        </button>
        <span className="text-xs text-zinc-500">
          F/N/T/D/R tag the last end&apos;s ball location · ← → optionally
          its winner · U undo · , . nudge 0.15s · space play/pause · keys go
          to the highlighted match
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500">
          fix the latest end&apos;s ball location:
        </span>
        {END_KINDS.map((e) => (
          <button
            key={e.value}
            type="button"
            onClick={() => onTag(e.value)}
            className="rounded-full border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            {e.label}
          </button>
        ))}
      </div>

      {labels.length > 0 ? (
        <div className="mt-3 max-h-40 overflow-y-auto rounded border border-zinc-800">
          <table className="w-full text-xs text-zinc-300">
            <tbody>
              {labels.map((l) => (
                <tr key={l.id} className="border-b border-zinc-800/60">
                  <td className="px-2 py-1 tabular-nums">
                    {Math.floor(l.t_s / 60)}:
                    {(l.t_s % 60).toFixed(2).padStart(5, "0")}
                  </td>
                  <td className="px-2 py-1">
                    {l.kind === "serve"
                      ? "serve start"
                      : l.kind === "let"
                        ? "let"
                        : "point end"}
                  </td>
                  <td className="px-2 py-1">{l.winner ?? ""}</td>
                  <td className="px-2 py-1 text-zinc-400">
                    {l.end_kind ?? ""}
                  </td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (ref.current) ref.current.currentTime = l.t_s;
                      }}
                      className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
                    >
                      go
                    </button>
                  </td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      onClick={() => onDelete(l.id)}
                      className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:border-amber-600 hover:text-amber-300"
                    >
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <textarea
        value={note}
        onChange={(e) => onNote(e.target.value)}
        rows={4}
        placeholder="What do you see? Where do serve and point boundaries actually live in this footage?"
        className="mt-4 w-full max-w-[960px] rounded-md border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-100 outline-none focus:border-cyan-500"
      />
      <p className="mt-1 h-4 text-xs text-zinc-500">
        {state === "saving"
          ? "saving…"
          : state === "saved"
            ? "saved"
            : state === "error"
              ? "could not save — check your connection"
              : ""}
      </p>
    </section>
  );
}

export function FullMatch({
  videos,
  initialNotes,
  initialLabels,
}: {
  videos: Record<string, string>;
  initialNotes: readonly FullMatchNote[];
  initialLabels: readonly FullMatchLabel[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [labels, setLabels] = useState<FullMatchLabel[]>([...initialLabels]);
  const [activeKey, setActiveKey] = useState<string>(KEYS[0]);

  const onMark = useCallback(
    async (
      key: string,
      kind: FullMatchLabel["kind"],
      winner: "me" | "opponent" | null,
      t: number,
      endKind: FullMatchLabel["end_kind"],
    ) => {
      const { data, error } = await supabase
        .from("fullmatch_labels")
        .insert({
          match_key: key,
          kind,
          t_s: Math.round(t * 100) / 100,
          winner,
          end_kind: endKind,
        })
        .select("id,match_key,kind,t_s,winner,end_kind")
        .single();
      if (!error && data) {
        setLabels((ls) =>
          [...ls, data as FullMatchLabel].sort((a, b) => a.t_s - b.t_s),
        );
      }
    },
    [supabase],
  );

  const onDelete = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("fullmatch_labels")
        .delete()
        .eq("id", id);
      if (!error) setLabels((ls) => ls.filter((l) => l.id !== id));
    },
    [supabase],
  );

  // Tag the most recent end mark with where the ball was last seen. A
  // separate keystroke rather than a field on the mark itself, so the
  // winner call stays a single reflex tap and the physics tag can follow
  // at leisure (or be corrected by pressing another letter).
  const onTag = useCallback(
    async (key: string, endKind: NonNullable<FullMatchLabel["end_kind"]>) => {
      const ends = labels.filter(
        (l) => l.match_key === key && l.kind === "end",
      );
      const last = ends[ends.length - 1];
      if (!last) return;
      const { error } = await supabase
        .from("fullmatch_labels")
        .update({ end_kind: endKind })
        .eq("id", last.id);
      if (!error) {
        setLabels((ls) =>
          ls.map((l) => (l.id === last.id ? { ...l, end_kind: endKind } : l)),
        );
      }
    },
    [supabase, labels],
  );
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialNotes.filter((n) => n.note).map((n) => [n.case_id, n.note ?? ""]),
    ),
  );
  const [state, setState] = useState<
    Record<string, "idle" | "saving" | "saved" | "error">
  >({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const save = useCallback(
    async (caseId: string, key: string, note: string) => {
      setState((s) => ({ ...s, [caseId]: "saving" }));
      const { error } = await supabase.from("sidecam_review_notes").upsert({
        case_id: caseId,
        match_key: key,
        t0_s: 0,
        t1_s: 0,
        category: "full match",
        note: note || null,
        updated_at: new Date().toISOString(),
      });
      setState((s) => ({ ...s, [caseId]: error ? "error" : "saved" }));
    },
    [supabase],
  );

  // Saves on a short debounce as he types — the standalone HTML pages lost
  // his notes twice, so nothing waits for a deliberate action.
  const onNote = useCallback(
    (key: string, v: string) => {
      const caseId = `${key}@full`;
      setNotes((n) => ({ ...n, [caseId]: v }));
      clearTimeout(timers.current[caseId]);
      timers.current[caseId] = setTimeout(() => {
        void save(caseId, key, v);
      }, 700);
    },
    [save],
  );

  const onTagWinner = useCallback(
    async (key: string, winner: "me" | "opponent") => {
      const ends = labels.filter(
        (l) => l.match_key === key && l.kind === "end",
      );
      const last = ends[ends.length - 1];
      if (!last) return;
      const { error } = await supabase
        .from("fullmatch_labels")
        .update({ winner })
        .eq("id", last.id);
      if (!error) {
        setLabels((ls) =>
          ls.map((l) => (l.id === last.id ? { ...l, winner } : l)),
        );
      }
    },
    [supabase, labels],
  );

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <h1 className="text-xl font-semibold text-zinc-100">
        Full-match signals
      </h1>
      <p className="mt-2 max-w-prose text-sm text-zinc-400">
        The whole Koko, Terry and Tripp videos, uncut, with everything the pipeline
        detected laid on a timeline. The top lane is what production ships
        today (blue, serve anchors in yellow). The lane under it is the new
        global segmentation (purple), which reads the whole match at once
        instead of judging one gap at a time. Your own marks run full height
        over both, so you can see where each lands: serve cyan, end orange,
        let blue. Then serve calls, net crossings, bounces (green on the
        table, red off it),
        rally-strength ball motion, and who is standing at each end. Sound is
        on — the bounce ticks are audible. The dashed cyan outline is the
        play prism: the region vertically above your table, and the only
        place ball motion counts as evidence now. The trail turns grey the
        moment the tracked ball leaves it — that grey is the neighbouring
        table being ignored. The question this page exists for: where do
        serve and point boundaries actually live in this footage, and what
        signal could find them.
      </p>
      <div className="mt-6 space-y-10">
        {KEYS.map((k) => (
          <MatchPanel
            key={k}
            dataUrl={`/research/fullmatch/${k}.json`}
            video={videos[k]}
            title={TITLES[k]}
            note={notes[`${k}@full`] ?? ""}
            onNote={(v) => onNote(k, v)}
            state={state[`${k}@full`] ?? "idle"}
            labels={labels.filter((l) => l.match_key === k)}
            onMark={(kind, winner, t, endKind) =>
              void onMark(k, kind, winner, t, endKind)
            }
            onDelete={(id) => void onDelete(id)}
            onTag={(endKind) => void onTag(k, endKind)}
            onTagWinner={(winner) => void onTagWinner(k, winner)}
            active={activeKey === k}
            onActivate={() => setActiveKey(k)}
          />
        ))}
      </div>
    </main>
  );
}
