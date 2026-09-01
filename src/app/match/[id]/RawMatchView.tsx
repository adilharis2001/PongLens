"use client";

/**
 * The match page before processing (096): a raw library video. Watch it,
 * delete it, or spend minutes to process it. The point-by-point
 * experience stays out of sight until the video has been through the
 * pipeline — this view is deliberately small.
 *
 * Trimming is player-driven: scrub the player, then stamp "Start here" /
 * "End here". The charge quote updates from the stamped window, and
 * claim_processing recomputes the same charge server-side, so what the
 * button says is what the balance loses. It sits immediately below the
 * picture for that reason — the handles mean nothing without the frame
 * they point at. The same TrimBar runs in the upload card.
 *
 * The player is ClipPlayer in its cut mode, not a native <video controls>:
 * this is where someone decides whether a video they just paid to store is
 * worth processing, and it should behave like every other picture in the
 * app — double-tap to skip, pinch to zoom, hold for speed.
 */

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { SpokenGamesToggle, SpokenLine, cleanSpoken } from "./SpokenScore";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { NoteComposer, NoteItem } from "./Notes";

import { chargeMinutes, formatClock, formatMinutes } from "@/lib/commerce/minutes";
import { deriveMatchTitleParts } from "@/lib/matchTitle";
import { createClient } from "@/lib/supabase/client";
import type { Match, Note, NoteAuthor } from "@/lib/types";
import { NameCombobox } from "@/app/dashboard/NameCombobox";
import { SectionHeading } from "@/components/SectionHeading";
import { ShareSheet } from "@/components/ShareSheet";
import { ShareWithCoachSheet } from "@/components/ShareWithCoach";
import { TrimBar } from "@/components/TrimBar";
import { ClipPlayer } from "./ClipPlayer";
import { PickSide } from "./PickSide";
import { RawExportRow, TOOL_ROW_CLASS, ToolRowChevron } from "./ReelBar";
import type { Side } from "./sides";

const MATCH_TYPES = ["drills", "practice", "match", "league", "tournament"] as const;

interface ActiveJob {
  id: string;
  status: string;
  progress: number | null;
  user_message: string | null;
  kind: string | null;
}

