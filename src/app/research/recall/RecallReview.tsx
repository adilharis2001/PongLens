"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";
import {
  RECALL_MATCHES,
  RECALL_SCORE_ESTIMATE,
  type RecallMatch,
  type RecallRegion,
} from "./data";
import {
  CAUSE_GROUPS,
  DISPUTED,
  KINDS,
  LANES,
  VERDICTS,
  decodeLane,
  filterRegions,
  formatClock,
  kindMeta,
  lowerBound95,
  missRate,
  recallFromMiss,
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
const LEAD_S = 2.0;   // seconds of run-up before a region starts
const TAIL_S = 1.5;   // and after it ends, so an ending can be judged

const KIND_TONE: Record<string, string> = {
  extra: "border-cyan-400/40 bg-cyan-500/10 text-cyan-200",
  drop: "border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-200",
  fused: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  gap: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
  card: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
  deficit: "border-rose-400/50 bg-rose-500/15 text-rose-200",
};

export function RecallReview({ initialNotes }: { initialNotes: RecallNote[] }) {
  const [matchKey, setMatchKey] = useState(RECALL_MATCHES[0]?.key ?? "");
  // Open on the disagreements. With every card reviewable a match can hold
  // 260 regions, and the ones worth a verdict first are the ones the two
  // systems do not agree about.
  const [kinds, setKinds] = useState<string[]>([...DISPUTED]);
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [regionId, setRegionId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Map<string, RecallNote>>(
    () => new Map(initialNotes.map((n) => [n.region_id, n])),
  );
  const [url, setUrl] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [noteDraft, setNoteDraft] = useState("");

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
    () => filterRegions(match?.regions ?? [], { kinds, onlyUnreviewed, done }),
    [match, kinds, onlyUnreviewed, done],
  );
  const region = useMemo(
    () => rows.find((r) => r.id === regionId) ?? rows[0] ?? null,
    [rows, regionId],
  );
  const note = region ? notes.get(region.id) ?? null : null;
  const overall = useMemo(() => totals(RECALL_MATCHES), []);
  const est = RECALL_SCORE_ESTIMATE;

  useEffect(() => {
    setNoteDraft(note?.note ?? "");
  }, [note?.region_id, note?.note]);

  useEffect(() => {
    regionRef.current = region;
  }, [region]);

  // One signed URL per match. The page plays the CUT video, which is what
  // /api/media-url serves; every region carries its own cut seconds.
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

  const playRegion = useCallback(() => {
    if (!region || region.cutT0 === null) return;
    play(region.cutT0 - LEAD_S, (region.cutT1 ?? region.cutT0) + TAIL_S);
  }, [play, region]);

  const playWide = useCallback(() => {
    if (!region || region.cutT0 === null) return;
    play(region.cutT0 - 6, (region.cutT1 ?? region.cutT0) + 4);
  }, [play, region]);

  const playEnding = useCallback(() => {
    if (!region || region.cutT1 === null) return;
    play(region.cutT1 - 2.5, region.cutT1 + TAIL_S + 1.5);
  }, [play, region]);

  useEffect(() => {
    if (!url || !region || region.cutT0 === null) return;
    play(region.cutT0 - LEAD_S, (region.cutT1 ?? region.cutT0) + TAIL_S);
  }, [url, region, play]);

  // A video removed from the document keeps playing with sound.
  useEffect(() => {
    const video = videoRef.current;
    return () => video?.pause();
  }, [url]);

  // The evidence strip: one lane per detector family over the region and a
  // few seconds either side, with the region bracketed and the playhead on
  // top. This is the page's answer to "why does the system think a point is
  // here" — a card with only the top lane lit is being held by player
  // movement alone.
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
      const xOf = (sourceSeconds: number) =>
        ((sourceSeconds - r.laneStart) / span) * w;
      const laneH = h / LANES.length;

      lanes.forEach((values, i) => {
        const y = i * laneH;
        ctx.fillStyle = "rgba(255,255,255,0.035)";
        ctx.fillRect(0, y + laneH * 0.18, w, laneH * 0.64);
        ctx.fillStyle = LANES[i].colour;
        let j = 0;
        while (j < values.length) {
          if (!values[j]) {
            j += 1;
            continue;
          }
          let k = j;
          while (k + 1 < values.length && values[k + 1]) k += 1;
          const x0 = (j / ticks) * w;
          const x1 = ((k + 1) / ticks) * w;
          ctx.globalAlpha = 0.85;
          ctx.fillRect(x0, y + laneH * 0.18, Math.max(1, x1 - x0), laneH * 0.64);
          ctx.globalAlpha = 1;
          j = k + 1;
        }
      });

      // Both boundaries, so the shift is visible rather than inferred:
      // production's cards as a bar along the bottom, the proposed one as
      // a bar above it with its edges carried up through the lanes.
      const barH = Math.max(3 * dpr, h * 0.05);
      for (const [pa, pb] of r.prod) {
        ctx.fillStyle = "rgba(250,204,21,0.85)";
        ctx.fillRect(xOf(pa), h - barH, Math.max(2, xOf(pb) - xOf(pa)), barH);
      }
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(xOf(r.t0), h - barH * 2.4,
                   Math.max(2, xOf(r.t1) - xOf(r.t0)), barH);
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1 * dpr;
      [r.t0, r.t1].forEach((t) => {
        ctx.beginPath();
        ctx.moveTo(xOf(t), 0);
        ctx.lineTo(xOf(t), h - barH * 2.4);
        ctx.stroke();
      });

      const video = videoRef.current;
      if (video && r.cutT0 !== null) {
        // inside one cut segment the two clocks run at the same rate, so the
        // region's own anchor is enough to place the playhead
        const sourceNow = r.t0 + (video.currentTime - r.cutT0);
        const x = xOf(sourceNow);
        if (x >= 0 && x <= w) {
          ctx.strokeStyle = "rgba(250,250,250,0.95)";
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
    async (row: RecallRegion, patch: Partial<RecallNote>) => {
      const prev = notes.get(row.id) ?? {
        region_id: row.id,
        match_id: match?.matchId ?? null,
        verdict: null,
        causes: [],
        note: null,
      };
      const next = { ...prev, ...patch };
      setNotes((map) => new Map(map).set(row.id, next));
      const { error } = await supabase.from("recall_review_notes").upsert({
        region_id: row.id,
        match_id: match?.matchId ?? null,
        verdict: next.verdict,
        causes: next.causes,
        note: next.note,
        updated_at: new Date().toISOString(),
      });
      if (error) setNotes((map) => new Map(map).set(row.id, prev));
    },
    [notes, supabase, match],
  );

  const toggleCause = useCallback(
    (row: RecallRegion, cause: string) => {
      const current = notes.get(row.id)?.causes ?? [];
      const causes = current.includes(cause)
        ? current.filter((c) => c !== cause)
        : [...current, cause];
      void save(row, { causes });
    },
    [notes, save],
  );

  // 1-5 set the verdict and move on, so a run of clips needs one hand.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const n = Number(event.key);
      if (!Number.isInteger(n) || n < 1 || n > VERDICTS.length) return;
      const current = regionRef.current;
      if (!current) return;
      event.preventDefault();
      void save(current, { verdict: VERDICTS[n - 1].value });
      const at = rows.findIndex((r) => r.id === current.id);
      const next = rows[at + 1];
      if (next) setRegionId(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, save]);

  const reviewed = rows.filter((r) => notes.get(r.id)?.verdict).length;
  const bound = lowerBound95(overall.kept, overall.rallies - overall.kept);

  if (!match) return null;

  return (
    <main className="bg-arena min-h-screen pb-24 text-zinc-100">
      <header className="mx-auto flex max-w-[1500px] items-center px-6 py-6">
        <Logo href="/research" />
      </header>

      <div className="mx-auto max-w-[1500px] px-6">
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Point recall
        </h1>

        <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge bg-edge sm:grid-cols-3 lg:grid-cols-6">
          {[
            [
              "Matches",
              `${overall.curatedMatches} of ${overall.matches} scored`,
              false,
            ],
            ["Real rallies", String(overall.rallies), false],
            ["Rallies kept", `${overall.recall.toFixed(1)}%`, true],
            [
              "Recall, from the score",
              `${recallFromMiss(est.missing, est.points).toFixed(1)}%`,
              true,
            ],
            [
              "Cards",
              `${overall.labCards} vs ${overall.productionCards}`,
              false,
            ],
            ["To review", String(overall.regions), false],
          ].map(([label, value, accent]) => (
            <div key={label as string} className="bg-ink/60 px-4 py-3">
              <div className="text-xs uppercase tracking-wider text-zinc-500">
                {label as string}
              </div>
              <div
                className={`mt-1 text-2xl font-semibold ${
                  accent ? "text-cyan-glow" : "text-white"
                }`}
              >
                {value as string}
              </div>
            </div>
          ))}
        </div>

        <h2 className="mt-12 text-xl font-semibold text-white">
          What your own scoring already proves
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
          A game ends at 11 with two clear. When a card is missing the score
          comes up short and you have to close the game by hand, so counting
          the games you pinned shut measures lost points with no labelling at
          all. Across {est.games} fully-scored games ({est.points} points)
          that comes to {est.missing} missing, a miss rate of{" "}
          {missRate(est.missing, est.points).toFixed(2)}%. It is a floor, not
          an estimate: a point whose absence the final score absorbs leaves no
          trace here.
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-edge">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-xs uppercase tracking-wider text-zinc-500">
              <tr className="border-b border-edge">
                <th className="px-4 py-3 text-left font-medium">Match</th>
                <th className="px-4 py-3 text-left font-medium">Venue</th>
                <th className="px-4 py-3 text-right font-medium">Game</th>
                <th className="px-4 py-3 text-right font-medium">Points</th>
                <th className="px-4 py-3 text-right font-medium">Short by</th>
                <th className="px-4 py-3 text-left font-medium">Window</th>
              </tr>
            </thead>
            <tbody>
              {est.deficits.map((d) => (
                <tr
                  key={`${d.matchId}-${d.t0}`}
                  className="border-b border-edge/60 last:border-0"
                >
                  <td className="px-4 py-2.5 font-medium text-white">
                    {d.name}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400">
                    {d.venue ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-300">
                    {d.score}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-400">
                    {d.points}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-amber-200">
                    {d.shortBy}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-zinc-500">
                    {formatClock(d.t0)}–{formatClock(d.t1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="mt-12 text-xl font-semibold text-white">
          The matches run end to end
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
          Each one re-run from its original upload, not from the cut, because
          a rally dropped before the cut was built is not in the cut to be
          found. Production&apos;s own recall is 100% by construction — its
          cards are the labels — so the comparison to read is the card counts
          and what the clips actually contain. Keeping{" "}
          {overall.kept} of {overall.rallies} rallies bounds true recall at{" "}
          {bound.toFixed(1)}% (95%), which is why the review below matters.
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-edge">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-xs uppercase tracking-wider text-zinc-500">
              <tr className="border-b border-edge">
                <th className="px-4 py-3 text-left font-medium">Match</th>
                <th className="px-4 py-3 text-left font-medium">Venue</th>
                <th className="px-4 py-3 text-left font-medium">Table found</th>
                <th className="px-4 py-3 text-right font-medium">Rallies</th>
                <th className="px-4 py-3 text-right font-medium">Kept</th>
                <th className="px-4 py-3 text-right font-medium">Cards</th>
                <th className="px-4 py-3 text-right font-medium">Junk cards</th>
                <th className="px-4 py-3 text-right font-medium">Fused</th>
                <th className="px-4 py-3 text-right font-medium">Footage</th>
              </tr>
            </thead>
            <tbody>
              {RECALL_MATCHES.map((m: RecallMatch) => (
                <tr
                  key={m.key}
                  onClick={() => {
                    setMatchKey(m.key);
                    setRegionId(null);
                  }}
                  className={`cursor-pointer border-b border-edge/60 transition-colors last:border-0 hover:bg-white/5 ${
                    m.key === matchKey ? "bg-cyan-500/10" : ""
                  }`}
                >
                  <td className="px-4 py-2.5 font-medium text-white">
                    {m.opponent ?? m.key}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400">
                    {m.venue ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {m.calibrated ? (
                      <span className="text-zinc-400">yes</span>
                    ) : (
                      <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200">
                        no table
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-300">
                    {m.curated ? m.rallies : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-white">
                    {m.curated ? (
                      `${(100 * m.labRecall).toFixed(0)}%`
                    ) : (
                      <span className="text-zinc-600">not scored yet</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-300">
                    {m.labCards}{" "}
                    <span className="text-zinc-600">
                      vs {m.productionCards}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-300">
                    {m.curated ? (
                      <>
                        {m.labBarren}{" "}
                        <span className="text-zinc-600">
                          vs {m.productionBarren}
                        </span>
                      </>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-400">
                    {m.curated ? m.fused : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-400">
                    {m.protectedPct.toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="mt-12 text-xl font-semibold text-white">
          {match.opponent ?? match.key}
        </h2>

        {/* Flex, not grid-cols-[minmax(0,1fr)_360px]: the comma inside
            minmax() stops Tailwind generating the class at all. */}
        <div className="mt-4 flex flex-col gap-6 lg:flex-row">
          <div className="min-w-0 flex-1">
            <div className="relative aspect-video overflow-hidden rounded-xl border border-edge bg-black">
              {url ? (
                <video
                  ref={videoRef}
                  src={url}
                  controls
                  playsInline
                  preload="metadata"
                  className="absolute inset-0 h-full w-full"
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
                  {videoState === "error"
                    ? "Video unavailable."
                    : "Loading video…"}
                </div>
              )}
            </div>

            {region && (
              <>
                <canvas
                  ref={stripRef}
                  className="mt-3 h-24 w-full rounded-lg border border-edge bg-ink/60"
                />
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
                  {LANES.map((l) => (
                    <span key={l.key} className="flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-sm"
                        style={{ backgroundColor: l.colour }}
                      />
                      {l.label}
                    </span>
                  ))}
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-white" />
                    proposed card
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: "rgb(250,204,21)" }}
                    />
                    card today
                  </span>
                </div>

                <div className="mt-4 rounded-xl border border-edge bg-ink/40 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${KIND_TONE[region.kind]}`}
                    >
                      {kindMeta(region.kind).label}
                    </span>
                    <span className="tabular-nums text-sm text-zinc-400">
                      proposed {region.t0.toFixed(1)}–{region.t1.toFixed(1)}s
                      <span className="text-zinc-600">
                        {" "}
                        ({(region.t1 - region.t0).toFixed(1)}s)
                      </span>
                    </span>
                    <span className="tabular-nums text-sm text-amber-200/80">
                      {region.prod.length === 0
                        ? "no card today"
                        : `today ${region.prod
                            .map((p) => `${p[0].toFixed(1)}–${p[1].toFixed(1)}s`)
                            .join(", ")}`}
                    </span>
                    {region.state && (
                      <span className="text-sm text-zinc-500">
                        confidence: {region.state}
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-base text-white">
                    {kindMeta(region.kind).question}
                  </p>
                  <p className="mt-1 text-sm text-zinc-400">{region.why}</p>
                </div>

                {region.cutT0 === null ? (
                  <p className="mt-4 rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    The cut removed this stretch, so there is nothing to play.
                    That is itself the finding: if a rally is in here, its
                    footage is already gone.
                  </p>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {region.inCut < 0.999 && (
                      <p className="w-full rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-100">
                        The cut kept only{" "}
                        {(100 * region.inCut).toFixed(0)}% of this stretch, so
                        playback skips the rest.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={playRegion}
                      className="rounded-full border border-cyan-glow/60 bg-cyan-500/15 px-4 py-1.5 text-sm text-cyan-100"
                    >
                      Play this stretch
                    </button>
                    <button
                      type="button"
                      onClick={playWide}
                      className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
                    >
                      Play with more run-up
                    </button>
                    <button
                      type="button"
                      onClick={playEnding}
                      className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
                    >
                      Play just the ending
                    </button>
                  </div>
                )}

                <h3 className="mt-8 text-base font-semibold text-white">
                  What is actually in there?
                </h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {VERDICTS.map(({ value, label }, i) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        void save(region, {
                          verdict: note?.verdict === value ? null : value,
                        })
                      }
                      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                        note?.verdict === value
                          ? "border-cyan-glow/60 bg-cyan-500/15 text-cyan-100"
                          : "border-edge text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                      }`}
                    >
                      <span className="mr-1.5 text-zinc-600">{i + 1}</span>
                      {label}
                    </button>
                  ))}
                </div>

                {note?.verdict && note.verdict !== "rally_whole" && (
                  <div className="mt-6 space-y-4">
                    {CAUSE_GROUPS.map((group) => (
                      <div key={group.group}>
                        <div className="text-sm text-zinc-400">
                          {group.group}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {group.causes.map(({ value, label }) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => toggleCause(region, value)}
                              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                                note?.causes.includes(value)
                                  ? "border-amber-400/60 bg-amber-500/15 text-amber-100"
                                  : "border-edge text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    <textarea
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      onBlur={() => {
                        const trimmed = noteDraft.trim();
                        if (trimmed !== (note?.note ?? "")) {
                          void save(region, { note: trimmed || null });
                        }
                      }}
                      rows={2}
                      placeholder="Anything else worth knowing here?"
                      className="w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
                    />
                  </div>
                )}
              </>
            )}
          </div>

          <div className="w-full shrink-0 lg:w-96">
            <div className="flex flex-wrap gap-2">
              {KINDS.map(({ value, label }) => {
                const on = kinds.includes(value);
                const n = (match.regions ?? []).filter(
                  (r) => r.kind === value,
                ).length;
                if (n === 0) return null;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setKinds((k) =>
                        on ? k.filter((x) => x !== value) : [...k, value],
                      );
                      setRegionId(null);
                    }}
                    className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                      on
                        ? "border-cyan-glow/60 bg-cyan-500/15 text-cyan-100"
                        : "border-edge text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                    }`}
                  >
                    {label}
                    <span className="ml-1.5 text-zinc-600">{n}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setOnlyUnreviewed((v) => !v);
                  setRegionId(null);
                }}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  onlyUnreviewed
                    ? "border-cyan-glow/60 bg-cyan-500/15 text-cyan-100"
                    : "border-edge text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                }`}
              >
                Hide reviewed
              </button>
            </div>

            <div className="mt-3 text-sm text-zinc-500">
              {rows.length} to review, {reviewed} done · press 1–5 to answer
              and move on
            </div>

            <div className="mt-3 max-h-[70vh] overflow-y-auto rounded-xl border border-edge">
              {rows.map((r) => {
                const v = notes.get(r.id)?.verdict;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRegionId(r.id)}
                    className={`flex w-full items-center gap-2 border-b border-edge/60 px-3 py-2 text-left text-sm transition-colors last:border-0 hover:bg-white/5 ${
                      region?.id === r.id ? "bg-cyan-500/10" : ""
                    }`}
                  >
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${KIND_TONE[r.kind]}`}
                    >
                      {r.kind}
                    </span>
                    <span className="tabular-nums text-zinc-500">
                      {formatClock(r.t0)}
                    </span>
                    <span className="tabular-nums text-zinc-600">
                      {(r.t1 - r.t0).toFixed(1)}s
                    </span>
                    {r.cutT0 === null ? (
                      <span className="text-amber-300">cut out</span>
                    ) : r.inCut < 0.999 ? (
                      <span className="text-amber-300/70">part cut</span>
                    ) : null}
                    {v && (
                      <span
                        className={`ml-auto ${
                          v === "rally_whole"
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
          </div>
        </div>
      </div>
    </main>
  );
}
