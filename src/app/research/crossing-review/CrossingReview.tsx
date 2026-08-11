"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";
import { CROSSING_REVIEW_ROWS, type CrossingReviewRow } from "./data";
import {
  VERDICTS,
  filterRows,
  formatClock,
  matchOptions,
  tabCounts,
  type CrossingReviewTab,
  type CrossingVerdict,
} from "./crossingReviewView";

const TABS: Array<{ value: CrossingReviewTab; label: string }> = [
  { value: "missed_junk", label: "Junk the rule missed" },
  { value: "flagged_kept", label: "Real points it would flag" },
];

export interface CrossingNote {
  readonly point_id: string;
  readonly verdict: CrossingVerdict | null;
  readonly note: string | null;
}

/**
 * [clip seconds, x / frame width, y / frame height, zone]
 * zone: 0 outside the focus-table corridor, 1 inside it, 2 inside it AND
 * within 0.30m of the net line — a candidate net contact.
 */
type Detection = [number, number, number, number];

// The 700KB detection file loads once, on the first play, not with the page.
let detectionsPromise: Promise<Record<string, Detection[]>> | null = null;
function loadDetections() {
  detectionsPromise ??= import("./detections.json").then(
    (mod) => mod.default as unknown as Record<string, Detection[]>,
  );
  return detectionsPromise;
}

export function CrossingReview({
  initialNotes,
}: {
  initialNotes: CrossingNote[];
}) {
  const [tab, setTab] = useState<CrossingReviewTab>("missed_junk");
  const [match, setMatch] = useState("all");
  const [overlay, setOverlay] = useState(true);
  const [notes, setNotes] = useState<Map<string, CrossingNote>>(
    () => new Map(initialNotes.map((note) => [note.point_id, note])),
  );
  const counts = tabCounts(CROSSING_REVIEW_ROWS);
  const options = matchOptions(CROSSING_REVIEW_ROWS, tab);
  const rows = filterRows(CROSSING_REVIEW_ROWS, { tab, match });
  const reviewed = rows.filter((row) => notes.get(row.pointId)?.verdict).length;

  // One clip plays at a time; starting another pauses the last.
  const activeVideo = useRef<HTMLVideoElement | null>(null);
  const onPlay = useCallback((video: HTMLVideoElement) => {
    if (activeVideo.current && activeVideo.current !== video) {
      activeVideo.current.pause();
    }
    activeVideo.current = video;
  }, []);

  const supabase = createClient();
  const saveNote = useCallback(
    async (row: CrossingReviewRow, patch: Partial<CrossingNote>) => {
      const prev = notes.get(row.pointId) ?? {
        point_id: row.pointId,
        verdict: null,
        note: null,
      };
      const next = { ...prev, ...patch };
      setNotes((map) => new Map(map).set(row.pointId, next));
      const { error } = await supabase.from("crossing_review_notes").upsert({
        point_id: row.pointId,
        cls: row.cls,
        verdict: next.verdict,
        note: next.note,
        updated_at: new Date().toISOString(),
      });
      if (error) {
        setNotes((map) => new Map(map).set(row.pointId, prev));
      }
      return !error;
    },
    [notes, supabase],
  );

  return (
    <main className="min-h-screen bg-arena pb-24 text-zinc-100">
      <header className="mx-auto flex max-w-[1500px] items-center px-6 py-6">
        <Logo href="/research" />
      </header>

      <div className="mx-auto max-w-[1500px] px-6">
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Crossing review
        </h1>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {TABS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTab(value);
                setMatch("all");
              }}
              className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                tab === value
                  ? "border-cyan-glow/60 bg-cyan-500/15 text-cyan-100"
                  : "border-edge text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              }`}
            >
              {label} ({counts[value]})
            </button>
          ))}

          <button
            type="button"
            onClick={() => setOverlay((value) => !value)}
            className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
              overlay
                ? "border-cyan-glow/60 bg-cyan-500/15 text-cyan-100"
                : "border-edge text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            }`}
          >
            Ball track
          </button>

          <span className="text-sm text-zinc-500">
            {reviewed} of {rows.length} reviewed
          </span>

          <select
            value={match}
            onChange={(event) => setMatch(event.target.value)}
            className="ml-auto rounded-full border border-edge bg-ink px-4 py-1.5 text-sm text-zinc-300"
            aria-label="Filter by match"
          >
            <option value="all">All matches</option>
            {options.map((option) => (
              <option key={option.matchId} value={option.matchId}>
                {option.label} ({option.count})
              </option>
            ))}
          </select>
        </div>

        <section
          aria-label="Point clips"
          className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {rows.map((row) => (
            <ClipCard
              key={row.pointId}
              row={row}
              overlay={overlay}
              note={notes.get(row.pointId)}
              onPlay={onPlay}
              onSave={saveNote}
            />
          ))}
        </section>

        {rows.length === 0 && (
          <p className="mt-10 text-sm text-zinc-400">Nothing here.</p>
        )}
      </div>
    </main>
  );
}

