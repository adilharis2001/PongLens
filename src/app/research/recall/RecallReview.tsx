"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";
import { RECALL_MATCHES, type RecallMatch, type RecallRegion } from "./data";
import { SCORABLE } from "./scorable";
import {
  KINDS,
  LANES,
  VERDICTS,
  decodeLane,
  filterRegions,
  formatClock,
  junkRate,
  kindMeta,
  totals,
  type Verdict,
} from "./recallView";

export interface RecallNote {
  readonly region_id: string;
  readonly match_id: string | null;
  readonly verdict: Verdict | null;
  readonly causes: string[];
  readonly note: string | null;
}

/** Ball track and table outline for one match, in CUT seconds. */
interface Overlay {
  quad: number[][] | null;
  net: number[][] | null;
  track: number[][];
  bounces: number[][];
  serves: number[];
}

const TICK = 0.1;
const LEAD_S = 2.0;
const TAIL_S = 1.5;
const TRAIL_S = 0.6;

const KIND_DOT: Record<string, string> = {
  no_serve: "rgb(251,191,36)",
  served: "rgb(34,211,238)",
  clipped: "rgb(232,121,249)",
  missing: "rgb(251,113,133)",
};

export function RecallReview({ initialNotes }: { initialNotes: RecallNote[] }) {
  const [kind, setKind] = useState<string>("no_serve");
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(true);
  const [regionId, setRegionId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Map<string, RecallNote>>(
    () => new Map(initialNotes.map((n) => [n.region_id, n])),
  );
  const [url, setUrl] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [showTable, setShowTable] = useState(true);
  const [showBall, setShowBall] = useState(true);
  const [showScorable, setShowScorable] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const stripRef = useRef<HTMLCanvasElement | null>(null);
  const railRef = useRef<HTMLCanvasElement | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const regionRef = useRef<RecallRegion | null>(null);
  const overlayDataRef = useRef<Overlay | null>(null);
  const drawFlags = useRef({ table: true, ball: true });
  drawFlags.current = { table: showTable, ball: showBall };

  /** Every region of every match in one list — the match is a label on the
   *  row, not a mode you have to switch into. */
  const all = useMemo(
    () =>
      RECALL_MATCHES.flatMap((m) =>
        m.regions.map((r) => ({ region: r, match: m })),
      ),
    [],
  );
  const done = useMemo(() => {
    const set = new Set<string>();
    notes.forEach((n, id) => {
      if (n.verdict) set.add(id);
    });
    return set;
  }, [notes]);
  const rows = useMemo(
    () =>
      all.filter(({ region }) =>
        filterRegions([region], { kind, onlyUnreviewed, done }).length > 0,
      ),
    [all, kind, onlyUnreviewed, done],
  );
  const current = useMemo(
    () => rows.find((r) => r.region.id === regionId) ?? rows[0] ?? null,
    [rows, regionId],
  );
  const region = current?.region ?? null;
  const match: RecallMatch | null = current?.match ?? null;
  const note = region ? notes.get(region.id) ?? null : null;
  const overall = useMemo(() => totals(RECALL_MATCHES), []);

  useEffect(() => {
    regionRef.current = region;
  }, [region]);
  useEffect(() => {
    overlayDataRef.current = overlay;
  }, [overlay]);

  // One signed URL and one overlay file per match, refetched when the
  // selected region belongs to a different match.
  useEffect(() => {
    if (!match) return;
    let cancelled = false;
    setUrl(null);
    setOverlay(null);
    setVideoState("loading");
    void (async () => {
      try {
        const res = await fetch("/api/media-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ matchId: match.matchId, preview: true }),
        });
        const data = (await res.json()) as { url?: string };
        if (cancelled) return;
        if (!data.url) throw new Error("no url");
        setUrl(data.url);
        setVideoState("idle");
      } catch {
        if (!cancelled) setVideoState("error");
      }
    })();
    void (async () => {
      try {
        const res = await fetch(`/research/recall/${match.key}.json`);
        const data = (await res.json()) as Overlay;
        if (!cancelled) setOverlay(data);
      } catch {
        if (!cancelled) setOverlay(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [match]);

  const play = useCallback((from: number, until: number | null) => {
    const video = videoRef.current;
    if (!video) return;
    stopAtRef.current = until;
    const go = () => {
      video.currentTime = Math.max(0, from);
      void video.play().catch(() => {});
    };
    if (video.readyState >= 1) go();
    else video.addEventListener("loadedmetadata", go, { once: true });
  }, []);

  const replay = useCallback(() => {
    if (!region || region.cutT0 === null) return;
    play(region.cutT0 - LEAD_S, (region.cutT1 ?? region.cutT0) + TAIL_S);
  }, [play, region]);

  useEffect(() => {
    if (!url || !region || region.cutT0 === null) return;
    play(region.cutT0 - LEAD_S, (region.cutT1 ?? region.cutT0) + TAIL_S);
  }, [url, region, play]);

  useEffect(() => {
    const video = videoRef.current;
    return () => video?.pause();
  }, [url]);

  // --- the table and the ball, drawn over the picture ---------------------
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = overlayRef.current;
      const video = videoRef.current;
      const data = overlayDataRef.current;
      if (!canvas || !video) return;
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const ch = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, cw, ch);
      if (!data) return;

      // the video is object-contain, so the picture is letterboxed inside
      // the canvas; draw into the picture, not the box
      const vw = video.videoWidth || 16;
      const vh = video.videoHeight || 9;
      const scale = Math.min(cw / vw, ch / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      const ox = (cw - dw) / 2;
      const oy = (ch - dh) / 2;
      const X = (n: number) => ox + n * dw;
      const Y = (n: number) => oy + n * dh;

      if (drawFlags.current.table && data.quad) {
        ctx.lineWidth = 2 * dpr;
        ctx.strokeStyle = "rgba(52,211,153,0.9)";
        ctx.beginPath();
        data.quad.forEach((p, i) =>
          i === 0 ? ctx.moveTo(X(p[0]), Y(p[1])) : ctx.lineTo(X(p[0]), Y(p[1])),
        );
        ctx.closePath();
        ctx.stroke();
        for (const p of data.quad) {
          ctx.beginPath();
          ctx.arc(X(p[0]), Y(p[1]), 4 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(52,211,153,0.95)";
          ctx.fill();
        }
        if (data.net) {
          ctx.setLineDash([6 * dpr, 5 * dpr]);
          ctx.strokeStyle = "rgba(52,211,153,0.65)";
          ctx.beginPath();
          ctx.moveTo(X(data.net[0][0]), Y(data.net[0][1]));
          ctx.lineTo(X(data.net[1][0]), Y(data.net[1][1]));
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      if (drawFlags.current.ball && data.track.length) {
        const t = video.currentTime;
        // binary search to the trail window; the track has ~20k points
        let lo = 0;
        let hi = data.track.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (data.track[mid][0] < t - TRAIL_S) lo = mid + 1;
          else hi = mid;
        }
        for (let i = lo; i < data.track.length; i += 1) {
          const [ts, nx, ny] = data.track[i];
          if (ts > t + 0.04) break;
          const age = t - ts;
          const fade = 1 - Math.max(0, age) / TRAIL_S;
          ctx.beginPath();
          ctx.arc(X(nx), Y(ny), (2 + 4 * fade) * dpr, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(34,211,238,${0.25 + 0.65 * fade})`;
          ctx.fill();
        }
        for (const [ts, nx, ny] of data.bounces) {
          const age = t - ts;
          if (age < -0.04 || age > 1.0) continue;
          ctx.beginPath();
          ctx.arc(X(nx), Y(ny), 9 * dpr, 0, Math.PI * 2);
          ctx.lineWidth = 2 * dpr;
          ctx.strokeStyle = "rgba(251,191,36,0.9)";
          ctx.stroke();
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // --- the whole-match rail: click anywhere to go there --------------------
  const railSeek = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const video = videoRef.current;
      const canvas = railRef.current;
      if (!video || !canvas || !video.duration) return;
      const rect = canvas.getBoundingClientRect();
      const frac = (event.clientX - rect.left) / rect.width;
      stopAtRef.current = null;
      video.currentTime = Math.max(0, Math.min(1, frac)) * video.duration;
      void video.play().catch(() => {});
    },
    [],
  );

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = railRef.current;
      const video = videoRef.current;
      if (!canvas || !video || !match) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dur = video.duration || match.duration;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(0, 0, w, h);
      for (const r of match.regions) {
        if (r.cutT0 === null || r.cutT1 === null) continue;
        const x0 = (r.cutT0 / dur) * w;
        const x1 = (r.cutT1 / dur) * w;
        ctx.fillStyle = r.junk
          ? "rgba(113,113,122,0.55)"
          : KIND_DOT[r.kind] ?? "rgba(255,255,255,0.6)";
        ctx.fillRect(x0, h * 0.22, Math.max(1.5 * dpr, x1 - x0), h * 0.56);
      }
      const cur = regionRef.current;
      if (cur && cur.cutT0 !== null && cur.cutT1 !== null) {
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeRect((cur.cutT0 / dur) * w - 1, 1,
                       Math.max(3, ((cur.cutT1 - cur.cutT0) / dur) * w + 2),
                       h - 2);
      }
      const x = (video.currentTime / dur) * w;
      ctx.fillStyle = "rgb(255,255,255)";
      ctx.fillRect(x - dpr, 0, 2 * dpr, h);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [match]);

  // --- the close-up evidence strip ----------------------------------------
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = stripRef.current;
      const r = regionRef.current;
      if (!canvas || !r) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      const lanes = LANES.map((l) => decodeLane(r.lanes[l.key] ?? ""));
      const ticks = lanes.reduce((n, l) => Math.max(n, l.length), 0);
      if (ticks === 0) return;
      const span = ticks * TICK;
      const xOf = (s: number) => ((s - r.laneStart) / span) * w;
      const barH = Math.max(3 * dpr, h * 0.07);
      const laneH = (h - barH * 2.6) / LANES.length;

      lanes.forEach((values, i) => {
        const y = i * laneH;
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        ctx.fillRect(0, y + laneH * 0.2, w, laneH * 0.6);
        ctx.fillStyle = LANES[i].colour;
        let j = 0;
        while (j < values.length) {
          if (!values[j]) {
            j += 1;
            continue;
          }
          let k = j;
          while (k + 1 < values.length && values[k + 1]) k += 1;
          ctx.globalAlpha = 0.85;
          ctx.fillRect((j / ticks) * w, y + laneH * 0.2,
                       Math.max(1, ((k + 1 - j) / ticks) * w), laneH * 0.6);
          ctx.globalAlpha = 1;
          j = k + 1;
        }
      });
      for (const [pa, pb] of r.prod) {
        ctx.fillStyle = "rgba(250,204,21,0.85)";
        ctx.fillRect(xOf(pa), h - barH, Math.max(2, xOf(pb) - xOf(pa)), barH);
      }
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(xOf(r.t0), h - barH * 2.3,
                   Math.max(2, xOf(r.t1) - xOf(r.t0)), barH);
      if (r.serve !== null) {
        ctx.strokeStyle = "rgb(244,114,182)";
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(xOf(r.serve), 0);
        ctx.lineTo(xOf(r.serve), h);
        ctx.stroke();
      }
      for (const t of r.taps) {
        ctx.strokeStyle = "rgb(52,211,153)";
        ctx.lineWidth = 2 * dpr;
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.moveTo(xOf(t), 0);
        ctx.lineTo(xOf(t), h);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const video = videoRef.current;
      if (video && r.cutT0 !== null) {
        const x = xOf(r.t0 + (video.currentTime - r.cutT0));
        if (x >= 0 && x <= w) {
          ctx.strokeStyle = "rgba(255,255,255,0.95)";
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const supabase = createClient();
  const save = useCallback(
    async (row: RecallRegion, matchId: string, verdict: Verdict | null) => {
      const prev = notes.get(row.id) ?? {
        region_id: row.id,
        match_id: matchId,
        verdict: null,
        causes: [],
        note: null,
      };
      setNotes((map) => new Map(map).set(row.id, { ...prev, verdict }));
      const { error } = await supabase.from("recall_review_notes").upsert({
        region_id: row.id,
        match_id: matchId,
        verdict,
        causes: [],
        note: null,
        updated_at: new Date().toISOString(),
      });
      if (error) setNotes((map) => new Map(map).set(row.id, prev));
    },
    [notes, supabase],
  );

  const step = useCallback(
    (delta: number) => {
      const at = rows.findIndex((r) => r.region.id === region?.id);
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + delta))];
      if (next) setRegionId(next.region.id);
    },
    [rows, region],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const cur = regionRef.current;
      const n = Number(event.key);
      if (cur && match && Number.isInteger(n) && n >= 1 && n <= VERDICTS.length) {
        event.preventDefault();
        void save(cur, match.matchId, VERDICTS[n - 1].value);
        if (!onlyUnreviewed) step(1);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        step(1);
      } else if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        step(-1);
      } else if (event.key === " ") {
        event.preventDefault();
        replay();
      } else if (event.key === "t") {
        setShowTable((v) => !v);
      } else if (event.key === "b") {
        setShowBall((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, step, replay, onlyUnreviewed, match]);

  const meta = kindMeta(region?.kind ?? kind);
  const reviewed = rows.filter((r) => notes.get(r.region.id)?.verdict).length;

  return (
    <main className="bg-arena h-screen overflow-hidden text-zinc-100">
      <header className="flex items-center gap-5 border-b border-edge px-5 py-2">
        <Logo href="/research" />
        <div className="flex gap-5 text-sm">
          <Stat label="recall" value={`${overall.recall.toFixed(1)}%`} accent />
          <Stat label="lost" value={`${overall.lost}`} />
          <Stat label="junk" value={`${overall.junkRate.toFixed(0)}%`} />
          <Stat
            label="serve cards junk"
            value={`${overall.servedJunk}/${overall.servedCards}`}
          />
          <Stat
            label="guesswork junk"
            value={`${overall.fallbackJunk}/${overall.fallbackCards}`}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Toggle on={showTable} onClick={() => setShowTable((v) => !v)}>
            table (t)
          </Toggle>
          <Toggle on={showBall} onClick={() => setShowBall((v) => !v)}>
            ball (b)
          </Toggle>
          <button
            type="button"
            onClick={() => setShowScorable((v) => !v)}
            className="rounded-full border border-cyan-glow/60 bg-cyan-500/15 px-3 py-1 text-xs text-cyan-100"
          >
            score a match
          </button>
        </div>
      </header>

      {showScorable && (
        <div className="border-b border-edge bg-ink/60 px-5 py-3">
          <p className="text-sm text-zinc-300">
            The new pipeline&apos;s points, opened in the real scorekeeper —
            same keys, same overlay, same everything. They reuse each
            match&apos;s existing cut video, so nothing was re-encoded, and
            they carry no per-point clips.
          </p>
          <p className="mt-1 text-xs text-amber-200/80">
            Don&apos;t delete these from the app: they share a cut file with
            the real match, and the delete would subtract it from storage.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {SCORABLE.map((m) => (
              <a
                key={m.id}
                href={`/match/${m.id}`}
                className="rounded-xl border border-edge px-3 py-2 text-sm transition-colors hover:border-zinc-500 hover:bg-white/5"
              >
                <div className="font-medium text-white">{m.name}</div>
                <div className="tabular-nums text-xs text-zinc-500">
                  {m.points} points ({m.served} on a serve) · production{" "}
                  {m.productionCards} · you kept {m.realRallies}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="flex h-[calc(100vh-45px)]">
        <div className="flex min-w-0 flex-1 flex-col p-3">
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-edge bg-black">
            {url ? (
              <>
                <video
                  ref={videoRef}
                  src={url}
                  controls
                  playsInline
                  preload="metadata"
                  className="absolute inset-0 h-full w-full object-contain"
                  onTimeUpdate={(event) => {
                    const stop = stopAtRef.current;
                    if (stop !== null && event.currentTarget.currentTime >= stop) {
                      event.currentTarget.pause();
                      stopAtRef.current = null;
                    }
                  }}
                />
                <canvas
                  ref={overlayRef}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                />
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
                {videoState === "error" ? "Video unavailable." : "Loading…"}
              </div>
            )}
          </div>

          <canvas
            ref={railRef}
            onClick={railSeek}
            title="Click anywhere to jump there in the match"
            className="mt-2 h-7 w-full shrink-0 cursor-pointer rounded border border-edge bg-ink/60"
          />
          <canvas
            ref={stripRef}
            className="mt-1.5 h-16 w-full shrink-0 rounded border border-edge bg-ink/60"
          />
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
            {LANES.map((l) => (
              <Swatch key={l.key} colour={l.colour} label={l.label} />
            ))}
            <Swatch colour="rgb(255,255,255)" label="proposed" />
            <Swatch colour="rgb(250,204,21)" label="card today" />
            <Swatch colour="rgb(52,211,153)" label="your serve tap" />
          </div>

          {region && match && (
            <div className="mt-2.5 shrink-0">
              <div className="flex flex-wrap items-baseline gap-3">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${meta.tone}`}
                >
                  {meta.label}
                </span>
                <span className="text-lg font-semibold text-white">
                  {meta.question}
                </span>
                <span className="tabular-nums text-xs text-zinc-500">
                  {match.opponent ?? match.key} · {formatClock(region.t0)}–
                  {formatClock(region.t1)}
                  {region.serve !== null &&
                    ` · serve ${region.serve.toFixed(1)}s`}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {VERDICTS.map((v, i) => (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => void save(region, match.matchId, v.value)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      note?.verdict === v.value
                        ? "border-cyan-glow/60 bg-cyan-500/15 text-cyan-100"
                        : "border-edge text-zinc-300 hover:border-zinc-500"
                    }`}
                  >
                    <span className="mr-1.5 text-zinc-600">{i + 1}</span>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="flex w-80 shrink-0 flex-col border-l border-edge">
          <div className="flex flex-wrap gap-1.5 border-b border-edge p-2.5">
            {KINDS.map((k) => {
              const n = all.filter((r) => r.region.kind === k.value).length;
              if (n === 0) return null;
              return (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => {
                    setKind(k.value);
                    setRegionId(null);
                  }}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    kind === k.value
                      ? k.tone
                      : "border-edge text-zinc-400 hover:border-zinc-500"
                  }`}
                >
                  {k.label} <span className="text-zinc-600">{n}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setOnlyUnreviewed((v) => !v)}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                onlyUnreviewed
                  ? "border-cyan-glow/60 bg-cyan-500/15 text-cyan-100"
                  : "border-edge text-zinc-400"
              }`}
            >
              hide done
            </button>
          </div>
          <div className="px-3 py-1.5 text-xs text-zinc-500">
            {rows.length} left, {reviewed} done · 1–4 answer, ↑↓ move, space
            replays, t/b overlays
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rows.map(({ region: r, match: m }) => {
              const v = notes.get(r.id)?.verdict;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRegionId(r.id)}
                  className={`flex w-full items-center gap-2 border-b border-edge/60 px-3 py-1.5 text-left text-sm transition-colors hover:bg-white/5 ${
                    region?.id === r.id ? "bg-cyan-500/10" : ""
                  }`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: KIND_DOT[r.kind] }}
                  />
                  <span className="w-14 shrink-0 truncate text-xs text-zinc-500">
                    {(m.opponent ?? m.key).split(" ")[0]}
                  </span>
                  <span className="tabular-nums text-zinc-400">
                    {formatClock(r.t0)}
                  </span>
                  <span className="tabular-nums text-xs text-zinc-600">
                    {(r.t1 - r.t0).toFixed(1)}s
                  </span>
                  {r.junk && <span className="text-xs text-zinc-600">junk</span>}
                  {v && (
                    <span
                      className={`ml-auto ${
                        v === "point_whole"
                          ? "text-emerald-300"
                          : v === "junk"
                            ? "text-zinc-400"
                            : "text-amber-300"
                      }`}
                    >
                      ●
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="border-t border-edge px-3 py-2 text-[11px] leading-4 text-zinc-500">
            {meta.hint}
            {match && (
              <div className="mt-1.5 tabular-nums text-zinc-600">
                {match.opponent ?? match.key}: {match.rallies} rallies,{" "}
                {match.cards} cards, junk{" "}
                {junkRate(match.cards, match.junk).toFixed(0)}%
                {match.serveTaps > 0 &&
                  `, serves ${match.serveTapsFound}/${match.serveTaps}`}
                {!match.calibrated && " · no table found"}
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <span
        className={`tabular-nums font-semibold ${accent ? "text-cyan-glow" : "text-white"}`}
      >
        {value}
      </span>
    </span>
  );
}

function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        on
          ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-100"
          : "border-edge text-zinc-400 hover:border-zinc-500"
      }`}
    >
      {children}
    </button>
  );
}

function Swatch({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: colour }} />
      {label}
    </span>
  );
}