export function RawMatchView({
  match,
  rawUrl,
  isOwner,
  commerceEnabled,
  minutesBalance,
  initialJob,
  initialNotes,
  noteAuthors,
  userId,
}: {
  match: Match;
  rawUrl: string | null;
  isOwner: boolean;
  commerceEnabled: boolean;
  minutesBalance: number | null;
  initialJob: ActiveJob | null;
  initialNotes: Note[];
  noteAuthors: NoteAuthor[];
  userId: string;
}) {
  const router = useRouter();
  // Match-level notes. The page already had a place to WRITE one — the
  // app's raw player saves match notes — and nowhere that showed them, so
  // a note taken here surfaced only in the Journal. Same thread the
  // processed page ends with, so processing keeps every note.
  const [notes, setNotes] = useState<Note[]>(
    initialNotes.filter((n) => n.point_id == null)
  );
  const authorNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of noteAuthors) {
      if (a.name) map.set(a.author_id, a.name);
    }
    return map;
  }, [noteAuthors]);
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
  /** Is the process card open? Closed on a fresh upload; a failed one
   *  opens itself, because its reason and its retry are why anyone is
   *  looking at this screen. */
  const [processOpen, setProcessOpen] = useState(match.status === "failed");
  const [spokenOpen, setSpokenOpen] = useState(false);
  const spokenRows = cleanSpoken(match.spoken_scores);
  /** The browser refused the raw file (usually HEVC in a .mov). */
  const [undecodable, setUndecodable] = useState(false);

  /**
   * The file behind this row is gone for good, which today means the
   * content check turned the video down and removed it. Nothing to watch
   * and nothing to process, so the page narrows to the reason and a way
   * to clear the row out. Distinct from `undecodable`, where the file is
   * fine and this browser simply cannot play it.
   */
  const sourceGone = rawUrl == null && match.status === "failed";

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

  // Tools-card plumbing, mirroring the processed page: sheet switches,
  // the details panel toggle, live row statuses, and the Notes jump
  // target. Same rows, minus the ones that need points to exist.
  const [shareOpen, setShareOpen] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const notesRef = useRef<HTMLElement | null>(null);
  const [shareLinkCount, setShareLinkCount] = useState<number | null>(null);
  const [coachShared, setCoachShared] = useState<boolean | null>(null);
  const loadToolStatus = useCallback(async () => {
    if (!isOwner) return;
    const supabase = createClient();
    const [links, coach] = await Promise.all([
      supabase
        .from("share_links")
        .select("id", { count: "exact", head: true })
        .eq("match_id", match.id)
        .is("revoked_at", null),
      supabase
        .from("coach_links")
        .select("id")
        .eq("player_id", userId)
        .neq("status", "revoked")
        .or(`scope_match_id.eq.${match.id},scope_match_id.is.null`)
        .limit(1),
    ]);
    if (typeof links.count === "number") setShareLinkCount(links.count);
    if (coach.data) setCoachShared(coach.data.length > 0);
  }, [isOwner, match.id, userId]);
  useEffect(() => {
    void loadToolStatus();
  }, [loadToolStatus]);

  // Default share-link title material. No player names exist before
  // processing, so this is the opponent-field half of the processed
  // page's rule: "Adil vs Marco" typed whole is kept, a bare name gets
  // "vs", nothing falls back to the sheet's own "My match".
  const shareNames = useMemo(() => {
    const opp = opponent.trim();
    if (!opp) return null;
    if (/\bvs\b/i.test(opp)) return opp;
    return `vs ${opp}`;
  }, [opponent]);

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
  // upload time; the player itself is the backfill. Driven by the
  // player's loadedmetadata rather than timeupdate: a cut starts paused,
  // so a video nobody plays would never report anything.
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
        .select("id, status, progress, user_message, kind")
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
        // The job the owner just asked for, so the bar appears at once
        // rather than waiting for the first poll to name its kind.
        kind: "deadspace_cut",
      });
    } finally {
      setBusy(false);
    }
  };

  // Called from the confirm sheet only — the settings menu item opens the
  // sheet, the sheet's red pill deletes. Same two-beat shape as before,
  // now matching where the processed page keeps its delete.
  const remove = async () => {
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

  // "Running" means work the OWNER started. Every upload also queues an
  // automatic table tennis content check against the same match, and that
  // job is queued and processing within seconds of the file landing — so
  // opening a fresh upload painted a progress bar and a "you can leave
  // this page" line before anyone had pressed Process, then corrected
  // itself a minute later. It reads as processing you did not ask for and
  // are being charged for.
  //
  // Filtered here rather than in the query on purpose: the same job also
  // carries the rejection sentence for a video the check turns down, and
  // dropping content_check from the fetch would take the reason with it.
  const jobRunning =
    job != null &&
    job.kind !== "content_check" &&
    (job.status === "queued" || job.status === "processing");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6">
      <header className="mb-5 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="min-w-0 truncate text-2xl font-bold tracking-tight text-zinc-50 sm:text-3xl">
              {title}
            </h1>
            {/* Match settings: the one whole-match action, in the same
                gear the processed page keeps its own. */}
            {isOwner && !jobRunning && (
              <span className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setSettingsOpen((o) => !o)}
                  aria-expanded={settingsOpen}
                  aria-label="Match settings"
                  title="Match settings"
                  className={`rounded-full p-1.5 transition-colors ${
                    settingsOpen
                      ? "text-cyan-glow"
                      : "text-zinc-600 hover:text-zinc-300"
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
                    />
                  </svg>
                </button>
                {settingsOpen && (
                  <>
                    <button
                      type="button"
                      aria-label="Close menu"
                      onClick={() => setSettingsOpen(false)}
                      className="fixed inset-0 z-10 cursor-default"
                    />
                    <div className="absolute right-0 top-9 z-20 w-52 overflow-hidden rounded-2xl border border-edge/80 bg-ink/95 py-1.5 shadow-xl shadow-black/50 backdrop-blur-xl">
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsOpen(false);
                          setConfirmDelete(true);
                        }}
                        className="flex w-full items-center gap-2.5 whitespace-nowrap px-3.5 py-2 text-left text-[13px] font-medium text-red-400 transition-colors hover:bg-red-500/10"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-4 w-4 shrink-0"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"
                          />
                        </svg>
                        Delete video
                      </button>
                    </div>
                  </>
                )}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            {new Date(match.played_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
            {duration != null && <> · {formatClock(duration)}</>}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="rounded-full border border-edge px-3 py-1 text-xs text-zinc-400">
            {jobRunning
              ? "Processing"
              : match.status === "failed"
                ? "Processing failed"
                : "Not processed"}
          </span>
          {/* The score called out at the phone. Before processing there
              is no other score in the product, so this is its moment:
              league night, entering the result somewhere. Muted and
              labelled, because it is testimony rather than the scored
              record the player will make later. */}
          {spokenRows.length > 0 && (
            <SpokenGamesToggle
              rows={spokenRows}
              open={spokenOpen}
              onToggle={() => setSpokenOpen((o) => !o)}
              className="text-base"
            />
          )}
        </div>
      </header>
      {spokenOpen && spokenRows.length > 0 && (
        <div className="-mt-2 mb-4 flex justify-end">
          <SpokenLine rows={spokenRows} className="text-sm font-semibold" />
        </div>
      )}

      {/* The same player the rest of the app uses, in its cut mode:
          tap to play, double-tap either half for ±10s, pinch to zoom,
          press and hold for speed. It was a bare <video controls> — the
          browser's own chrome, on the one screen where someone is deciding
          whether a video they just paid to store is worth processing.

          Sized on the wrapper, never the video: a media element has no
          intrinsic size until metadata arrives. */}
      <div className="overflow-hidden rounded-2xl border border-edge bg-black">
        {rawUrl && !undecodable ? (
          <ClipPlayer
            src={rawUrl}
            mode="cut"
            tall
            // Deciding whether a video is worth processing means actually
            // watching it, and a whole match in a card is a squint.
            landscape
            // Nothing here draws on a frame — videoRef is only read for
            // the trim bar's currentTime — and R2's presigned URLs answer
            // a CORS request with nothing, so asking costs a failed
            // request and a reload on every open of this page. The point
            // sheet and the coach workspace DO capture frames, so they
            // keep it.
            readPixels={false}
            videoElRef={videoRef}
            onLoadedMetadata={onMetadata}
            onMediaError={() => setUndecodable(true)}
          />
        ) : rawUrl ? (
          /* A phone records HEVC in a .mov and plenty of desktop browsers
             will not decode it. The native player at least showed its own
             failure; a custom one would show a black rectangle, so the
             dead end has to be said out loud — and it is genuinely
             temporary, since the processed cut is H.264. */
          <div className="p-8 text-center">
            <p className="text-sm text-zinc-300">
              This browser can&apos;t play this file.
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-500">
              It&apos;s uploaded and safe. Phones record in a format some
              desktop browsers don&apos;t support; the version you get after
              processing plays everywhere. You can still process it from
              here, or watch it on your phone.
            </p>
          </div>
        ) : sourceGone ? (
          /* The reason, at the place the video used to be. This row used
             to be deleted outright, so the card simply disappeared from
             the library and the only account of it was an email. */
          <div className="p-8 text-center">
            <p className="text-sm text-zinc-300">
              {job?.user_message ?? "This video couldn't be processed."}
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-500">
              The file has been removed and nothing was charged for it. If
              this was a match, upload it again and it will go through.
            </p>
          </div>
        ) : (
          <p className="p-8 text-center text-sm text-zinc-400">
            The video file is not available.
          </p>
        )}
      </div>

      {jobRunning && (
        <section className="mt-4 rounded-2xl border border-edge bg-surface p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Processing
          </h2>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
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

      {/* Directly under the player, and above the details form. Stamping
          "Start here" means watching for the moment to stamp, and the
          handles are read against the picture — both of which stop working
          the instant the video scrolls off the screen. It sat below the
          details for one release and the scrolling was the first thing
          anyone noticed. */}
      {isOwner && !jobRunning && commerceEnabled && !sourceGone && (
        <section className="mt-4 overflow-hidden rounded-2xl border border-edge bg-surface">
          {/* Closed by default. This screen's job is "watch this and
              decide", and it used to open on a trim bar, two settings and
              a price. Closed it states the offer and the cost in one line;
              the controls are one click down for whoever wants them. Same
              shape as the details card below. A FAILED match opens itself,
              because its reason and its retry are the whole point. */}
          <button
            type="button"
            onClick={() => setProcessOpen((v) => !v)}
            aria-expanded={processOpen}
            className="flex w-full items-center gap-3 p-5 text-left transition-colors hover:bg-ink/20"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-zinc-100">
                Break it into points
              </span>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Every rally as its own clip
              </span>
            </span>
            {charge != null && (
              <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-300">
                {charge} min
              </span>
            )}
            <svg
              viewBox="0 0 24 24"
              className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${
                processOpen ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {match.status === "failed" && (
            <p className="px-5 pb-5 text-sm text-amber-300/90">
              {job?.user_message ??
                "Processing failed, and your minutes came back."}
            </p>
          )}

          {processOpen && (
          <div className="border-t border-edge/60 p-5">
          {duration == null ? (
            <p className="text-sm text-zinc-400">
              Play the video once so we can read its length.
            </p>
          ) : (
            <>
              {/* No paragraph here. The bar reads 0:00 · 12:04 kept · 12:04
                  under itself and the two buttons say what they do, so a
                  sentence explaining them only pushes the handles further
                  from the picture they are cut against. */}
              <p className="text-sm font-medium text-zinc-200">
                What to process
              </p>
              <div className="mt-3" />
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
                  className="rounded-full border border-edge px-3.5 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
                >
                  Start here
                </button>
                <button
                  onClick={stampEnd}
                  className="rounded-full border border-edge px-3.5 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
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
              <div className="mt-5 divide-y divide-edge/60 rounded-xl border border-edge bg-ink/20">
                <div className="flex items-center justify-between gap-4 p-3.5">
                  <div>
                    <p className="text-sm text-zinc-200">Placement maps</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Where each serve landed. Adds processing time.
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
                  <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-lg border border-edge bg-ink/40 p-1">
                    {(["tight", "normal", "loose"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setStrictness(s)}
                        aria-pressed={strictness === s}
                        className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                          strictness === s
                            ? "bg-cyan-glow text-ink"
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

              {/* Full width, with the balance under it rather than
                  floating alongside. A hugging pill beside a loose
                  sentence was the scrappiest thing on this screen. */}
              <div className="mt-6">
                <button
                  onClick={process}
                  disabled={busy || !enough}
                  className="glow-cta w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink transition-opacity disabled:opacity-40 sm:max-w-xs"
                >
                  {charge != null ? `Process · ${charge} min` : "Process"}
                </button>
                {minutesBalance != null && (
                  <p
                    className={`mt-2 w-full text-center text-xs sm:max-w-xs ${
                      enough ? "text-zinc-500" : "text-amber-300/90"
                    }`}
                  >
                    {enough
                      ? `${formatMinutes(minutesBalance)} left`
                      : `Not enough minutes. You have ${formatMinutes(minutesBalance)}.`}
                  </p>
                )}
                {charge != null && minutesBalance != null && !enough && (
                  <a
                    href="/account"
                    className="mx-auto mt-3 block w-fit rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-200 hover:border-zinc-500"
                  >
                    Get more minutes
                  </a>
                )}
              </div>
            </>
          )}
          {error && <p className="mt-3 text-sm text-amber-300/90">{error}</p>}
          </div>
          )}
        </section>
      )}

      {/* The processed page's Tools card, minus the rows that need points
          to exist — Score Keeper, Highlights, Placement and Match analysis
          appear once processing creates them. Same rows, same order, same
          chrome, so the page reads as the same product either side of
          processing. A rejected upload (sourceGone) keeps only the rows
          that don't touch the video. */}
      {isOwner && (
        <section className="mt-8">
          <SectionHeading>Tools</SectionHeading>
          <div className="mt-3 w-full divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface lg:grid lg:grid-cols-3 lg:gap-3 lg:divide-y-0 lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent">
            {!sourceGone && (
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className={TOOL_ROW_CLASS}
              >
                <span className="text-sm font-semibold">Share</span>
                <span className="flex shrink-0 items-center gap-2">
                  {shareLinkCount !== null && (
                    <span
                      className={`shrink-0 text-xs tabular-nums ${
                        shareLinkCount > 0 ? "text-zinc-400" : "text-zinc-500"
                      }`}
                    >
                      {shareLinkCount > 0
                        ? `${shareLinkCount} link${shareLinkCount === 1 ? "" : "s"}`
                        : "Not shared"}
                    </span>
                  )}
                  <ToolRowChevron />
                </span>
              </button>
            )}
            {!sourceGone && (
              <button
                type="button"
                onClick={() => setCoachOpen(true)}
                className={TOOL_ROW_CLASS}
              >
                <span className="text-sm font-semibold">Coach</span>
                <span className="flex shrink-0 items-center gap-2">
                  {coachShared !== null && (
                    <span
                      className={`shrink-0 text-xs ${
                        coachShared ? "text-zinc-400" : "text-zinc-500"
                      }`}
                    >
                      {coachShared ? "Shared" : "Invite your coach"}
                    </span>
                  )}
                  <ToolRowChevron />
                </span>
              </button>
            )}
            {!sourceGone && <RawExportRow matchId={match.id} />}
            <button
              type="button"
              onClick={() =>
                notesRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                })
              }
              className={TOOL_ROW_CLASS}
            >
              <span className="text-sm font-semibold">Notes</span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={`shrink-0 text-xs ${
                    notes.length > 0 ? "text-zinc-400" : "text-zinc-500"
                  }`}
                >
                  {notes.length > 0
                    ? `${notes.length} note${notes.length === 1 ? "" : "s"}`
                    : "Add a note"}
                </span>
                <ToolRowChevron />
              </span>
            </button>
            {!sourceGone && (
              <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                aria-expanded={detailsOpen}
                className={TOOL_ROW_CLASS}
              >
                <span className="text-sm font-semibold">Match details</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="min-w-0 shrink truncate text-xs text-zinc-400">
                    {[opponent.trim(), venue.trim()]
                      .filter(Boolean)
                      .join(" · ") || "Add opponent and venue"}
                  </span>
                  <ToolRowChevron />
                </span>
              </button>
            )}
            {!sourceGone && rawUrl && (
              <button
                type="button"
                onClick={() => setSideOpen(true)}
                className={TOOL_ROW_CLASS}
              >
                <span className="text-sm font-semibold">Your side</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span
                    className={`shrink-0 text-xs ${
                      userSide !== null ? "text-zinc-400" : "text-zinc-500"
                    }`}
                  >
                    {userSide === "near"
                      ? "Bottom of video"
                      : userSide === "far"
                        ? "Top of video"
                        : "Set your side"}
                  </span>
                  <ToolRowChevron />
                </span>
              </button>
            )}
            <Link
              href={`/feedback?matchId=${match.id}`}
              className={TOOL_ROW_CLASS}
            >
              <span className="text-sm font-semibold">Report an issue</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="shrink-0 text-xs text-zinc-500">
                  Something look off?
                </span>
                <ToolRowChevron />
              </span>
            </Link>
          </div>
        </section>
      )}

      {isOwner && !sourceGone && detailsOpen && (
        <section className="mt-3 rounded-2xl border border-edge bg-surface p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold text-zinc-100">Match details</h2>
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
                  className="w-full rounded-xl border border-edge bg-ink/40 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/60"
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
                className="mt-1 w-full rounded-xl border border-edge bg-ink/40 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/60"
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
                          ? "border-cyan-400/60 bg-cyan-glow/15 text-cyan-glow"
                          : "border-edge bg-ink/40 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

          </div>
        </section>
      )}

      {/* match-level notes (point_id null), the processed page's closing
          section. People who keep the rally whole still debrief. The Tools
          "Notes" row jumps here, exactly as it does after processing. */}
      <section ref={notesRef} className="mt-8 scroll-mt-32">
        <SectionHeading>Overall notes</SectionHeading>
        {notes.length > 0 && (
          <ul className="mt-4 space-y-3">
            {notes.map((n) => (
              <NoteItem
                key={n.id}
                note={n}
                matchId={match.id}
                ownerId={match.user_id}
                viewerId={userId}
                authorName={authorNames.get(n.author_id)}
              />
            ))}
          </ul>
        )}
        <div className="mt-4">
          <NoteComposer
            matchId={match.id}
            pointId={null}
            userId={userId}
            placeholder="How did the match go?"
            onNoteAdded={(note) => setNotes((ns) => [...ns, note])}
          />
        </div>
      </section>

      {/* public-link share sheet — the same single share entry the
          processed page has. Starred/tag rows disable themselves at zero
          and the score toggle hides unscored, so the sheet needs no raw
          variant. */}
      {isOwner && (
        <ShareSheet
          open={shareOpen}
          onClose={() => {
            setShareOpen(false);
            void loadToolStatus();
          }}
          matchId={match.id}
          starredCount={0}
          userId={userId}
          names={shareNames}
          scored={false}
        />
      )}

      {/* coach invite sheet, from the Tools "Coach" row. Touches nothing
          but coach_links, so it works identically before processing. */}
      {isOwner && (
        <ShareWithCoachSheet
          open={coachOpen}
          onClose={() => {
            setCoachOpen(false);
            void loadToolStatus();
          }}
          userId={userId}
          matchId={match.id}
        />
      )}

      {/* "Your side" sheet, from the Tools row — PickSide against the raw
          file, since there is no cut yet. If the browser cannot decode
          the file, PickSide says so and the match page asks again once
          the H.264 cut exists. */}
      {isOwner && sideOpen && rawUrl && (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setSideOpen(false)}
            className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-edge bg-surface p-5 pb-8 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Which player are you?</h2>
              <button
                type="button"
                onClick={() => setSideOpen(false)}
                aria-label="Close"
                className="rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="mt-4">
              <PickSide
                src={rawUrl}
                atSeconds={60}
                selected={userSide}
                onPick={(s) => {
                  setUserSide(s);
                  void saveDetails({ user_side: s });
                  setSideOpen(false);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* delete confirm — opened from the header gear, same home as the
          processed page's delete. */}
      {isOwner && confirmDelete && (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setConfirmDelete(false)}
            className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-edge bg-surface p-5 pb-8 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-5">
            <h2 className="text-base font-semibold">Delete this video?</h2>
            <p className="mt-1 text-sm text-zinc-400">
              It comes off your library for good.
            </p>
            {error && <p className="mt-2 text-sm text-amber-300/90">{error}</p>}
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-400 hover:border-zinc-500"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 hover:border-amber-400/60 hover:text-amber-200 disabled:opacity-50"
              >
                Delete video
              </button>
            </div>
          </div>
        </div>
      )}
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
          ? "border-cyan-glow/60 bg-cyan-glow/30"
          : "border-edge bg-surface-2"
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