function ClipCard({
  row,
  overlay,
  note,
  onPlay,
  onSave,
}: {
  row: CrossingReviewRow;
  overlay: boolean;
  note: CrossingNote | undefined;
  onPlay: (video: HTMLVideoElement) => void;
  onSave: (
    row: CrossingReviewRow,
    patch: Partial<CrossingNote>,
  ) => Promise<boolean>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [netTouches, setNetTouches] = useState<number | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(note?.note ?? "");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const detRef = useRef<Detection[] | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: row.matchId, pointId: row.pointId }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.url) throw new Error("no url");
      const det = (await loadDetections())[row.pointId] ?? [];
      detRef.current = det;
      setNetTouches(det.filter(([, , , zone]) => zone === 2).length);
      setUrl(data.url);
      setState("idle");
    } catch {
      setState("error");
    }
  }, [row.matchId, row.pointId]);

  // Trail of the last 0.6s of detections, redrawn while the clip plays.
  useEffect(() => {
    if (!url || !overlay) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const det = detRef.current;
      if (!video || !canvas || !det) return;
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
      // Cyan: inside the focus-table corridor, i.e. what the crossing rule
      // actually counted. Amber: in the corridor within 0.30m of the net —
      // a candidate net contact. Grey: everything else the tracker
      // reported — neighbouring tables, ghosts, balls on the floor.
      for (const [ct, nx, ny, zone] of det) {
        const age = t - ct;
        if (age < -0.05 || age > 0.6) continue;
        const fade = 1 - Math.max(0, age) / 0.6;
        ctx.beginPath();
        ctx.arc(nx * w, ny * h, (2 + 4 * fade) * dpr, 0, Math.PI * 2);
        ctx.fillStyle =
          zone === 2
            ? `rgba(251, 191, 36, ${0.35 + 0.55 * fade})`
            : zone === 1
              ? `rgba(34, 211, 238, ${0.25 + 0.6 * fade})`
              : `rgba(161, 161, 170, ${0.15 + 0.4 * fade})`;
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [url, overlay]);

  // A removed video keeps playing with sound; never let it.
  useEffect(() => {
    const video = videoRef.current;
    return () => video?.pause();
  }, [url]);

  const verdicts = VERDICTS[row.cls];
  const selected = note?.verdict ?? null;

  return (
    <figure className="overflow-hidden rounded-xl border border-edge bg-ink/60">
      {/* The box is sized here, not on the video, so nothing jumps when
          metadata arrives. */}
      <div className="relative aspect-video bg-black">
        {url ? (
          <>
            <video
              ref={videoRef}
              src={url}
              controls
              autoPlay
              playsInline
              preload="metadata"
              onPlay={(event) => onPlay(event.currentTarget)}
              className="absolute inset-0 h-full w-full"
            />
            {overlay && (
              <canvas
                ref={canvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={load}
            disabled={state === "loading"}
            className="absolute inset-0 flex items-center justify-center text-sm text-zinc-300 transition-colors hover:bg-white/5"
          >
            {state === "loading" && "Loading…"}
            {state === "error" && "Clip unavailable. Tap to retry."}
            {state === "idle" && (
              <span className="flex items-center gap-2">
                <svg
                  viewBox="0 0 24 24"
                  className="h-8 w-8 fill-current text-white/80"
                  aria-hidden
                >
                  <path d="M8 5.5v13l11-6.5-11-6.5z" />
                </svg>
                Play clip
              </span>
            )}
          </button>
        )}
      </div>
      <figcaption className="px-4 py-3 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-medium text-white">
            {row.opponent}
            {row.venue ? ` at ${row.venue}` : ""}
          </span>
          <span className="text-zinc-400">{formatClock(row.t0)}</span>
          <span className="text-zinc-400">{row.dur.toFixed(1)}s</span>
          <span className="ml-auto font-mono text-xs text-zinc-500">
            {row.crossings} {row.crossings === 1 ? "crossing" : "crossings"} ·{" "}
            {row.detections} det
            {netTouches !== null && netTouches > 0 && (
              <span className="text-amber-200/80"> · {netTouches} at net</span>
            )}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {verdicts.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() =>
                onSave(row, { verdict: selected === value ? null : value })
              }
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                selected === value
                  ? "border-cyan-glow/60 bg-cyan-500/15 text-cyan-100"
                  : "border-edge text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setNoteOpen((value) => !value)}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              note?.note
                ? "border-amber-400/40 bg-amber-500/10 text-amber-100"
                : "border-edge text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            }`}
          >
            Note
          </button>
        </div>

        {noteOpen && (
          <textarea
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            onBlur={() => {
              const trimmed = noteDraft.trim();
              if (trimmed !== (note?.note ?? "")) {
                void onSave(row, { note: trimmed || null });
              }
            }}
            rows={2}
            placeholder="What is happening here?"
            className="mt-2 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
          />
        )}
      </figcaption>
    </figure>
  );
}
