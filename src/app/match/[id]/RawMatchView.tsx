"use client";

/**
 * The match page before processing (096): a raw library video. Watch it,
 * delete it, or spend minutes to process it. The point-by-point
 * experience stays out of sight until the video has been through the
 * pipeline — this view is deliberately small.
 *
 * Trimming is player-driven: scrub the native player, then stamp "Start
 * here" / "End here". The charge quote updates from the stamped window,
 * and claim_processing recomputes the same charge server-side, so what
 * the button says is what the balance loses.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";

import { chargeMinutes, formatClock, formatMinutes } from "@/lib/commerce/minutes";
import { deriveMatchTitleParts } from "@/lib/matchTitle";
import { createClient } from "@/lib/supabase/client";
import type { Match } from "@/lib/types";
import { NameCombobox } from "@/app/dashboard/NameCombobox";
import { PickSide } from "./PickSide";
import type { Side } from "./sides";

const MATCH_TYPES = ["drills", "practice", "match", "league", "tournament"] as const;

interface ActiveJob {
  id: string;
  status: string;
  progress: number | null;
  user_message: string | null;
}

export function RawMatchView({
  match,
  rawUrl,
  isOwner,
  commerceEnabled,
  minutesBalance,
  initialJob,
}: {
  match: Match;
  rawUrl: string | null;
  isOwner: boolean;
  commerceEnabled: boolean;
  minutesBalance: number | null;
  initialJob: ActiveJob | null;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [duration, setDuration] = useState<number | null>(
    match.duration_s ?? null,
  );
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState<number | null>(
    match.duration_s ?? null,
  );
  const [placement, setPlacement] = useState(false);
  const [strictness, setStrictness] = useState<"tight" | "normal" | "loose">(
    "normal",
  );
  const [job, setJob] = useState<ActiveJob | null>(initialJob);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Match details, editable right here. This screen is where an upload
  // waits to be processed, which makes it the natural place to say what
  // the video is — and the upload card can no longer be relied on for it,
  // since a fast connection can finish before anyone has typed a word.
  const [opponent, setOpponent] = useState(match.opponent_name ?? "");
  const [venue, setVenue] = useState(match.venue ?? "");
  const [matchType, setMatchType] = useState(match.match_type ?? "");
  const [userSide, setUserSide] = useState<Side | null>(
    (match.user_side as Side | null) ?? null,
  );
  const [pastOpponents, setPastOpponents] = useState<string[]>([]);
  const [detailsSaved, setDetailsSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);

  // Same one-name-per-person suggestions the upload card offers, so
  // "how do I do against X" keeps working across matches.
  useEffect(() => {
    if (!isOwner) return;
    const supabase = createClient();
    void supabase
      .from("matches")
      .select("opponent_name, created_at")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        if (!data) return;
        const seen = new Set<string>();
        const list: string[] = [];
        for (const r of data as { opponent_name: string | null }[]) {
          const v = (r.opponent_name ?? "").trim();
          if (v && !seen.has(v.toLowerCase())) {
            seen.add(v.toLowerCase());
            list.push(v);
          }
        }
        setPastOpponents(list.slice(0, 8));
      });
  }, [isOwner]);

  const saveDetails = useCallback(
    async (patch: Record<string, string | null>) => {
      const supabase = createClient();
      const { error: saveError } = await supabase
        .from("matches")
        .update(patch)
        .eq("id", match.id);
      if (saveError) {
        setError("That didn't save. Check your connection and try again.");
        return;
      }
      setError(null);
      setDetailsSaved(true);
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setDetailsSaved(false), 1500);
      router.refresh();
    },
    [match.id, router],
  );

  // The library's own title, so this page and the card agree. Never the
  // file name: IMG_2486.mov identifies the phone, not the match.
  const title = deriveMatchTitleParts({
    opponentName: opponent,
    venue,
    playedAt: match.played_at,
  }).primary;

  // Duration can be missing when the browser could not read metadata at
  // upload time; the player itself is the backfill.
  const onMetadata = useCallback(() => {
    const d = videoRef.current?.duration;
    if (!d || !Number.isFinite(d) || d <= 0) return;
    setDuration((prev) => prev ?? d);
    setTrimEnd((prev) => prev ?? d);
    if (isOwner && match.duration_s == null) {
      const supabase = createClient();
      supabase
        .rpc("set_match_duration", {
          p_match_id: match.id,
          p_duration_s: d,
        })
        .then(() => undefined);
    }
  }, [isOwner, match.duration_s, match.id]);

  // While a job runs, poll it; when it lands, the server page has a whole
  // different view to render.
  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "processing")) {
      return;
    }
    const supabase = createClient();
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("jobs")
        .select("id, status, progress, user_message")
        .eq("id", job.id)
        .maybeSingle();
      if (!data) return;
      setJob(data as ActiveJob);
      if (data.status === "done") {
        router.refresh();
      }
    }, 8000);
    return () => clearInterval(timer);
  }, [job, router]);

  const stampStart = () => {
    const t = videoRef.current?.currentTime ?? 0;
    setTrimStart(Math.min(t, (trimEnd ?? duration ?? t) - 5));
  };
  const stampEnd = () => {
    const t = videoRef.current?.currentTime ?? 0;
    setTrimEnd(Math.max(t, trimStart + 5));
  };
  const resetTrim = () => {
    setTrimStart(0);
    setTrimEnd(duration);
  };

  const windowS =
    duration != null ? Math.max(0, (trimEnd ?? duration) - trimStart) : null;
  const charge = windowS != null ? chargeMinutes(windowS) : null;
  const trimmed =
    duration != null &&
    (trimStart > 0.5 || (trimEnd != null && trimEnd < duration - 0.5));
  const enough =
    charge != null && minutesBalance != null && minutesBalance >= charge;

  const process = async () => {
    if (busy || charge == null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matchId: match.id,
          trimStartS: trimmed ? trimStart : null,
          trimEndS: trimmed ? trimEnd : null,
          points: true,
          placement,
          strictness,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.code === "insufficient_minutes"
            ? "Not enough minutes for this video."
            : data.code === "queue_full"
              ? "Your queue is full. Wait for a video to finish."
              : "Something went wrong. Try again.",
        );
        return;
      }
      setJob({
        id: data.job_id,
        status: "queued",
        progress: 0,
        user_message: null,
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("matches")
      .delete()
      .eq("id", match.id);
    if (deleteError) {
      setError("Could not delete the video. Try again.");
      setBusy(false);
      return;
    }
    router.push("/matches");
  };

  const jobRunning =
    job != null && (job.status === "queued" || job.status === "processing");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">{title}</h1>
          <p className="mt-0.5 text-sm text-zinc-400">
            {new Date(match.played_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
            {duration != null && <> · {formatClock(duration)}</>}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
          {jobRunning
            ? "Processing"
            : match.status === "failed"
              ? "Processing failed"
              : "Not processed"}
        </span>
      </header>

      {/* Sized on the div, never the video: a media element has no
          intrinsic size until metadata arrives. */}
      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-black">
        {rawUrl ? (
          <video
            ref={videoRef}
            src={rawUrl}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={onMetadata}
            className="max-h-[min(70vh,42rem)] w-full"
          />
        ) : (
          <p className="p-8 text-center text-sm text-zinc-400">
            The video file is not available.
          </p>
        )}
      </div>

      {jobRunning && (
        <section className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="text-sm font-medium text-zinc-100">Processing</h2>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-cyan-400 transition-all"
              style={{ width: `${Math.max(4, job?.progress ?? 0)}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-zinc-400">
            You can leave this page. We email you when the match is ready.
          </p>
        </section>
      )}

      {isOwner && (
        <section className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-zinc-100">Match details</h2>
            <span
              aria-live="polite"
              className="text-xs text-emerald-400"
            >
              {detailsSaved ? "Saved" : ""}
            </span>
          </div>

          <div className="mt-3 space-y-3">
            <div className="block">
              <span className="text-xs font-medium text-zinc-400">Opponent</span>
              <div className="mt-1">
                <NameCombobox
                  value={opponent}
                  options={pastOpponents}
                  onChange={setOpponent}
                  onCommit={() =>
                    void saveDetails({ opponent_name: opponent.trim() || null })
                  }
                  placeholder="Name"
                  ariaLabel="Opponent name"
                  className="w-full rounded-xl border border-zinc-800 bg-black/40 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/60"
                />
              </div>
            </div>

            <label className="block">
              <span className="text-xs font-medium text-zinc-400">Venue</span>
              <input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                onBlur={(e) =>
                  void saveDetails({ venue: e.target.value.trim() || null })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                placeholder="Club or location"
                aria-label="Venue"
                autoComplete="off"
                enterKeyHint="done"
                className="mt-1 w-full rounded-xl border border-zinc-800 bg-black/40 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/60"
              />
            </label>

            <div>
              <span className="text-xs font-medium text-zinc-400">Type</span>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {MATCH_TYPES.map((t) => {
                  const on = matchType === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const next = on ? "" : t;
                        setMatchType(next);
                        void saveDetails({ match_type: next || null });
                      }}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                        on
                          ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-200"
                          : "border-zinc-800 bg-black/40 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Which end you played from. Asked against the raw file here
                rather than the cut, because there is no cut yet — and if
                the browser cannot decode it, PickSide says so and the
                match page asks again once the H.264 cut exists. */}
            {rawUrl && (
              <div className="rounded-xl border border-zinc-800 bg-black/20 p-3.5">
                {userSide !== null ? (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-zinc-200">
                      You&apos;re at the{" "}
                      <span className="font-semibold text-cyan-200">
                        {userSide === "near" ? "bottom" : "top"}
                      </span>{" "}
                      of the video
                    </p>
                    <button
                      type="button"
                      onClick={() => setUserSide(null)}
                      className="shrink-0 rounded-full border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-zinc-200">
                      Which player are you?
                    </p>
                    <div className="mt-3">
                      <PickSide
                        src={rawUrl}
                        atSeconds={60}
                        selected={userSide}
                        onPick={(s) => {
                          setUserSide(s);
                          void saveDetails({ user_side: s });
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {isOwner && !jobRunning && commerceEnabled && (
        <section className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="text-sm font-medium text-zinc-100">
            Break it into points
          </h2>
          {match.status === "failed" && (
            <p className="mt-2 text-sm text-amber-300/90">
              {job?.user_message ??
                "Processing failed, and your minutes came back."}
            </p>
          )}

          {duration == null ? (
            <p className="mt-2 text-sm text-zinc-400">
              Play the video once so we can read its length.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-zinc-400">
                Keep just the match. Drag the handles, or play the video
                and stamp the start and end. You pay only for what&apos;s
                between them.
              </p>

              <TrimBar
                duration={duration}
                start={trimStart}
                end={trimEnd ?? duration}
                onChange={(s, e) => {
                  setTrimStart(s);
                  setTrimEnd(e);
                }}
                onScrub={(t) => {
                  if (videoRef.current) videoRef.current.currentTime = t;
                }}
              />

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={stampStart}
                  className="rounded-full border border-zinc-700 px-3.5 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
                >
                  Start here
                </button>
                <button
                  onClick={stampEnd}
                  className="rounded-full border border-zinc-700 px-3.5 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
                >
                  End here
                </button>
                {trimmed && (
                  <button
                    onClick={resetTrim}
                    className="ml-auto text-sm text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
                  >
                    Reset
                  </button>
                )}
              </div>

              {/* Same shape as the upload sheet's options: a labelled row
                  with a switch, not a pill that hides what it means. */}
              <div className="mt-5 divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-black/20">
                <div className="flex items-center justify-between gap-4 p-3.5">
                  <div>
                    <p className="text-sm text-zinc-200">Placement maps</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Where every ball landed. Adds processing time.
                    </p>
                  </div>
                  <Switch
                    on={placement}
                    onChange={setPlacement}
                    label="Placement maps"
                  />
                </div>
                <div className="p-3.5">
                  <p className="text-sm text-zinc-200">Cut strictness</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    How much room to leave around each point.
                  </p>
                  <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 bg-black/40 p-1">
                    {(["tight", "normal", "loose"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setStrictness(s)}
                        aria-pressed={strictness === s}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                          strictness === s
                            ? "bg-cyan-400/15 text-cyan-200"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        {s === "tight"
                          ? "Tight"
                          : s === "loose"
                            ? "Loose"
                            : "Normal"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={process}
                  disabled={busy || !enough}
                  className="rounded-full bg-cyan-400 px-5 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-40"
                >
                  {charge != null
                    ? `Process · ${formatMinutes(charge)}`
                    : "Process"}
                </button>
                {minutesBalance != null && (
                  <span className="text-sm text-zinc-400">
                    You have {formatMinutes(minutesBalance)}.
                  </span>
                )}
                {charge != null && minutesBalance != null && !enough && (
                  <a
                    href="/account"
                    className="rounded-full border border-zinc-700 px-4 py-1.5 text-sm text-zinc-200 hover:border-zinc-500"
                  >
                    Get more minutes
                  </a>
                )}
              </div>
            </>
          )}
          {error && <p className="mt-3 text-sm text-amber-300/90">{error}</p>}
        </section>
      )}

      {isOwner && !jobRunning && (
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={remove}
            disabled={busy}
            className="rounded-full border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:border-amber-400/60 hover:text-amber-200"
          >
            {confirmDelete ? "Delete for good?" : "Delete video"}
          </button>
          {confirmDelete && (
            <button
              onClick={() => setConfirmDelete(false)}
              className="rounded-full border border-zinc-700 px-4 py-1.5 text-sm text-zinc-400 hover:border-zinc-500"
            >
              Keep it
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The trimmer: one track for the whole video, the kept window lit
 * between two draggable handles. Dragging a handle scrubs the player to
 * that moment, so the eye confirms what the hand is doing. Grabbing the
 * track jumps the nearer handle there — big targets, phone-first.
 */
function TrimBar({
  duration,
  start,
  end,
  onChange,
  onScrub,
}: {
  duration: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  onScrub: (t: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<"start" | "end" | null>(null);

  const toSeconds = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(f * duration * 10) / 10;
  };

  const move = (which: "start" | "end", t: number) => {
    if (which === "start") {
      const s = Math.min(t, end - 5);
      onChange(Math.max(0, s), end);
      onScrub(Math.max(0, s));
    } else {
      const e = Math.max(t, start + 5);
      onChange(start, Math.min(duration, e));
      onScrub(Math.min(duration, e));
    }
  };

  const beginDrag =
    (which: "start" | "end") => (ev: ReactPointerEvent<HTMLDivElement>) => {
      ev.preventDefault();
      draggingRef.current = which;
      try {
        ev.currentTarget.setPointerCapture(ev.pointerId);
      } catch {
        // A missed capture only means the drag ends at the element edge.
      }
      move(which, toSeconds(ev.clientX));
    };
  const onDrag = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    move(draggingRef.current, toSeconds(ev.clientX));
  };
  const endDrag = () => {
    draggingRef.current = null;
  };

  const leftPct = (start / duration) * 100;
  const rightPct = (end / duration) * 100;
  const handle =
    "absolute -inset-y-1 z-10 flex w-7 cursor-ew-resize touch-none " +
    "items-center justify-center";
  const knob =
    "h-full w-[18px] rounded-md bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.35)] " +
    "flex items-center justify-center";

  return (
    <div className="mt-4 select-none">
      <div
        ref={trackRef}
        onPointerDown={(ev) => {
          // Grabbing bare track: the nearer handle comes to the finger.
          const t = toSeconds(ev.clientX);
          const which =
            Math.abs(t - start) <= Math.abs(t - end) ? "start" : "end";
          beginDrag(which)(ev);
        }}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative h-12 touch-none rounded-xl bg-zinc-800/70"
      >
        {/* The kept window */}
        <div
          className="absolute inset-y-0 rounded-lg border-y-2 border-cyan-400/50 bg-cyan-400/10"
          style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
        />
        <div
          role="slider"
          aria-label="Trim start"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={start}
          onPointerDown={beginDrag("start")}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={handle}
          style={{ left: `calc(${leftPct}% - 14px)` }}
        >
          <div className={knob}>
            <div className="h-4 w-0.5 rounded-full bg-zinc-950/50" />
          </div>
        </div>
        <div
          role="slider"
          aria-label="Trim end"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={end}
          onPointerDown={beginDrag("end")}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={handle}
          style={{ left: `calc(${rightPct}% - 14px)` }}
        >
          <div className={knob}>
            <div className="h-4 w-0.5 rounded-full bg-zinc-950/50" />
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-baseline justify-between text-xs tabular-nums">
        <span className="text-zinc-400">{formatClock(start)}</span>
        <span className="text-cyan-200/90">
          {formatClock(end - start)} kept
        </span>
        <span className="text-zinc-400">{formatClock(end)}</span>
      </div>
    </div>
  );
}

/** The app's switch, matching the upload sheet's option rows. */
function Switch({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
        on
          ? "border-cyan-400/60 bg-cyan-400/30"
          : "border-zinc-700 bg-zinc-800"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
          on ? "left-6 bg-cyan-400" : "left-0.5 bg-zinc-500"
        }`}
      />
    </button>
  );
}
