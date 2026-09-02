"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { netSegmentOriented } from "../serve-accuracy/netDeath";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";
import {
  SERVE_MATCHES,
  SERVE_POINTS,
  type NormPoint,
  type ServeMatch,
  type ServePoint,
} from "./data";
import {
  CAUSE_GROUPS,
  STAGE_LABEL,
  VERDICTS,
  filterPoints,
  formatClock,
  foundPct,
  isScored,
  stageOf,
  summarise,
  whyLabel,
  type Outcome,
  type Verdict,
} from "./serveDetectorView";

export interface ServeNote {
  readonly point_id: string;
  readonly verdict: Verdict | null;
  readonly causes: string[];
  readonly note: string | null;
}

/** [clip seconds, x/width, y/height, kind] — 1 on table, 0 off it, 2 an
 *  alternative BlurBall offered and the tracker did not take. */
type Detection = [number, number, number, number];
/** [clip seconds, side] — 0 near, 1 far, 2 too close to the net to say. */
type Bounce = [number, number];
interface Track {
  readonly win: [number, number];
  readonly d: Detection[];
  readonly b: Bounce[];
}

const TRAIL_S = 0.55;
const PLAY_TAIL_S = 2.4;

const OUTCOMES: Array<{ value: Outcome; label: string }> = [
  { value: "all", label: "All points" },
  { value: "found", label: "Serve found" },
  { value: "missed", label: "Nothing found" },
];

const STAGE_TONE: Record<string, string> = {
  ok: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
  ball: "border-red-400/40 bg-red-500/10 text-red-200",
  table: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  motif: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
};

