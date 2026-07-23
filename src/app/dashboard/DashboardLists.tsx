"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { computeMatchScore, sortPoints } from "@/app/match/[id]/gameScore";
import type { Job, Match, MatchStatus, Point, SharedPlayer } from "@/lib/types";

// v1 polls every 10s for simplicity. Upgrade path: Supabase Realtime.
const POLL_MS = 10_000;

type MatchRow = Match & { points: { count: number }[] };

/** match_reels via the owner-scoped RLS select (dashboard Reels section). */
type ReelRow = {
  match_id: string;
  status: string;
  duration_s: number | null;
  manifest: { you_name?: string; them_name?: string } | null;
  updated_at: string;
};

/** Just enough of a point to run computeMatchScore for the score chips
 *  (game_end_override included so overridden boundaries — and therefore
 *  the games chip — match the match page's walk). */
type PointLite = Pick<
  Point,
  | "id"
  | "match_id"
  | "idx"
  | "t0"
  | "is_let"
  | "confirmed_winner"
  | "game_end_override"
>;

const matchChips: Record<
  MatchStatus,
  { label: string; chip: string; dot: string }
> = {
  processing: {
    label: "Processing",
    chip: "border-amber-400/40 bg-amber-400/10 text-amber-300",
    dot: "bg-amber-400",
  },
  ready: {
    label: "Ready",
    chip: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    dot: "bg-emerald-400",
  },
  failed: {
    label: "Failed",
    chip: "border-red-400/40 bg-red-400/10 text-red-300",
    dot: "bg-red-400",
  },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function monthLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatBytes(n: number) {
  const GB = 1024 ** 3;
  const MB = 1024 ** 2;
  if (n >= GB * 0.95) return `${(n / GB).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(n / MB))} MB`;
}

function fmtDuration(d: number) {
  const s = Math.max(0, Math.round(d));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Chip({ s }: { s: { label: string; chip: string; dot: string } }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function DashboardLists({ userId }: { userId: string }) {
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [sharedPlayers, setSharedPlayers] = useState<SharedPlayer[]>([]);
  const [reels, setReels] = useState<ReelRow[]>([]);
  const [shareTitles, setShareTitles] = useState<Map<string, string>>(
    new Map()
  );
  const [pointsLite, setPointsLite] = useState<PointLite[]>([]);
  const [query, setQuery] = useState("");
  const [processedOpen, setProcessedOpen] = useState(false);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [reelBusy, setReelBusy] = useState<string | null>(null);
  const [reelError, setReelError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmMatch, setConfirmMatch] = useState<MatchRow | null>(null);
  const [confirmBytes, setConfirmBytes] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    // RLS returns own matches plus matches shared by players who accepted
    // this user as a coach; coach_players() supplies their display names.
    // match_reels and share_links are owner-scoped by RLS, so those come
    // back for own matches only. Points feed the compact rows' score chips.
    const [matchRes, jobRes, playersRes, reelRes, titleRes, pointRes] =
      await Promise.all([
        supabase
          .from("matches")
          .select("*, points(count)")
          .order("created_at", { ascending: false }),
        supabase
          .from("jobs")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase.rpc("coach_players"),
        supabase
          .from("match_reels")
          .select("match_id, status, duration_s, manifest, updated_at")
          .order("updated_at", { ascending: false }),
        supabase
          .from("share_links")
          .select("match_id, kind, title")
          .is("revoked_at", null)
          .not("title", "is", null),
        supabase
          .from("points")
          .select(
            "id, match_id, idx, t0, is_let, confirmed_winner, game_end_override"
          )
          .eq("deleted", false),
      ]);
    if (matchRes.data) setMatches(matchRes.data as MatchRow[]);
    if (jobRes.data) setJobs(jobRes.data as Job[]);
    if (playersRes.data) setSharedPlayers(playersRes.data as SharedPlayer[]);
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
    if (pointRes.data) setPointsLite(pointRes.data as PointLite[]);
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

  async function openDeleteConfirm(m: MatchRow) {
    setMenuFor(null);
    setConfirmMatch(m);
    setConfirmBytes(null);
    setDeleteError(null);
    try {
      const res = await fetch("/api/delete-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", matchId: m.id }),
      });
      const data = res.ok ? await res.json() : null;
      setConfirmBytes(typeof data?.bytes === "number" ? data.bytes : 0);
    } catch {
      setConfirmBytes(0);
    }
  }

  async function deleteMatch(m: MatchRow) {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/delete-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", matchId: m.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "delete failed");
      }
      setConfirmMatch(null);
      await fetchAll();
    } catch (e) {
      setDeleteError(
        e instanceof Error && e.message !== "delete failed"
          ? e.message
          : "Could not delete the match. Try again."
      );
    } finally {
      setDeleting(false);
    }
  }

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

  const downloadMatch = useCallback(async (matchId: string) => {
    setMenuFor(null);
    try {
      const res = await fetch("/api/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = res.ok ? await res.json() : null;
      if (data?.url) window.location.href = data.url;
    } catch {
      // Match page still offers the download.
    }
  }, []);

  // Reel actions: presigned GET (download) or the OS share sheet with the
  // actual file — same flow as the match page's ReelBar.
  const reelUrl = useCallback(async (matchId: string) => {
    const res = await fetch("/api/media-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId, reel: true }),
    });
    const data = res.ok ? await res.json() : null;
    if (!data?.url) throw new Error("no url");
    return data.url as string;
  }, []);

  const downloadReel = useCallback(
    async (matchId: string) => {
      setReelBusy(matchId);
      setReelError(null);
      try {
        window.location.href = await reelUrl(matchId);
      } catch {
        setReelError("Couldn't create a download link. Try again shortly.");
      } finally {
        setReelBusy(null);
      }
    },
    [reelUrl]
  );

  const shareReel = useCallback(
    async (matchId: string) => {
      setReelBusy(matchId);
      setReelError(null);
      try {
        const url = await reelUrl(matchId);
        try {
          const blob = await (await fetch(url)).blob();
          const file = new File([blob], "ponglens-reel.mp4", {
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

  // Own matches vs matches other players shared with this user (coach).
  const ownMatches = (matches ?? []).filter((m) => m.user_id === userId);
  const sharedMatches = (matches ?? []).filter((m) => m.user_id !== userId);
  const playerName = new Map(
    sharedPlayers.map((p) => [p.player_id, p.player_name])
  );
  const sharedByPlayer = new Map<string, MatchRow[]>();
  for (const m of sharedMatches) {
    const list = sharedByPlayer.get(m.user_id) ?? [];
    list.push(m);
    sharedByPlayer.set(m.user_id, list);
  }
  const matchById = new Map(ownMatches.map((m) => [m.id, m]));

  // Confirmed games score per match (compact rows' score chip), computed
  // with the same gameScore walk the match page uses.
  const scoreChipByMatch = useMemo(() => {
    const byMatch = new Map<string, PointLite[]>();
    for (const p of pointsLite) {
      const list = byMatch.get(p.match_id) ?? [];
      list.push(p);
      byMatch.set(p.match_id, list);
    }
    const chips = new Map<string, string>();
    for (const [matchId, pts] of byMatch) {
      const score = computeMatchScore(sortPoints(pts as Point[]));
      if (score.confirmedCount === 0) continue;
      chips.set(
        matchId,
        score.games.length > 0
          ? `${score.gamesYou}-${score.gamesThem}`
          : `${score.current.you}-${score.current.them}`
      );
    }
    return chips;
  }, [pointsLite]);

  // Jobs that asked for points but whose match row doesn't exist yet show
  // in the matches list as processing entries. Everything else (legacy
  // cut-only work) lives under Processed videos.
  const matchJobIds = new Set(ownMatches.map((m) => m.job_id));
  const pendingPointJobs = (jobs ?? []).filter(
    (j) =>
      j.options?.points === true &&
      !matchJobIds.has(j.id) &&
      (j.status === "queued" || j.status === "processing")
  );
  // Processed videos: legacy cut-only jobs, plus finished point jobs that
  // never got a match row (their cut video is still worth surfacing).
  // Internal job kinds (reel renders, reclips) never belong here — reels
  // have their own section and reclips are invisible plumbing.
  const downloadJobs = (jobs ?? []).filter(
    (j) =>
      j.kind !== "reel" &&
      j.kind !== "reclip" &&
      (j.options?.points !== true ||
        (!matchJobIds.has(j.id) &&
          (j.status === "done" || j.status === "failed")))
  );
  const jobById = new Map((jobs ?? []).map((j) => [j.id, j]));

  // Quiet search (only shown past 10 matches): client-side filter on
  // opponent/player names.
  const q = query.trim().toLowerCase();
  const filteredOwn = q
    ? ownMatches.filter((m) =>
        [m.opponent_name, m.player_near_name, m.player_far_name].some((n) =>
          (n ?? "").toLowerCase().includes(q)
        )
      )
    : ownMatches;

  // The 3 most recent keep the rich card; the rest compact under month
  // headers (by played_at).
  const richMatches = filteredOwn.slice(0, 3);
  const olderMatches = [...filteredOwn.slice(3)].sort(
    (a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime()
  );
  const monthGroups: { label: string; items: MatchRow[] }[] = [];
  for (const m of olderMatches) {
    const label = monthLabel(m.played_at);
    const last = monthGroups[monthGroups.length - 1];
    if (last && last.label === label) last.items.push(m);
    else monthGroups.push({ label, items: [m] });
  }

  const hasMatches = ownMatches.length > 0 || pendingPointJobs.length > 0;

  // Overflow menu (Download video / Delete match), shared by rich cards
  // and compact rows (smaller trigger on compact rows).
  const rowMenu = (m: MatchRow, small: boolean) => {
    if (m.status === "processing") return null;
    return (
      <>
        <button
          type="button"
          aria-label="Match options"
          onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}
          className={`absolute text-zinc-500 transition-colors hover:bg-surface-2 hover:text-zinc-200 ${
            small
              ? "right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1.5"
              : "right-1.5 top-1.5 rounded-full p-2"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className={small ? "h-3.5 w-3.5" : "h-4 w-4"}
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="12" cy="5" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="19" r="1.6" />
          </svg>
        </button>
        {menuFor === m.id && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMenuFor(null)}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div
              className={`absolute right-2 z-20 overflow-hidden rounded-xl border border-edge bg-surface shadow-lg ${
                small ? "top-9" : "top-10"
              }`}
            >
              {m.status === "ready" && (
                <button
                  type="button"
                  onClick={() => void downloadMatch(m.id)}
                  className="block w-full px-4 py-2.5 text-left text-sm font-medium text-zinc-200 transition-colors hover:bg-cyan-glow/10"
                >
                  Download video
                </button>
              )}
              <button
                type="button"
                onClick={() => void openDeleteConfirm(m)}
                className="block w-full px-4 py-2.5 text-left text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
              >
                Delete match
              </button>
            </div>
          </>
        )}
      </>
    );
  };

  return (
    <div className="space-y-12">
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your matches</h2>
          {!loading && hasMatches && (
            <span className="text-xs text-zinc-500">
              refreshes every 10 seconds
            </span>
          )}
        </div>

        {/* quiet search: only once the list is long enough to need it */}
        {!loading && ownMatches.length > 10 && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search matches"
            aria-label="Search matches"
            autoComplete="off"
            className="mt-4 w-full rounded-xl border border-edge bg-surface-2/40 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
          />
        )}

        {loading ? (
          <div className="mt-4 space-y-3">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-2xl border border-edge bg-surface"
              />
            ))}
          </div>
        ) : !hasMatches ? (
          <div className="mt-4 rounded-2xl border border-edge bg-surface p-10 text-center">
            <p className="text-3xl">🏓</p>
            <p className="mt-3 font-medium text-zinc-200">No matches yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500">
              Upload your first match. When processing finishes it will appear
              here, broken into points and ready to review.
            </p>
            <Link
              href="/upload"
              className="glow-cta mt-5 inline-block rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink"
            >
              Upload a match
            </Link>
          </div>
        ) : q && filteredOwn.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">
            No matches for &ldquo;{query.trim()}&rdquo;.
          </p>
        ) : (
          <>
            <ul className="mt-4 space-y-3">
              {pendingPointJobs.map((job) => (
                <li
                  key={job.id}
                  className="rounded-2xl border border-edge bg-surface p-5"
                >
                  <div className="flex items-center gap-3">
                    <Chip
                      s={
                        job.status === "queued"
                          ? {
                              label: "Queued",
                              chip: "border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow",
                              dot: "bg-cyan-glow pulse-cyan",
                            }
                          : matchChips.processing
                      }
                    />
                    <span className="text-xs text-zinc-500">
                      {timeAgo(job.created_at)}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-sm font-medium text-zinc-200">
                    {job.original_name ?? "Match"}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {formatDate(job.created_at)}
                    {job.status === "processing" && job.progress > 0
                      ? ` · ${job.progress}%`
                      : ""}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    We&apos;ll email you when it&apos;s ready.
                  </p>
                </li>
              ))}

              {richMatches.map((m) => {
                const s = matchChips[m.status] ?? matchChips.processing;
                const count = m.points?.[0]?.count ?? 0;
                const job = m.job_id ? jobById.get(m.job_id) : undefined;
                const inner = (
                  <>
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <Chip s={s} />
                        <span className="text-xs text-zinc-500">
                          {timeAgo(m.created_at)}
                        </span>
                      </div>
                      <p className="mt-2 truncate text-sm font-medium text-zinc-200">
                        {m.opponent_name?.trim() || "Match"}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {formatDate(m.played_at)}
                        {m.status === "ready"
                          ? ` · ${count} point${count === 1 ? "" : "s"}`
                          : ""}
                        {m.status === "processing" &&
                        job &&
                        job.progress > 0 &&
                        job.status !== "done"
                          ? ` · ${job.progress}%`
                          : ""}
                      </p>
                    </div>
                    {m.status === "ready" && (
                      <svg
                        viewBox="0 0 24 24"
                        className="h-5 w-5 shrink-0 text-zinc-500"
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
                    )}
                  </>
                );
                return (
                  <li key={m.id} className="relative">
                    {m.status === "ready" ? (
                      <Link
                        href={`/match/${m.id}`}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-edge bg-surface p-5 pr-10 transition-colors hover:border-cyan-glow/40"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className="flex items-center justify-between gap-3 rounded-2xl border border-edge bg-surface p-5 pr-10">
                        {inner}
                      </div>
                    )}
                    {rowMenu(m, false)}
                  </li>
                );
              })}
            </ul>

            {/* older matches: compact rows under month headers */}
            {monthGroups.map((group) => (
              <div key={group.label} className="mt-6">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  {group.label}
                </h3>
                <ul className="mt-2 space-y-2">
                  {group.items.map((m) => {
                    const chip = scoreChipByMatch.get(m.id);
                    const inner = (
                      <>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-200">
                            {m.opponent_name?.trim() || "Match"}
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-500">
                            {formatDate(m.played_at)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {m.status === "ready" && chip && (
                            <span className="rounded-full border border-edge bg-ink/40 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-300">
                              {chip}
                            </span>
                          )}
                          {m.status !== "ready" && (
                            <span
                              className={`text-[11px] font-medium ${
                                m.status === "failed"
                                  ? "text-red-400"
                                  : "text-amber-300"
                              }`}
                            >
                              {m.status === "failed"
                                ? "Failed"
                                : "Processing"}
                            </span>
                          )}
                        </div>
                      </>
                    );
                    return (
                      <li key={m.id} className="relative">
                        {m.status === "ready" ? (
                          <Link
                            href={`/match/${m.id}`}
                            className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-surface px-4 py-3 pr-9 transition-colors hover:border-cyan-glow/40"
                          >
                            {inner}
                          </Link>
                        ) : (
                          <div className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-surface px-4 py-3 pr-9">
                            {inner}
                          </div>
                        )}
                        {rowMenu(m, true)}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </>
        )}
      </section>

      {/* rendered starred-point reels (owner only via RLS) */}
      {!loading && reels.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Reels</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Highlight videos rendered from your starred points.
          </p>
          <ul className="mt-4 space-y-3">
            {reels.map((r) => {
              const m = matchById.get(r.match_id);
              const you = (r.manifest?.you_name ?? "").trim();
              const them = (r.manifest?.them_name ?? "").trim();
              const title =
                shareTitles.get(r.match_id) ??
                (you && them
                  ? `${you} vs ${them}`
                  : m?.opponent_name?.trim()
                    ? `vs ${m.opponent_name.trim()}`
                    : "Highlight reel");
              const rendering =
                r.status === "queued" || r.status === "rendering";
              const busy = reelBusy === r.match_id;
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
                            void shareReel(r.match_id);
                          }}
                          aria-label="Share reel"
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
                          void downloadReel(r.match_id);
                        }}
                        aria-label="Download reel"
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
                <li key={r.match_id}>
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

      {/* coach view: matches other players shared via accepted coach links */}
      {!loading && sharedByPlayer.size > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Shared with me</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Matches players shared with you. Open one to watch and leave
            coach notes.
          </p>
          <div className="mt-4 space-y-6">
            {[...sharedByPlayer.entries()].map(([playerId, list]) => (
              <div key={playerId}>
                <h3 className="text-sm font-semibold text-zinc-300">
                  {playerName.get(playerId) ?? "Player"}
                </h3>
                <ul className="mt-2 space-y-3">
                  {list.map((m) => {
                    const count = m.points?.[0]?.count ?? 0;
                    return (
                      <li key={m.id}>
                        <Link
                          href={`/match/${m.id}`}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-edge bg-surface p-5 transition-colors hover:border-amber-400/40"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-3">
                              <Chip s={matchChips[m.status] ?? matchChips.processing} />
                              <span className="text-xs text-zinc-500">
                                {timeAgo(m.created_at)}
                              </span>
                            </div>
                            <p className="mt-2 truncate text-sm font-medium text-zinc-200">
                              {m.opponent_name?.trim()
                                ? `vs. ${m.opponent_name.trim()}`
                                : "Match"}
                            </p>
                            <p className="mt-0.5 text-xs text-zinc-500">
                              {formatDate(m.played_at)}
                              {m.status === "ready"
                                ? ` · ${count} point${count === 1 ? "" : "s"}`
                                : ""}
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
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m9 6 6 6-6 6"
                            />
                          </svg>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
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
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m6 9 6 6 6-6"
                />
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
                          : {
                              label: "Queued",
                              chip: "border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow",
                              dot: "bg-cyan-glow pulse-cyan",
                            };
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

      {/* Delete match confirmation */}
      {confirmMatch && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-6">
            <h3 className="text-lg font-semibold text-zinc-100">
              Delete this match?
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              {confirmBytes === null
                ? "Checking how much space this frees…"
                : `This frees ${formatBytes(confirmBytes)}. `}
              {confirmBytes !== null &&
                "Clips, video, notes, and the scorecard are deleted. This cannot be undone."}
            </p>
            {deleteError && (
              <p className="mt-3 text-sm text-red-400">{deleteError}</p>
            )}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setConfirmMatch(null);
                  setDeleteError(null);
                }}
                disabled={deleting}
                className="flex-1 rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteMatch(confirmMatch)}
                disabled={deleting || confirmBytes === null}
                className="flex-1 rounded-full bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-400 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete match"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
