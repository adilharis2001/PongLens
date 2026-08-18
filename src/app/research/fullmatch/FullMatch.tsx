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
  presence: number[][]; // [t, near, far]
}

const KEYS = ["koko", "terry"] as const;
const TITLES: Record<string, string> = { koko: "Koko", terry: "Terry" };
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
function drawZoom(cv: HTMLCanvasElement, d: FullData, t: number) {
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
    ["cards", 6],
    ["serves", 34],
    ["cross", 54],
    ["bounce", 74],
    ["ball", 94],
    ["near", 110],
    ["far", 126],
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
  // serve calls
  ctx.fillStyle = "#ffdc00";
  for (const s of d.serves)
    if (s >= t0 && s <= t0 + ZOOM_S) ctx.fillRect(X(s) - 1, 34, 2, 16);
  // crossings
  ctx.fillStyle = "#ffb43c";
  for (const s of d.crossings)
    if (s >= t0 && s <= t0 + ZOOM_S) ctx.fillRect(X(s), 54, 1.5, 16);
  // bounces
  for (const p of d.bounces) {
    if (p[0] < t0 || p[0] > t0 + ZOOM_S) continue;
    ctx.fillStyle = p[3] ? "#50ff78" : "#ff5050";
    ctx.fillRect(X(p[0]) - 1, 74, 2.5, 14);
  }
  // dense ball motion
  ctx.fillStyle = "rgba(120,200,255,0.5)";
  for (const [a, b] of d.dense) {
    if (b < t0 || a > t0 + ZOOM_S) continue;
    ctx.fillRect(X(a), 94, X(b) - X(a), 10);
  }
  // presence
  for (const [pt, nearOn, farOn] of d.presence) {
    if (pt < t0 || pt > t0 + ZOOM_S) continue;
    if (nearOn) {
      ctx.fillStyle = "rgba(120,255,160,0.6)";
      ctx.fillRect(X(pt), 110, 2, 10);
    }
    if (farOn) {
      ctx.fillStyle = "rgba(255,120,220,0.6)";
      ctx.fillRect(X(pt), 126, 2, 10);
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
    ctx.fillRect(X(a as number), 4, Math.max(1, X(b as number) - X(a as number)), 10);
  ctx.fillStyle = "#ffdc00";
  for (const s of d.serves) ctx.fillRect(X(s), 4, 1.5, 10);
}

function MatchPanel({
  dataUrl,
  video,
  title,
  note,
  onNote,
  state,
}: {
  dataUrl: string;
  video: string;
  title: string;
  note: string;
  onNote: (v: string) => void;
  state: "idle" | "saving" | "saved" | "error";
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
        if (d && zoomRef.current) drawZoom(zoomRef.current, d, v.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [d]);

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
    <section className="rounded-lg border-l-4 border-zinc-500 bg-zinc-900/60 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
        {d ? (
          <span className="text-xs text-zinc-400">
            {d.serves.length} serves · {d.cards.length} cards ·{" "}
            {d.crossings.length} crossings · {d.bounces.length} bounces
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
        height={140}
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
}: {
  videos: Record<string, string>;
  initialNotes: readonly FullMatchNote[];
}) {
  const supabase = useMemo(() => createClient(), []);
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

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <h1 className="text-xl font-semibold text-zinc-100">
        Full-match signals
      </h1>
      <p className="mt-2 max-w-prose text-sm text-zinc-400">
        The whole Koko and Terry videos, uncut, with everything the pipeline
        detected laid on a timeline: cards (blue, serve anchors in yellow),
        serve calls, net crossings, bounces (green on the table, red off it),
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
          />
        ))}
      </div>
    </main>
  );
}