export function ServeDetector({ initialNotes }: { initialNotes: ServeNote[] }) {
  const [matchKey, setMatchKey] = useState(SERVE_MATCHES[0]?.skey ?? "");
  const [outcome, setOutcome] = useState<Outcome>("all");
  const [onlyTracked, setOnlyTracked] = useState(true);
  const [pointId, setPointId] = useState<string | null>(null);
  const [showBall, setShowBall] = useState(true);
  const [showAlts, setShowAlts] = useState(true);
  const [showTable, setShowTable] = useState(true);
  const [showBounces, setShowBounces] = useState(true);
  const [notes, setNotes] = useState<Map<string, ServeNote>>(
    () => new Map(initialNotes.map((n) => [n.point_id, n])),
  );
  const [url, setUrl] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [tracks, setTracks] = useState<Record<string, Track> | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const trackRef = useRef<Track | null>(null);

  const match = useMemo(
    () => SERVE_MATCHES.find((m) => m.skey === matchKey) ?? SERVE_MATCHES[0],
    [matchKey],
  );
  const rows = useMemo(
    () => filterPoints(SERVE_POINTS, { match: matchKey, outcome, onlyTracked }),
    [matchKey, outcome, onlyTracked],
  );
  const point = useMemo(
    () => rows.find((p) => p.pointId === pointId) ?? rows[0] ?? null,
    [rows, pointId],
  );
  const overall = useMemo(() => summarise(SERVE_POINTS), []);
  const note = point ? notes.get(point.pointId) ?? null : null;

  useEffect(() => {
    setNoteDraft(note?.note ?? "");
  }, [note?.point_id, note?.note]);

  // One signed URL and one track file per match, both fetched on demand.
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setTracks(null);
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
        const res = await fetch(`/research/serve-detector/${match.skey}.json`);
        const data = (await res.json()) as Record<string, Track>;
        if (!cancelled) setTracks(data);
      } catch {
        if (!cancelled) setTracks({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [match.matchId, match.skey]);

  useEffect(() => {
    trackRef.current = point && tracks ? tracks[point.pointId] ?? null : null;
  }, [point, tracks]);

  const play = useCallback(
    (from: number, until: number) => {
      const video = videoRef.current;
      if (!video) return;
      stopAtRef.current = until;
      const go = () => {
        video.currentTime = Math.max(0, from);
        void video.play().catch(() => {});
      };
      if (video.readyState >= 1) go();
      else video.addEventListener("loadedmetadata", go, { once: true });
    },
    [],
  );

  const playProposed = useCallback(() => {
    if (!point) return;
    play(point.proposed, (point.serve ?? point.cutT0) + PLAY_TAIL_S);
  }, [play, point]);

  const playToday = useCallback(() => {
    if (!point) return;
    play(point.todayStart, (point.serve ?? point.cutT0) + PLAY_TAIL_S);
  }, [play, point]);

  // The two buttons above stop just after the serve, because that is the
  // only thing being judged. The rally is still there, untouched — the trim
  // moves the opening and nothing else — so this plays the card in full.
  const playWholePoint = useCallback(() => {
    if (!point) return;
    play(point.proposed, point.clipEnd);
  }, [play, point]);

  // Seek whenever the selected point changes and the video is ready.
  useEffect(() => {
    if (!url || !point) return;
    play(point.proposed, (point.serve ?? point.cutT0) + PLAY_TAIL_S);
  }, [url, point, play]);

  // A video removed from the document keeps playing with sound.
  useEffect(() => {
    const video = videoRef.current;
    return () => video?.pause();
  }, [url]);

  // The overlay: the ball BlurBall reported, the alternatives it offered,
  // and the table the calibration believes in.
  useEffect(() => {
    if (!url) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      const t = video.currentTime;

      if (showTable && match.quad.length === 4) {
        const line = (pts: readonly NormPoint[], close: boolean) => {
          ctx.beginPath();
          pts.forEach(([x, y], i) =>
            i === 0 ? ctx.moveTo(x * w, y * h) : ctx.lineTo(x * w, y * h),
          );
          if (close) ctx.closePath();
          ctx.stroke();
        };
        ctx.lineWidth = 2 * dpr;
        ctx.strokeStyle = "rgba(52, 211, 153, 0.85)";
        line(match.quad, true);
        ctx.setLineDash([6 * dpr, 5 * dpr]);
        ctx.strokeStyle = "rgba(52, 211, 153, 0.6)";
        // The baked net is the sideline pixel midpoint, which sits well
        // into the near half under perspective (fixed repo-wide
        // 2026-09-02). This corpus stores quads in inconsistent corner
        // order, so the baked endpoints are used only to identify which
        // opposite edge pair is the sidelines; the line itself is the
        // projective construction. Normalised coordinates are fine: the
        // construction commutes with any scaling.
        const [q0, q1, q2, q3] = match.quad;
        const mid = (p: readonly number[], q: readonly number[]) =>
          [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as const;
        const d2 = (p: readonly number[], q: readonly number[]) =>
          (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
        const err = (a: readonly number[], b: readonly number[]) =>
          Math.min(
            d2(a, match.net[0]) + d2(b, match.net[1]),
            d2(a, match.net[1]) + d2(b, match.net[0]),
          );
        // sides q3-q0 & q1-q2 (ends q0-q1, q2-q3) vs the rotated pairing
        const sidesA = err(mid(q3, q0), mid(q1, q2));
        const sidesB = err(mid(q0, q1), mid(q2, q3));
        const seg =
          sidesA <= sidesB
            ? netSegmentOriented(q0, q1, q2, q3)
            : netSegmentOriented(q1, q2, q3, q0);
        line(seg ? [seg.e1, seg.e2] : match.net, false);
        ctx.setLineDash([]);
        match.quad.forEach(([x, y]) => {
          ctx.beginPath();
          ctx.arc(x * w, y * h, 4 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(52, 211, 153, 0.9)";
          ctx.fill();
        });
      }

      const track = trackRef.current;
      if (!track) return;

      if (showBall) {
        for (const [ts, nx, ny, kind] of track.d) {
          if (kind === 2 && !showAlts) continue;
          const age = t - ts;
          if (age < -0.04 || age > TRAIL_S) continue;
          const fade = 1 - Math.max(0, age) / TRAIL_S;
          ctx.beginPath();
          ctx.arc(nx * w, ny * h, (2 + 4 * fade) * dpr, 0, Math.PI * 2);
          ctx.fillStyle =
            kind === 1
              ? `rgba(34, 211, 238, ${0.3 + 0.6 * fade})`
              : kind === 0
                ? `rgba(244, 114, 182, ${0.3 + 0.55 * fade})`
                : `rgba(161, 161, 170, ${0.12 + 0.35 * fade})`;
          ctx.fill();
        }
      }

      if (showBounces) {
        for (const [ts, side] of track.b) {
          const age = t - ts;
          if (age < -0.04 || age > 1.2) continue;
          const pt = track.d.find(([dt, , , k]) => k !== 2 && dt === ts);
          if (!pt) continue;
          ctx.beginPath();
          ctx.arc(pt[1] * w, pt[2] * h, 9 * dpr, 0, Math.PI * 2);
          ctx.lineWidth = 2 * dpr;
          ctx.strokeStyle =
            side === 0
              ? "rgba(251, 191, 36, 0.95)"
              : side === 1
                ? "rgba(167, 139, 250, 0.95)"
                : "rgba(161, 161, 170, 0.8)";
          ctx.stroke();
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [url, match, showBall, showAlts, showTable, showBounces]);

  const supabase = createClient();
  const save = useCallback(
    async (row: ServePoint, patch: Partial<ServeNote>) => {
      const prev = notes.get(row.pointId) ?? {
        point_id: row.pointId,
        verdict: null,
        causes: [],
        note: null,
      };
      const next = { ...prev, ...patch };
      setNotes((map) => new Map(map).set(row.pointId, next));
      const { error } = await supabase.from("serve_detector_notes").upsert({
        point_id: row.pointId,
        verdict: next.verdict,
        causes: next.causes,
        note: next.note,
        updated_at: new Date().toISOString(),
      });
      if (error) setNotes((map) => new Map(map).set(row.pointId, prev));
    },
    [notes, supabase],
  );

  const toggleCause = useCallback(
    (row: ServePoint, cause: string) => {
      const current = notes.get(row.pointId)?.causes ?? [];
      const causes = current.includes(cause)
        ? current.filter((c) => c !== cause)
        : [...current, cause];
      void save(row, { causes });
    },
    [notes, save],
  );

  const reviewed = rows.filter((p) => notes.get(p.pointId)?.verdict).length;

  return (
    <main className="min-h-screen bg-arena pb-24 text-zinc-100">
      <header className="mx-auto flex max-w-[1500px] items-center px-6 py-6">
        <Logo href="/research" />
      </header>

      <div className="mx-auto max-w-[1500px] px-6">
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Updated serve detector
        </h1>

        <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge bg-edge sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Matches", String(SERVE_MATCHES.length)],
            ["Points", String(overall.points)],
            ["Serve found", `${overall.foundPct.toFixed(0)}%`],
            ["Footage removed", `${(overall.saved / 60).toFixed(0)} min`],
            [
              "Median error",
              overall.medErr === null ? "—" : `${overall.medErr.toFixed(2)}s`,
            ],
            ["Against taps", String(overall.labels)],
          ].map(([label, value], i) => (
            <div key={label} className="bg-ink/60 px-4 py-3">
              <div className="text-xs uppercase tracking-wider text-zinc-500">
                {label}
              </div>
              <div
                className={`mt-1 text-2xl font-semibold ${
                  i === 2 ? "text-cyan-glow" : "text-white"
                }`}
              >
                {value}
              </div>
            </div>
          ))}
        </div>

        <h2 className="mt-12 text-xl font-semibold text-white">
          Where each match breaks
        </h2>
        <p className="mt-3 max-w-3xl text-sm text-zinc-400">
          Serve found is the share of a match&apos;s cards with a serve in
          them. On a match nobody has scored yet that denominator still holds
          every junk card the pipeline emitted, and a junk card has no serve
          to find. On the two matches available both ways, counting only cards
          that sit over a real point moves the figure from 45% to 70%.
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-edge">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-xs uppercase tracking-wider text-zinc-500">
              <tr className="border-b border-edge">
                <th className="px-4 py-3 text-left font-medium">Match</th>
                <th className="px-4 py-3 text-left font-medium">Venue</th>
                <th className="px-4 py-3 text-right font-medium">Points</th>
                <th className="px-4 py-3 text-right font-medium">Ball found</th>
                <th className="px-4 py-3 text-right font-medium">On table</th>
                <th className="px-4 py-3 text-right font-medium">Serve found</th>
                <th className="px-4 py-3 text-right font-medium">Removed</th>
                <th className="px-4 py-3 text-left font-medium">Reading</th>
              </tr>
            </thead>
            <tbody>
              {SERVE_MATCHES.map((m: ServeMatch) => {
                const stage = stageOf(m);
                return (
                  <tr
                    key={m.skey}
                    onClick={() => {
                      setMatchKey(m.skey);
                      setPointId(null);
                    }}
                    className={`cursor-pointer border-b border-edge/60 transition-colors last:border-0 hover:bg-white/5 ${
                      m.skey === matchKey ? "bg-cyan-500/10" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5 font-medium text-white">
                      {m.skey}
                      {!isScored(m) && (
                        <span className="ml-2 rounded-full border border-zinc-600 px-2 py-0.5 text-xs font-normal text-zinc-400">
                          unscored
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400">
                      {m.venue ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-300">
                      {m.points}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-300">
                      {(100 * m.detRate).toFixed(0)}%
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-300">
                      {(100 * m.onTable).toFixed(0)}%
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-white">
                      {foundPct(m).toFixed(0)}%
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-400">
                      {m.saved.toFixed(0)}s
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-xs ${STAGE_TONE[stage]}`}
                      >
                        {STAGE_LABEL[stage]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h2 className="mt-12 text-xl font-semibold text-white">
          {match.skey}
        </h2>

        {/* Flex, not grid-cols-[minmax(0,1fr)_320px]: the comma inside
            minmax() stops Tailwind generating the class at all. */}
        <div className="mt-4 flex flex-col gap-6 lg:flex-row">
          <div className="min-w-0 flex-1">
            <div className="relative aspect-video overflow-hidden rounded-xl border border-edge bg-black">
              {url ? (
                <>
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
                  <canvas
                    ref={canvasRef}
                    className="pointer-events-none absolute inset-0 h-full w-full"
                  />
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
                  {videoState === "error"
                    ? "Video unavailable."
                    : "Loading video…"}
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {[
                ["Ball", showBall, setShowBall],
                ["Other candidates", showAlts, setShowAlts],
                ["Table", showTable, setShowTable],
                ["Bounces", showBounces, setShowBounces],
              ].map(([label, on, set]) => (
                <button
                  key={label as string}
                  type="button"
                  onClick={() =>
                    (set as (v: boolean) => void)(!(on as boolean))
                  }
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    on
                      ? "border-cyan-glow/60 bg-cyan-500/15 text-cyan-100"
                      : "border-edge text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  {label as string}
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-400">
              <Swatch color="rgb(34,211,238)" label="ball, on the table" />
              <Swatch color="rgb(244,114,182)" label="ball, off the table" />
              <Swatch color="rgb(161,161,170)" label="candidate not taken" />
              <Swatch color="rgb(251,191,36)" label="bounce, near half" />
              <Swatch color="rgb(167,139,250)" label="bounce, far half" />
              <Swatch color="rgb(52,211,153)" label="table and net" />
            </div>

            {point && (
              <>
                <div className="mt-4 flex flex-wrap gap-2">
                  {/* With no serve found there is no proposal — the opening
                      stays exactly where it is today, so offering two
                      buttons that do the same thing reads as a change that
                      never happened. */}
                  {point.serve !== null && (
                    <button
                      type="button"
                      onClick={playProposed}
                      className="rounded-full border border-cyan-glow/60 bg-cyan-500/15 px-4 py-1.5 text-sm text-cyan-100"
                    >
                      Play the proposed opening
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={playToday}
                    className={`rounded-full border px-4 py-1.5 text-sm ${
                      point.serve === null
                        ? "border-cyan-glow/60 bg-cyan-500/15 text-cyan-100"
                        : "border-edge text-zinc-300 hover:border-zinc-500"
                    }`}
                  >
                    {point.serve === null
                      ? "Play the clip as it opens today"
                      : "Play today's opening"}
                  </button>
                  <button
                    type="button"
                    onClick={playWholePoint}
                    className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
                  >
                    Play the whole point
                  </button>
                </div>

                <dl className="mt-4 space-y-1 text-sm">
                  <Fact k="Point" v={`#${point.idx} at ${formatClock(point.cutT0)}`} />
                  <Fact
                    k="Ends"
                    v={`${point.clipEnd.toFixed(2)}s, unchanged by the trim`}
                  />
                  <Fact k="Opens today" v={`${point.todayStart.toFixed(2)}s`} />
                  {point.serve !== null ? (
                    <>
                      <Fact k="Serve detected" v={`${point.serve.toFixed(2)}s`} />
                      <Fact
                        k="Would open"
                        v={`${point.proposed.toFixed(2)}s, removing ${point.saved.toFixed(2)}s`}
                      />
                    </>
                  ) : (
                    <>
                      <Fact k="Serve detected" v="nothing" />
                      <Fact k="Why not" v={whyLabel(point.why)} />
                      <Fact
                        k="Clip would open"
                        v={`${point.todayStart.toFixed(2)}s — exactly where it does today, nothing is trimmed`}
                      />
                    </>
                  )}
                  <Fact
                    k="Ball found"
                    v={`${(100 * point.detRate).toFixed(0)}% of frames, ${(100 * point.onTable).toFixed(0)}% of those on the table`}
                  />
                  <Fact
                    k="Bounces"
                    v={`${point.bounces} in the window, ${point.follow} crossings after`}
                  />
                  {point.label !== null && (
                    <Fact
                      k="Your tap"
                      v={
                        point.serve === null
                          ? `${point.label.toFixed(2)}s`
                          : `${point.label.toFixed(2)}s, off by ${(point.serve - point.label).toFixed(2)}s`
                      }
                    />
                  )}
                </dl>

                <h3 className="mt-8 text-base font-semibold text-white">
                  Was it right?
                </h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {VERDICTS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        void save(point, {
                          verdict: note?.verdict === value ? null : value,
                        })
                      }
                      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                        note?.verdict === value
                          ? "border-cyan-glow/60 bg-cyan-500/15 text-cyan-100"
                          : "border-edge text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {note?.verdict && note.verdict !== "right" && (
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
                              onClick={() => toggleCause(point, value)}
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
                          void save(point, { note: trimmed || null });
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

          <div className="w-full shrink-0 lg:w-80">
            <div className="flex flex-wrap gap-2">
              {OUTCOMES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setOutcome(value);
                    setPointId(null);
                  }}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    outcome === value
                      ? "border-cyan-glow/60 bg-cyan-500/15 text-cyan-100"
                      : "border-edge text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setOnlyTracked((v) => !v);
                  setPointId(null);
                }}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  onlyTracked
                    ? "border-cyan-glow/60 bg-cyan-500/15 text-cyan-100"
                    : "border-edge text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                }`}
              >
                Only points with an overlay
              </button>
            </div>

            <div className="mt-3 text-sm text-zinc-500">
              {rows.length} points, {reviewed} reviewed
            </div>

            <div className="mt-3 max-h-[70vh] overflow-y-auto rounded-xl border border-edge">
              {rows.map((p) => {
                const v = notes.get(p.pointId)?.verdict;
                return (
                  <button
                    key={p.pointId}
                    type="button"
                    onClick={() => setPointId(p.pointId)}
                    className={`flex w-full items-center gap-2 border-b border-edge/60 px-3 py-2 text-left text-sm last:border-0 transition-colors hover:bg-white/5 ${
                      point?.pointId === p.pointId ? "bg-cyan-500/10" : ""
                    }`}
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        p.serve === null ? "bg-zinc-600" : "bg-cyan-glow"
                      }`}
                    />
                    <span className="text-zinc-300">#{p.idx}</span>
                    <span className="text-zinc-600">{formatClock(p.cutT0)}</span>
                    {!p.hasTrack && (
                      <span className="text-zinc-600">no overlay</span>
                    )}
                    <span className="ml-auto tabular-nums text-zinc-500">
                      {p.saved > 0.05 ? `−${p.saved.toFixed(1)}s` : "—"}
                    </span>
                    {v && (
                      <span
                        className={
                          v === "right"
                            ? "text-emerald-300"
                            : v === "too_late"
                              ? "text-red-300"
                              : "text-amber-300"
                        }
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

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-4">
      <dt className="w-36 shrink-0 text-zinc-500">{k}</dt>
      <dd className="tabular-nums text-zinc-200">{v}</dd>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
