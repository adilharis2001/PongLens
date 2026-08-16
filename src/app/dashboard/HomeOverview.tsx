"use client";

import Link from "next/link";
import { SectionHeading } from "@/components/SectionHeading";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CameraGuide } from "@/components/CameraGuide";
import { createClient } from "@/lib/supabase/client";
import { BalancesCard } from "@/components/BalancesCard";
import type { Job, NoteFeedRow, SharedPlayer } from "@/lib/types";
import { deriveMatchTitleParts } from "@/lib/matchTitle";
import { FirstSteps } from "./FirstSteps";
import { YourGame } from "./YourGame";
import {
  Chip,
  Thumb,
  chipForMatch,
  fetchPaged,
  fetchPointsPaged,
  fmtDuration,
  formatDate,
  liveJobFor,
  matchChips,
  neutralTitleFields,
  queuedChip,
  timeAgo,
  useScoreChips,
  useThumbs,
  type MatchRow,
  type PointLite,
  type ReelRow,
  type ScoreChip,
} from "@/app/dashboard/shared";

/** Home's point rows: the chip fields plus starred, for the hero. */
type HomePoint = PointLite & { starred: boolean };

/** The library's games-score pill, cyan you / magenta them. */
function ScorePill({ chip }: { chip: ScoreChip }) {
  return (
    <span
      title={chip.complete ? "Final games score" : "Scoring in progress"}
      className="shrink-0 whitespace-nowrap rounded-full border border-edge bg-ink/50 px-2 py-0.5 text-[11px] font-semibold tabular-nums"
    >
      <span className="text-cyan-glow">{chip.you}</span>
      <span className="px-0.5 text-zinc-600">-</span>
      <span className="text-magenta-glow">{chip.them}</span>
    </span>
  );
}

// v1 polls every 10s for simplicity. Upgrade path: Supabase Realtime.
const POLL_MS = 10_000;

/** How many matches Home previews before pointing at the library. */
const RECENT_COUNT = 3;

function ArrowLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-medium text-cyan-glow transition-colors hover:text-white"
    >
      {label}
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
      </svg>
    </Link>
  );
}

/**
 * Home is the overview: one next action, a preview of recent matches, the
 * latest notes, and exports that are ready — each section linking into the
 * deeper surface (Matches, Improve, the match pages) instead of duplicating
 * it. Match management (search, filters, delete) lives in the library.
 */
