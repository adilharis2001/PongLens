"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SIDECAM_CASES, type SidecamCase } from "./data";

export interface SidecamNote {
  readonly case_id: string;
  readonly verdict: string | null;
  readonly note: string | null;
}

type Verdict = "real_point" | "not_a_point" | "unsure";

const VERDICTS: readonly { key: Verdict; label: string }[] = [
  { key: "real_point", label: "Real point" },
  { key: "not_a_point", label: "Not a point" },
  { key: "unsure", label: "Can't tell" },
];

const RATES = [0.15, 0.25, 0.5, 1] as const;

/** How long a bounce marker stays on screen after it happens, in seconds. */
const BOUNCE_HOLD = 1.2;
const TRAIL_S = 0.7;

function Overlay({
  c,
  t,
  show,
}: {
  c: SidecamCase;
  t: number;
  show: boolean;
}) {
  if (!show) return null;
  const trail = c.track.filter((p) => p[0] <= t && p[0] > t - TRAIL_S);
  const head = trail.length ? trail[trail.length - 1] : null;
  return (
    <svg
      viewBox={`0 0 ${c.w} ${c.h}`}
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <polygon
        points={c.quad.map((p) => p.join(",")).join(" ")}
        fill="none"
        stroke="rgba(255,255,255,0.85)"
        strokeWidth={2}
      />
      <line
        x1={c.net[0][0]}
        y1={c.net[0][1]}
        x2={c.net[1][0]}
        y2={c.net[1][1]}
        stroke="#ff3ca0"
        strokeWidth={2}
      />
      {trail.map((p, i) => (
        <circle
          key={i}
          cx={p[1]}
          cy={p[2]}
          r={3}
          fill="#78c8ff"
          opacity={Math.max(0.1, 1 - (t - p[0]) / TRAIL_S)}
        />
      ))}
      {head ? (
        <circle
          cx={head[1]}
          cy={head[2]}
          r={5}
          fill="#fff"
          stroke="#0096ff"
          strokeWidth={2}
        />
      ) : null}
      {c.bounces.map((b, i) => {
        const age = t - b.at;
        if (age < -0.05 || age > BOUNCE_HOLD) return null;
        const fade = Math.max(0, 1 - age / BOUNCE_HOLD);
        return (
          <circle
            key={i}
            cx={b.x}
            cy={b.y}
            r={5}
            fill={b.onTable ? "#50ff78" : "#ff5050"}
            opacity={fade}
          />
        );
      })}
    </svg>
  );
}

