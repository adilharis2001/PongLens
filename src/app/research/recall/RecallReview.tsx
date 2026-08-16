"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";
import { RECALL_MATCHES, type RecallRegion } from "./data";
import {
  KINDS,
  LANES,
  VERDICTS,
  decodeLane,
  efficiencyGain,
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

const TICK = 0.1;
const LEAD_S = 2.0;
const TAIL_S = 1.5;

export function RecallReview({ initialNotes }: { initialNotes: RecallNote[] }) {
  const [matchKey, setMatchKey] = useState(RECALL_MATCHES[0]?.key ?? "");
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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stripRef = useRef<HTMLCanvasElement | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const regionRef = useRef<RecallRegion | null>(null);

  const match = useMemo(
    () => RECALL_MATCHES.find((m) => m.key === matchKey) ?? RECALL_MATCHES[0],
    [matchKey],
  );
  const done = useMemo(() => {
    const set = new Set<string>();
    notes.forEach((n, id) => {
      if (n.verdict) set.add(id);
    });
    return set;
  }, [notes]);
  const rows = useMemo(
    () => filterRegions(match?.regions ?? [], { kind, onlyUnreviewed, done }),
    [match, kind, onlyUnreviewed, done],
  );
  const region = useMemo(
    () => rows.find((r) => r.id === regionId) ?? rows[0] ?? null,
    [rows, regionId],
  );
  const note = region ? notes.get(region.id) ?? null : null;
  const overall = useMemo(() => totals(RECALL_MATCHES), []);

  useEffect(() => {
    regionRef.current = region;
  }, [region]);

  useEffect(() => {
    if (!match) return;
    let cancelled = false;
    setUrl(null);
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
    return () => {
      cancelled = true;
    };
  }, [match]);

  const play = useCallback((from: number, until: number) => {
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

  // The evidence strip: one lane per detector, the proposed card in white,
  // today's card in yellow, the owner's own serve taps as green ticks.
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
      const barH = Math.max(3 * dpr, h * 0.06);
      const laneArea = h - barH * 2.6;
      const laneH = laneArea / LANES.length;

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
  }, [region]);

  const supabase = createClient();
  const save = useCallback(
    async (row: RecallRegion, verdict: Verdict | null) => {
      const prev = notes.get(row.id) ?? {
        region_id: row.id,
        match_id: match?.matchId ?? null,
        verdict: null,
        causes: [],
        note: null,
      };
      const next = { ...prev, verdict };
      setNotes((map) => new Map(map).set(row.id, next));
      const { error } = await supabase.from("recall_review_notes").upsert({
        region_id: row.id,
        match_id: match?.matchId ?? null,
        verdict,
        causes: [],
        note: null,
        updated_at: new Date().toISOString(),
      });
      if (error) setNotes((map) => new Map(map).set(row.id, prev));
    },
    [notes, supabase, match],
  );

  const step = useCallback(
    (delta: number) => {
      const at = rows.findIndex((r) => r.id === region?.id);
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + delta))];
      if (next) setRegionId(next.id);
    },
    [rows, region],
  );

  // 1-4 answer and advance; arrows move; space replays.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      const current = regionRef.current;
      if (!current) return;
      const n = Number(event.key);
      if (Number.isInteger(n) && n >= 1 && n <= VERDICTS.length) {
        event.preventDefault();
        void save(current, VERDICTS[n - 1].value);
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, step, replay, onlyUnreviewed]);

  if (!match) return null;
  const meta = kindMeta(region?.kind ?? kind);
  const reviewed = rows.filter((r) => notes.get(r.id)?.verdict).length;

  return (
    <main className="bg-arena h-screen overflow-hidden text-zinc-100">
      <header className="flex items-center gap-6 border-b border-edge px-5 py-2.5">
        <Logo href="/research" />
        <select
          value={matchKey}
          onChange={(event) => {
            setMatchKey(event.target.value);
            setRegionId(null);
          }}
          className="rounded-lg border border-edge bg-ink/60 px-3 py-1.5 text-sm"
        >
          {RECALL_MATCHES.map((m) => (
            <option key={m.key} value={m.key}>
              {m.opponent ?? m.key} · {m.venue ?? "—"}
              {m.calibrated ? "" : " · no table"}
            </option>
          ))}
        </select>
        <div className="flex gap-5 text-sm">
          <Stat
            label="recall"
            value={match.curated ? `${(100 * match.recall).toFixed(1)}%` : "—"}
            accent
          />
          <Stat
            label="junk"
            value={`${junkRate(match.cards, match.junk).toFixed(0)}%`}
          />
          <Stat
            label="vs today"
            value={`${efficiencyGain(match) >= 0 ? "+" : ""}${efficiencyGain(match).toFixed(0)} pts`}
          />
          <Stat label="cards" value={`${match.cards}`} />
          <Stat
            label="serves found"
            value={
              match.serveTaps
                ? `${match.serveTapsFound}/${match.serveTaps}`
                : "—"
            }
          />
        </div>
        <span className="ml-auto text-xs text-zinc-500">
          {overall.curatedMatches} scored matches · {overall.rallies} rallies ·{" "}
          {overall.lost} lost · served cards {overall.servedJunk}/
          {overall.servedCards} junk vs fallback {overall.fallbackJunk}/
          {overall.fallbackCards}
        </span>
      </header>

      <div className="flex h-[calc(100vh-49px)]">
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-edge bg-black">
            {url ? (
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
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
                {videoState === "error" ? "Video unavailable." : "Loading…"}
              </div>
            )}
          </div>

          <canvas
            ref={stripRef}
            className="mt-2 h-20 w-full shrink-0 rounded-lg border border-edge bg-ink/60"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
            {LANES.map((l) => (
              <Swatch key={l.key} colour={l.colour} label={l.label} />
            ))}
            <Swatch colour="rgb(255,255,255)" label="proposed card" />
            <Swatch colour="rgb(250,204,21)" label="card today" />
            <Swatch colour="rgb(52,211,153)" label="your serve tap" />
          </div>

          {region && (
            <div className="mt-3 shrink-0">
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
                  {formatClock(region.t0)}–{formatClock(region.t1)}
                  {region.serve !== null &&
                    ` · serve at ${region.serve.toFixed(1)}s`}
                  {region.coverage !== undefined &&
                    ` · covered ${(100 * region.coverage).toFixed(0)}%`}
                </span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {VERDICTS.map((v, i) => (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => void save(region, v.value)}
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
          <div className="flex flex-wrap gap-1.5 border-b border-edge p-3">
            {KINDS.map((k) => {
              const n = match.regions.filter((r) => r.kind === k.value).length;
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
          <div className="px-3 py-2 text-xs text-zinc-500">
            {rows.length} left, {reviewed} done · 1–4 answer, ↑↓ move, space
            replays
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rows.map((r) => {
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
                  <span className="tabular-nums text-zinc-400">
                    {formatClock(r.t0)}
                  </span>
                  <span className="tabular-nums text-xs text-zinc-600">
                    {(r.t1 - r.t0).toFixed(1)}s
                  </span>
                  {r.junk && <span className="text-xs text-zinc-600">junk</span>}
                  {r.cutT0 === null && (
                    <span className="text-xs text-amber-300">cut out</span>
                  )}
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
          <p className="border-t border-edge px-3 py-2 text-[11px] leading-4 text-zinc-500">
            {meta.hint}
          </p>
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

function Swatch({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="h-2 w-2 rounded-sm"
        style={{ backgroundColor: colour }}
      />
      {label}
    </span>
  );
}