export function HomeOverview({
  userId,
  accountName,
  firstStepsDismissed = false,
  commerceEnabled = false,
}: {
  userId: string;
  /** Viewer's account first name — feeds neutral-match title detection. */
  accountName: string | null;
  /** user_metadata.first_steps_dismissed, read by the server page. */
  firstStepsDismissed?: boolean;
  /** 096: shows the minutes-and-storage line at the bottom. */
  commerceEnabled?: boolean;
}) {
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [reels, setReels] = useState<ReelRow[]>([]);
  const [shareTitles, setShareTitles] = useState<Map<string, string>>(
    new Map()
  );
  const [sharedPlayers, setSharedPlayers] = useState<SharedPlayer[]>([]);
  const [pointsLite, setPointsLite] = useState<HomePoint[]>([]);
  const [cues, setCues] = useState<{ id: string; label: string }[]>([]);
  const [notes, setNotes] = useState<NoteFeedRow[]>([]);
  const [processedOpen, setProcessedOpen] = useState(false);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [reelBusy, setReelBusy] = useState<string | null>(null);
  const [reelError, setReelError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    const [matchRes, jobRows, reelRes, titleRes, playersRes, noteRes, cueRes] =
      await Promise.all([
        supabase
          .from("matches")
          .select("*, points(count)")
          .order("created_at", { ascending: false }),
        // Paged, not filtered: unlike the library, Home's Processed list
        // shows finished jobs too, so it genuinely needs the history and
        // can't just ask for the active ones.
        fetchPaged<Job>(
          (from, to) =>
            supabase
              .from("jobs")
              .select("*")
              // Content checks (097) are housekeeping, never a card.
              .neq("kind", "content_check")
              .order("created_at", { ascending: false })
              .order("id")
              .range(from, to),
          "jobs"
        ),
        supabase
          .from("match_reels")
          .select("match_id, scope, status, duration_s, manifest, updated_at")
          .order("updated_at", { ascending: false }),
        supabase
          .from("share_links")
          .select("match_id, kind, title")
          .is("revoked_at", null)
          .not("title", "is", null),
        supabase.rpc("coach_players"),
        supabase.rpc("note_feed", { p_limit: 6 }),
        supabase
          .from("focus_points")
          .select("id, label")
          .eq("user_id", userId)
          .is("retired_at", null)
          .order("created_at"),
      ]);
    if (matchRes.data) setMatches(matchRes.data as MatchRow[]);
    setJobs(jobRows);
    if (reelRes.data) setReels(reelRes.data as ReelRow[]);

    // Score chips for the cards Home actually shows (recent + Continue):
    // a scoped fetch, not the library's all-points pull — this runs on
    // every poll.
    const chipIds = ((matchRes.data ?? []) as MatchRow[])
      .filter((m) => m.status === "ready")
      .slice(0, 12)
      .map((m) => m.id);
    if (chipIds.length > 0) {
      // Paged: 12 matches already reach ~900 point rows on a real library,
      // and PostgREST truncates at 1000 without saying so — a short array
      // reads to the score walk as a short match, not a missing page.
      const ps = await fetchPointsPaged<HomePoint>(
        "id, match_id, idx, t0, is_let, confirmed_winner, game_end_override, starred",
        chipIds
      );
      setPointsLite(ps);
    }
    if (titleRes.data) {
      // Reel row titles: prefer the match link's title, else the starred
      // link's (point-link titles name a single point — skip those).
      const map = new Map<string, string>();
      const rows = titleRes.data as {
        match_id: string;
        kind: string;
        title: string | null;
      }[];
      for (const kind of ["starred", "match"]) {
        for (const r of rows) {
          if (r.kind === kind && r.title) map.set(r.match_id, r.title);
        }
      }
      setShareTitles(map);
    }
    if (playersRes.data) setSharedPlayers(playersRes.data as SharedPlayer[]);
    if (noteRes.data) setNotes(noteRes.data as NoteFeedRow[]);
    if (cueRes.data)
      setCues(cueRes.data as { id: string; label: string }[]);
  }, [userId]);

  useEffect(() => {
    void fetchAll();
    const id = setInterval(() => void fetchAll(), POLL_MS);
    const onCreated = () => void fetchAll();
    window.addEventListener("ponglens:job-created", onCreated);
    return () => {
      clearInterval(id);
      window.removeEventListener("ponglens:job-created", onCreated);
    };
  }, [fetchAll]);

  // Native file share support (reel rows offer it where it works).
  useEffect(() => {
    try {
      const f = new File([""], "reel.mp4", { type: "video/mp4" });
      setCanShareFiles(
        typeof navigator.share === "function" &&
          typeof navigator.canShare === "function" &&
          navigator.canShare({ files: [f] })
      );
    } catch {
      setCanShareFiles(false);
    }
  }, []);

  async function download(job: Job) {
    if (!job.result_path) return;
    setDownloading(job.id);
    setDownloadError(null);
    try {
      const res = await fetch("/api/download-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.url) throw new Error("no url");
      window.location.href = data.url;
    } catch {
      setDownloadError("Couldn't create a download link. Try again shortly.");
    } finally {
      setDownloading(null);
    }
  }

  // Export actions: presigned GET (download) or the OS share sheet with the
  // actual file — same flow as the match page's ReelBar.
  const reelUrl = useCallback(async (matchId: string, scope: string) => {
    const res = await fetch("/api/media-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId, reel: true, scope }),
    });
    const data = res.ok ? await res.json() : null;
    if (!data?.url) throw new Error("no url");
    return data.url as string;
  }, []);

  const downloadReel = useCallback(
    async (matchId: string, scope: string) => {
      setReelBusy(`${matchId}:${scope}`);
      setReelError(null);
      try {
        window.location.href = await reelUrl(matchId, scope);
      } catch {
        setReelError("Couldn't create a download link. Try again shortly.");
      } finally {
        setReelBusy(null);
      }
    },
    [reelUrl]
  );

  const shareReel = useCallback(
    async (matchId: string, scope: string) => {
      setReelBusy(`${matchId}:${scope}`);
      setReelError(null);
      try {
        const url = await reelUrl(matchId, scope);
        try {
          const blob = await (await fetch(url)).blob();
          const file = new File([blob], "ponglens-export.mp4", {
            type: "video/mp4",
          });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file] });
            return;
          }
        } catch (e) {
          // user dismissed the OS sheet: done, don't force a download
          if (e instanceof DOMException && e.name === "AbortError") return;
        }
        window.location.href = url;
      } catch {
        setReelError("Couldn't prepare the video. Try again shortly.");
      } finally {
        setReelBusy(null);
      }
    },
    [reelUrl]
  );

  const loading = matches === null || jobs === null;
  const ownMatches = (matches ?? []).filter((m) => m.user_id === userId);
  const sharedMatches = (matches ?? []).filter((m) => m.user_id !== userId);
  const playerName = new Map(
    sharedPlayers.map((p) => [p.player_id, p.player_name])
  );
  const matchById = new Map((matches ?? []).map((m) => [m.id, m]));
  const jobById = new Map((jobs ?? []).map((j) => [j.id, j]));

  // Jobs that asked for points but whose match row doesn't exist yet are
  // the "currently processing" signal alongside processing match rows.
  //
  // Excluded by match_id as well as job_id: commerce mode writes the match
  // first and the worker links the job later, so counting on job_id alone
  // made one video read as "2 matches are processing" for the whole wait.
  const matchJobIds = new Set(ownMatches.map((m) => m.job_id));
  const ownMatchIds = new Set(ownMatches.map((m) => m.id));
  const pendingPointJobs = (jobs ?? []).filter(
    (j) =>
      j.options?.points === true &&
      !matchJobIds.has(j.id) &&
      !ownMatchIds.has(String(j.options?.match_id ?? "")) &&
      (j.status === "queued" || j.status === "processing")
  );
  // A match counts as working when its own row says so OR when a job of
  // its own is still queued or running against it.
  const processingMatches = ownMatches.filter(
    (m) => m.status === "processing" || liveJobFor(m.id, m.job_id, jobs) !== null
  );
  const activeWork = pendingPointJobs.length + processingMatches.length;

  // Legacy cut-only jobs, plus finished point jobs that never got a match
  // row (their cut video is still worth surfacing). Internal job kinds
  // (reel renders, reclips) never belong here.
  const downloadJobs = (jobs ?? []).filter(
    (j) =>
      j.kind !== "reel" &&
      j.kind !== "reclip" &&
      (j.options?.points !== true ||
        (!matchJobIds.has(j.id) &&
          (j.status === "done" || j.status === "failed")))
  );

  // Recent list: own matches first; a coach with no matches of their own
  // sees the matches shared with them instead.
  const recentPool = ownMatches.length > 0 ? ownMatches : sharedMatches;
  const recent = recentPool.slice(0, RECENT_COUNT);
  const latestReady = recentPool.find((m) => m.status === "ready");
  const thumbs = useThumbs(
    useMemo(
      () => recent.filter((m) => m.thumb_path).map((m) => m.id),
      [recent]
    )
  );

  const isEmpty = !loading && recentPool.length === 0 && activeWork === 0;
  const scoreChips = useScoreChips(pointsLite);

  // The hero's "what now" for the Continue card, from the same point rows
  // the chips use. Own matches only — a coach is never told to score
  // someone else's match. Null means the plain date · points line.
  const hero = useMemo(() => {
    if (!latestReady || latestReady.user_id !== userId) return null;
    const pts = pointsLite.filter((p) => p.match_id === latestReady.id);
    if (pts.length === 0) return null;
    const scored = pts.filter((p) => p.confirmed_winner !== null).length;
    const unscored = pts.filter(
      (p) => p.confirmed_winner === null && !p.is_let
    ).length;
    if (unscored > 0 && scored === 0)
      return {
        eyebrow: "Score it",
        line: `${pts.length} points to score`,
      };
    if (unscored > 0)
      return {
        eyebrow: "Keep scoring",
        line: `${unscored} point${unscored === 1 ? "" : "s"} to score`,
      };
    if (!pts.some((p) => p.starred))
      return { eyebrow: "Continue", line: "Scored. Star your best points" };
    return null;
  }, [latestReady, pointsLite, userId]);

  const titleFor = (m: MatchRow) =>
    deriveMatchTitleParts({
      opponentName: m.opponent_name,
      venue: m.venue,
      playedAt: m.played_at,
      ...(m.user_id === userId
        ? neutralTitleFields(m, accountName)
        : { neutral: false, nameA: "", nameB: (m.opponent_name ?? "").trim() }),
    }).primary;

  return (
    <div className="space-y-10">
      {/* Next action */}
      {loading ? (
        <div className="h-32 animate-pulse rounded-2xl border border-edge bg-surface" />
      ) : isEmpty ? (
        <section className="rounded-2xl border border-edge bg-surface p-8 text-center">
          <p className="text-3xl">🏓</p>
          <p className="mt-3 text-lg font-semibold text-zinc-100">
            Upload your first match
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
            PongLens cuts the dead time out of your footage and breaks the
            match into points, so you can review it point by point and add
            notes for yourself or a coach.
          </p>
          <Link
            href="/upload"
            className="glow-cta mt-6 inline-block rounded-full bg-cyan-glow px-7 py-3 text-sm font-semibold text-ink"
          >
            Upload a match
          </Link>
          {/* This is the screen someone sees BEFORE they go to the club,
              which is the only moment camera advice can still change the
              recording. On /upload it is already too late for today. */}
          <div className="mx-auto mt-6 max-w-sm text-left">
            <CameraGuide variant="row" />
          </div>
        </section>
      ) : activeWork > 0 ? (
        <section className="rounded-2xl border border-edge bg-surface p-5">
          <div className="flex items-center gap-3">
            <Chip
              s={
                pendingPointJobs[0]?.status === "queued" &&
                processingMatches.length === 0
                  ? queuedChip
                  : matchChips.processing
              }
            />
            <p className="text-sm font-medium text-zinc-200">
              {activeWork === 1
                ? "Your match is processing"
                : `${activeWork} matches are processing`}
            </p>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Most videos finish in under 30 minutes. We&apos;ll email you when
            it&apos;s ready.
          </p>
          {latestReady && (
            <div className="mt-4 border-t border-edge/60 pt-4">
              <ArrowLink
                href={`/match/${latestReady.id}`}
                label={`Meanwhile: review ${titleFor(latestReady)}`}
              />
            </div>
          )}
        </section>
      ) : latestReady ? (
        <section>
          <Link
            href={`/match/${latestReady.id}`}
            className="flex items-center gap-4 rounded-2xl border border-edge bg-surface p-4 transition-colors hover:border-cyan-glow/40"
          >
            <Thumb
              url={thumbs[latestReady.id]}
              className="h-20 w-32 shrink-0 rounded-xl"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wider text-cyan-glow">
                {hero?.eyebrow ?? "Continue"}
              </p>
              <p className="mt-1 truncate text-base font-semibold text-zinc-100">
                {titleFor(latestReady)}
              </p>
              <p className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                <span className="truncate">
                  {hero
                    ? hero.line
                    : `${formatDate(latestReady.played_at)} · ${
                        latestReady.points?.[0]?.count ?? 0
                      } points`}
                </span>
                {scoreChips.get(latestReady.id) && (
                  <ScorePill chip={scoreChips.get(latestReady.id)!} />
                )}
              </p>
            </div>
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 shrink-0 text-zinc-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
            </svg>
          </Link>
        </section>
      ) : null}

      {/* First steps: the new-account checklist. Gone once the account is
          established (a handful of matches), every step is done, or it was
          hidden. Coach-only accounts (shared matches, none of their own)
          never see it — the steps are a player's. */}
      {!loading &&
        ownMatches.length < 5 &&
        !(ownMatches.length === 0 && sharedMatches.length > 0) && (
          <FirstSteps
            userId={userId}
            dismissed={firstStepsDismissed}
            hasUpload={ownMatches.length > 0 || (jobs ?? []).length > 0}
            hasReel={reels.length > 0}
            latestReadyId={
              latestReady && latestReady.user_id === userId
                ? latestReady.id
                : null
            }
          />
        )}

      {/* Recent matches */}
      {!loading && recentPool.length > 0 && (
        <section>
          <div className="flex items-center justify-between">
            <SectionHeading>
              {ownMatches.length > 0 ? "Recent matches" : "Shared with me"}
            </SectionHeading>
            <ArrowLink href="/matches" label="View all" />
          </div>
          <ul className="mt-4 space-y-3">
            {recent.map((m) => {
              // The card used to read matchChips[m.status] straight, so a
              // match whose job was already running showed "Not processed"
              // directly under a banner saying it was processing.
              const live = liveJobFor(m.id, m.job_id, jobs);
              const s = chipForMatch(m.status, live);
              const count = m.points?.[0]?.count ?? 0;
              const job = live ?? (m.job_id ? jobById.get(m.job_id) : undefined);
              const bits: string[] = [formatDate(m.played_at)];
              if (m.user_id !== userId)
                bits.unshift(playerName.get(m.user_id) ?? "Shared");
              if (m.status === "ready")
                bits.push(`${count} point${count === 1 ? "" : "s"}`);
              // How long the video runs, in the m:ss shape every phone
              // shows. It was on the library card and the match page but
              // not here, so the same video read differently per surface.
              if (m.status !== "ready" && m.duration_s)
                bits.push(fmtDuration(m.duration_s));
              if (live && job && job.progress > 0 && job.status !== "done")
                bits.push(`${job.progress}%`);
              const inner = (
                <>
                  <Thumb
                    url={thumbs[m.id]}
                    className="h-16 w-26 shrink-0 rounded-lg sm:w-28"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <p className="truncate text-sm font-medium text-zinc-200">
                        {titleFor(m)}
                      </p>
                      {m.status !== "ready" && <Chip s={s} />}
                    </div>
                    <p className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                      <span className="truncate">{bits.join(" · ")}</span>
                      {m.status === "ready" && scoreChips.get(m.id) && (
                        <ScorePill chip={scoreChips.get(m.id)!} />
                      )}
                    </p>
                  </div>
                </>
              );
              return (
                <li key={m.id}>
                  {m.status === "ready" || m.status === "uploaded" ? (
                    <Link
                      href={`/match/${m.id}`}
                      className="flex items-center gap-3.5 rounded-2xl border border-edge bg-surface p-3 transition-colors hover:border-cyan-glow/40"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3.5 rounded-2xl border border-edge bg-surface p-3">
                      {inner}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Your game: the staged stats showcase. Below Recent matches on
          purpose — footage is the value prop, stats are the reward — and
          the card itself stays hidden until 3 fully scored matches. */}
      {!loading && <YourGame userId={userId} accountName={accountName} />}

      {/* Coaching: players sharing their matches with this viewer. Only
          when the viewer also has matches of their own — a pure coach's
          Recent list IS the shared matches already. */}
      {!loading && sharedPlayers.length > 0 && ownMatches.length > 0 && (
        <section>
          <div className="flex items-center justify-between">
            <SectionHeading>Coaching</SectionHeading>
            <ArrowLink href="/matches" label="All matches" />
          </div>
          <ul className="mt-4 space-y-2.5">
            {sharedPlayers.map((p) => {
              const theirs = sharedMatches.filter(
                (m) => m.user_id === p.player_id
              );
              const latest = theirs.find((m) => m.status === "ready");
              const inner = (
                <>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-200">
                      {(p.player_name ?? "").trim() || "Player"}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {theirs.length} match{theirs.length === 1 ? "" : "es"}{" "}
                      shared
                      {latest ? ` · latest ${formatDate(latest.played_at)}` : ""}
                    </p>
                  </div>
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4 shrink-0 text-zinc-500"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m9 6 6 6-6 6"
                    />
                  </svg>
                </>
              );
              return (
                <li key={p.player_id}>
                  <Link
                    href={latest ? `/match/${latest.id}` : "/matches"}
                    className="flex items-center justify-between gap-3 rounded-xl border border-edge border-l-2 border-l-amber-400/60 bg-surface px-4 py-3 transition-colors hover:border-amber-400/40"
                  >
                    {inner}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Working on: the player's active cues, the journal's first page
          carried onto Home. Hidden until a cue exists. */}
      {!loading && cues.length > 0 && (
        <section>
          <div className="flex items-center justify-between">
            <SectionHeading>Working on</SectionHeading>
            <ArrowLink href="/journal" label="Journal" />
          </div>
          <Link
            href="/journal"
            className="mt-4 flex flex-wrap gap-2 rounded-2xl border border-edge bg-surface p-4 transition-colors hover:border-cyan-glow/40"
          >
            {cues.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-2 rounded-full border border-edge bg-surface-2/60 px-3 py-1.5 text-sm text-zinc-200"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-glow"
                  aria-hidden="true"
                />
                {c.label}
              </span>
            ))}
          </Link>
        </section>
      )}

      {/* Latest activity: recent notes and rendered exports in one
          section — the five-section budget's fifth. */}
      {!loading && (notes.length > 0 || reels.length > 0) && (
        <section>
          <div className="flex items-center justify-between">
            <SectionHeading>Latest activity</SectionHeading>
            <ArrowLink href="/journal" label="Journal" />
          </div>
          {notes.length > 0 && (
          <ul className="mt-4 space-y-2.5">
            {notes.slice(0, 2).map((n) => {
              const m = matchById.get(n.match_id);
              const isMine = n.author_id === userId;
              const author = isMine
                ? "You"
                : (n.author_name ?? "").trim() ||
                  (n.author_id === n.match_owner_id ? "Player" : "Coach");
              const matchTitle = m
                ? titleFor(m)
                : deriveMatchTitleParts({
                    opponentName: n.opponent_name,
                    venue: n.venue,
                    playedAt: n.played_at,
                    neutral: false,
                    nameA: "",
                    nameB: (n.opponent_name ?? "").trim(),
                  }).primary;
              return (
                <li key={n.id}>
                  <Link
                    href={`/match/${n.match_id}${
                      n.point_id ? `?p=${n.point_id}` : ""
                    }`}
                    className={`block rounded-xl border border-edge bg-surface px-4 py-3 transition-colors hover:border-cyan-glow/40 ${
                      isMine ? "" : "border-l-2 border-l-amber-400/60"
                    }`}
                  >
                    <p className="text-xs text-zinc-500">
                      {author} · {matchTitle} · {timeAgo(n.created_at)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-200">
                      {n.body.trim() || (n.audio_path ? "Voice note" : "")}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
          )}

          {/* rendered exports ride along, capped to stay compact */}
          {reels.length > 0 && (
          <ul className="mt-4 space-y-3">
            {reels.slice(0, 3).map((r) => {
              const m = matchById.get(r.match_id);
              const you = (r.manifest?.you_name ?? "").trim();
              const them = (r.manifest?.them_name ?? "").trim();
              const kindLabel =
                r.scope === "full" ? "Full match" : "Starred points";
              const base =
                shareTitles.get(r.match_id) ??
                (you && them
                  ? `${you} vs ${them}`
                  : m?.opponent_name?.trim()
                    ? `vs ${m.opponent_name.trim()}`
                    : "Match export");
              const title = `${base} · ${kindLabel}`;
              const rendering =
                r.status === "queued" || r.status === "rendering";
              const busy = reelBusy === `${r.match_id}:${r.scope}`;
              const inner = (
                <>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-200">
                      {title}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {m ? formatDate(m.played_at) : formatDate(r.updated_at)}
                      {" · "}
                      {rendering ? (
                        <span className="text-amber-300">Rendering…</span>
                      ) : r.status === "failed" ? (
                        <span className="text-red-400">Failed</span>
                      ) : r.duration_s !== null ? (
                        <span className="tabular-nums">
                          {fmtDuration(Number(r.duration_s))}
                        </span>
                      ) : (
                        "Ready"
                      )}
                    </p>
                  </div>
                  {r.status === "ready" && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      {canShareFiles && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void shareReel(r.match_id, r.scope);
                          }}
                          aria-label="Share export"
                          className="rounded-full border border-edge p-2 text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-50"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M12 15V4m0 0L8 8m4-4 4 4M6 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"
                            />
                          </svg>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void downloadReel(r.match_id, r.scope);
                        }}
                        aria-label="Download export"
                        className="rounded-full border border-edge p-2 text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-50"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className={`h-4 w-4 ${busy ? "animate-pulse" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 19h14"
                          />
                        </svg>
                      </button>
                    </div>
                  )}
                </>
              );
              return (
                <li key={`${r.match_id}:${r.scope}`}>
                  {m ? (
                    <Link
                      href={`/match/${m.id}`}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-edge bg-surface p-4 transition-colors hover:border-cyan-glow/40"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-edge bg-surface p-4">
                      {inner}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          )}
          {reelError && (
            <p className="mt-3 text-sm text-red-400">{reelError}</p>
          )}
        </section>
      )}

      {/* Nothing yet: one quiet line, only once there's something to note */}
      {!loading && notes.length === 0 && reels.length === 0 && latestReady && (
        <p className="text-sm text-zinc-500">
          Notes you add while reviewing a match collect in your{" "}
          <Link
            href="/journal"
            className="font-medium text-zinc-300 underline decoration-edge underline-offset-4 transition-colors hover:text-white"
          >
            Journal
          </Link>
          .
        </p>
      )}

      {/* legacy cut-only jobs: collapsed at the bottom */}
      {!loading && downloadJobs.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setProcessedOpen((o) => !o)}
            aria-expanded={processedOpen}
            className="flex w-full items-center justify-between rounded-2xl border border-edge/70 bg-surface/50 px-4 py-3 text-left transition-colors hover:border-cyan-glow/30"
          >
            <span className="text-sm font-medium text-zinc-300">
              Processed videos ({downloadJobs.length})
            </span>
            <span className="flex items-center gap-1.5 text-xs text-zinc-500">
              {processedOpen ? "Hide" : "Show"}
              <svg
                viewBox="0 0 24 24"
                className={`h-3.5 w-3.5 transition-transform ${
                  processedOpen ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </button>
          {processedOpen && (
            <>
              <p className="mt-3 text-xs text-zinc-500">
                Videos processed without a point breakdown. Matches keep
                their download on the match page.
              </p>
              <ul className="mt-3 space-y-3">
                {downloadJobs.map((job) => {
                  const s =
                    job.status === "done"
                      ? matchChips.ready
                      : job.status === "failed"
                        ? matchChips.failed
                        : job.status === "processing"
                          ? matchChips.processing
                          : queuedChip;
                  return (
                    <li
                      key={job.id}
                      className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface p-5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <Chip
                            s={
                              job.status === "done"
                                ? { ...s, label: "Done" }
                                : s
                            }
                          />
                          <span className="text-xs text-zinc-500">
                            {timeAgo(job.created_at)}
                          </span>
                        </div>
                        <p className="mt-2 truncate text-sm font-medium text-zinc-200">
                          {job.original_name ?? "Match video"}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          Playtime only · {formatDate(job.created_at)}
                        </p>
                        {job.status === "failed" && job.error && (
                          <p className="mt-1 truncate text-xs text-red-400/80">
                            {job.error}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0">
                        {job.status === "done" && job.result_path ? (
                          <button
                            onClick={() => download(job)}
                            disabled={downloading === job.id}
                            className="glow-cta rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink disabled:opacity-60"
                          >
                            {downloading === job.id
                              ? "Preparing…"
                              : "Download"}
                          </button>
                        ) : job.status === "processing" ? (
                          <span className="text-xs text-zinc-500">
                            {job.progress > 0
                              ? `${job.progress}%`
                              : "working on it…"}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {downloadError && (
                <p className="mt-3 text-sm text-red-400">{downloadError}</p>
              )}
            </>
          )}
        </section>
      )}

      {commerceEnabled && <BalancesCard />}
    </div>
  );
}