function Case({
  c,
  note,
  verdict,
  onNote,
  onVerdict,
  state,
}: {
  c: SidecamCase;
  note: string;
  verdict: Verdict | null;
  onNote: (v: string) => void;
  onVerdict: (v: Verdict) => void;
  state: "idle" | "saving" | "saved" | "error";
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [t, setT] = useState(0);
  const [show, setShow] = useState(true);
  const [rate, setRate] = useState<number>(0.25);

  // The overlay needs a frame-rate clock, and timeupdate only fires four or
  // five times a second — enough for a progress bar, far too coarse for a
  // ball that crosses the table in under half of one.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = ref.current;
      if (v) setT(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate;
  }, [rate]);

  return (
    <section
      className={`rounded-lg border-l-4 bg-zinc-900/60 p-4 ${
        c.lost ? "border-rose-500" : "border-zinc-500"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-zinc-100">
          {c.opponent} · {c.t0S.toFixed(0)}s–{c.t1S.toFixed(0)}s
        </h3>
        <span className="text-xs text-zinc-400">{c.category}</span>
      </div>
      <p className="mt-1 text-xs text-zinc-300">{c.pipeline}</p>
      <p className="mt-1 text-xs text-zinc-400">
        ball tracked {Math.round(c.trackCover * 100)}% of the window ·{" "}
        {c.nBounceOn} bounce{c.nBounceOn === 1 ? "" : "s"} on the table,{" "}
        {c.nBounceOff} off it · {c.nCross} net crossing
        {c.nCross === 1 ? "" : "s"}
      </p>

      <div className="relative mt-3 w-full max-w-[640px]">
        <video
          ref={ref}
          src={c.clip}
          loop
          muted
          playsInline
          controls
          className="block w-full rounded"
          onLoadedMetadata={(e) => {
            e.currentTarget.playbackRate = rate;
          }}
        />
        <Overlay c={c} t={t} show={show} />
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
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {VERDICTS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => onVerdict(v.key)}
            className={`rounded-full border px-3 py-1 text-sm ${
              verdict === v.key
                ? "border-cyan-400 bg-cyan-400/10 text-cyan-200"
                : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <textarea
        value={note}
        onChange={(e) => onNote(e.target.value)}
        rows={3}
        placeholder="What is actually happening here? What can you see that the markers miss?"
        className="mt-3 w-full max-w-[640px] rounded-md border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-100 outline-none focus:border-cyan-500"
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

export function SidecamReview({
  initialNotes,
}: {
  initialNotes: readonly SidecamNote[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialNotes.filter((n) => n.note).map((n) => [n.case_id, n.note ?? ""]),
    ),
  );
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>(() =>
    Object.fromEntries(
      initialNotes
        .filter((n) => n.verdict)
        .map((n) => [n.case_id, n.verdict as Verdict]),
    ),
  );
  const [state, setState] = useState<
    Record<string, "idle" | "saving" | "saved" | "error">
  >({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const save = useCallback(
    async (c: SidecamCase, note: string, verdict: Verdict | null) => {
      setState((s) => ({ ...s, [c.id]: "saving" }));
      const { error } = await supabase.from("sidecam_review_notes").upsert({
        case_id: c.id,
        match_key: c.matchKey,
        t0_s: c.t0S,
        t1_s: c.t1S,
        category: c.category,
        verdict,
        note: note || null,
        updated_at: new Date().toISOString(),
      });
      setState((s) => ({ ...s, [c.id]: error ? "error" : "saved" }));
    },
    [supabase],
  );

  // Typing saves on a short debounce rather than on blur: the standalone
  // HTML version of this page lost his notes twice, so nothing here waits
  // for a deliberate action to reach the database.
  const onNote = useCallback(
    (c: SidecamCase, v: string) => {
      setNotes((n) => ({ ...n, [c.id]: v }));
      clearTimeout(timers.current[c.id]);
      timers.current[c.id] = setTimeout(() => {
        void save(c, v, verdicts[c.id] ?? null);
      }, 700);
    },
    [save, verdicts],
  );

  const onVerdict = useCallback(
    (c: SidecamCase, v: Verdict) => {
      setVerdicts((x) => ({ ...x, [c.id]: v }));
      void save(c, notes[c.id] ?? "", v);
    },
    [save, notes],
  );

  const done = SIDECAM_CASES.filter(
    (c) => (notes[c.id] ?? "").trim() || verdicts[c.id],
  ).length;

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <h1 className="text-xl font-semibold text-zinc-100">Side-on cameras</h1>
      <p className="mt-2 max-w-prose text-sm text-zinc-400">
        Koko and Terry were filmed almost from behind the near player, and
        Tripp is the same problem from last week. On these cameras the
        detector found no serves at all, so nothing could cut a run of play
        into separate points: no rally was lost, but consecutive rallies
        came out fused into single long cards, and you split eight of them
        by hand. Each case below shows the window with everything the
        pipeline saw: the table outline it used, the net line, the
        ball&apos;s track, and every bounce it detected — green on the
        table, red off it.
      </p>
      <p className="mt-2 max-w-prose text-sm text-zinc-400">
        Above each video is what the pipeline did with that window.
        Red-edged cases are the rallies you had to split out by hand.
        Everything you type saves itself to the database as you go.
      </p>
      <p className="mt-3 text-xs text-zinc-500">
        {done} of {SIDECAM_CASES.length} reviewed
      </p>

      <div className="mt-6 space-y-6">
        {SIDECAM_CASES.map((c) => (
          <Case
            key={c.id}
            c={c}
            note={notes[c.id] ?? ""}
            verdict={verdicts[c.id] ?? null}
            state={state[c.id] ?? "idle"}
            onNote={(v) => onNote(c, v)}
            onVerdict={(v) => onVerdict(c, v)}
          />
        ))}
      </div>
    </main>
  );
}
