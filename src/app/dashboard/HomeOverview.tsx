"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Job, NoteFeedRow, SharedPlayer } from "@/lib/types";
import { deriveMatchTitleParts } from "@/lib/matchTitle";
import { YourGame } from "./YourGame";
import {
  Chip,
  Thumb,
  fmtDuration,
  formatDate,
  matchChips,
  neutralTitleFields,
  queuedChip,
  timeAgo,
  useThumbs,
  type MatchRow,
  type ReelRow,
} from "@/app/dashboard/shared";

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
}: {
  userId: string;
  /** Viewer's account first name — feeds neutral-match title detection. */
  accountName: string | null;
}) {
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [reels, setReels] = useState<ReelRow[]>([]);
  const [shareTitles, setShareTitles] = useState<Map<string, string>>(
    new Map()
  );
  const [sharedPlayers, setSharedPlayers] = useState<SharedPlayer[]>([]);
  const [notes, setNotes] = useState<NoteFeedRow[]>([]);
  const [processedOpen, setProcessedOpen] = useState(false);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [reelBusy, setReelBusy] = useState<string | null>(null);
  const [reelError, setReelError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    const [matchRes, jobRes, reelRes, titleRes, playersRes, noteRes] =
      await Promise.all([
        supabase
          .from("matches")
          .select("*, points(count)")
          .order("created_at", { ascending: false }),
        supabase
          .from("jobs")
          .select("*")
          .order("created_at", { ascending: false }),
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
      ]);
    if (matchRes.data) setMatches(matchRes.data as MatchRow[]);
    if (jobRes.data) setJobs(jobRes.data as Job[]);
    if (reelRes.data) setReels(reelRes.data as ReelRow[]);
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
  }, []);

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
  const matchJobIds = new Set(ownMatches.map((m) => m.job_id));
  const pendingPointJobs = (jobs ?? []).filter(
    (j) =>
      j.options?.points === true &&
      !matchJobIds.has(j.id) &&
      (j.status === "queued" || j.status === "processing")
  );
  const processingMatches = ownMatches.filter(
    (m) => m.status === "processing"
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
    <div className="space-y-12">
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
            notes — for yourself or a coach.
          </p>
          <Link
            href="/upload"
            className="glow-cta mt-6 inline-block rounded-full bg-cyan-glow px-7 py-3 text-sm font-semibold text-ink"
          >
            Upload a match
          </Link>
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
                Continue
              </p>
              <p className="mt-1 truncate text-base font-semibold text-zinc-100">
                {titleFor(latestReady)}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {formatDate(latestReady.played_at)} ·{" "}
                {latestReady.points?.[0]?.count ?? 0} points
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

      {/* Recent matches */}
      {!loading && recentPool.length > 0 && (
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {ownMatches.length > 0 ? "Recent matches" : "Shared with me"}
            </h2>
            <ArrowLink href="/matches" label="View all" />
          </div>
          <ul className="mt-4 space-y-3">
            {recent.map((m) => {
              const s = matchChips[m.status] ?? matchChips.processing;
              const count = m.points?.[0]?.count ?? 0;
              const job = m.job_id ? jobById.get(m.job_id) : undefined;
              const bits: string[] = [formatDate(m.played_at)];
              if (m.user_id !== userId)
                bits.unshift(playerName.get(m.user_id) ?? "Shared");
              if (m.status === "ready")
                bits.push(`${count} point${count === 1 ? "" : "s"}`);
              if (
                m.status === "processing" &&
                job &&
                job.progress > 0 &&
                job.status !== "done"
              )
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
                    <p className="mt-1 truncate text-xs text-zinc-500">
                      {bits.join(" · ")}
                    </p>
                  </div>
                </>
              );
              return (
                <li key={m.id}>
                  {m.status === "ready" ? (
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
            <h2 className="text-lg font-semibold">Coaching</h2>
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

      {/* Notes snapshot -> Improve */}
      {!loading && notes.length > 0 && (
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Latest notes</h2>
            <ArrowLink href="/journal" label="Journal" />
          </div>
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
        </section>
      )}

      {/* No notes yet: one quiet line, only once there's something to note */}
      {!loading && notes.length === 0 && latestReady && (
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

      {/* rendered match exports — starred + full (owner only via RLS) */}
      {!loading && reels.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Exports</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Rendered videos of your matches and starred points.
          </p>
          <ul className="mt-4 space-y-3">
            {reels.map((r) => {
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
          {reelError && (
            <p className="mt-3 text-sm text-red-400">{reelError}</p>
          )}
        </section>
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
    </div>
  );
}
