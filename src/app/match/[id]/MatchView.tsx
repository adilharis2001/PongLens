"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Match, Note, Point } from "@/lib/types";
import { deriveMatchTitleParts } from "@/lib/matchTitle";
import { ShareSheet } from "@/components/ShareSheet";
import { ShareWithCoachSheet } from "@/components/ShareWithCoach";
import {
  computeMatchScore,
  sortPoints,
  type GameEndOverride,
} from "./gameScore";
import { ScoreLine } from "./ScoreLine";
import { ReelRow, TOOL_ROW_CLASS, ToolRowChevron } from "./ReelBar";
import { NoteComposer, NoteItem } from "./Notes";
import type { MapLabels } from "./PlacementMap";
import { mappedPointCount, PlacementAggregate } from "./PlacementAggregate";
import { MatchStatistics } from "./MatchStatistics";
import { computeMatchStats, statsRowSummary } from "./matchStats";
import { paddedEnd } from "./playhead";
import { clipPad } from "./clipEdit";
import { Player, type PlayerHandle } from "./Player";
import { PointDetail } from "./PointDetail";
import { PointSheet } from "./PointSheet";
import { PickSide } from "./PickSide";
import { ServerChipMenu } from "./ServerChipMenu";
import {
  computeServing,
  firstServerGuess,
  type MatchServer,
} from "./serving";
import type { Side } from "./sides";

/** Source-video timestamp as m:ss. */
function formatClock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function TrashIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-.9 13a1 1 0 0 1-1 .9H7.9a1 1 0 0 1-1-.9L6 7m4 4v6m4-6v6"
      />
    </svg>
  );
}

const SWIPE_OPEN_PX = -88;

/**
 * Swipe-left on touch devices reveals a red Remove action behind the card.
 * Vertical scrolling is untouched (we only claim clearly horizontal drags);
 * while the action is open, the first tap on the card just closes it.
 */
function SwipeRemoveRow({
  enabled,
  onRemove,
  children,
}: {
  enabled: boolean;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{
    x: number;
    y: number;
    dx: number;
    horizontal: boolean | null;
  } | null>(null);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, dx, horizontal: null };
    },
    [dx]
  );

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const s = start.current;
    if (!s) return;
    const t = e.touches[0];
    const moveX = t.clientX - s.x;
    const moveY = t.clientY - s.y;
    if (s.horizontal === null) {
      if (Math.abs(moveX) < 8 && Math.abs(moveY) < 8) return;
      s.horizontal = Math.abs(moveX) > Math.abs(moveY);
    }
    if (!s.horizontal) return;
    setDragging(true);
    setDx(Math.min(0, Math.max(SWIPE_OPEN_PX * 1.25, s.dx + moveX)));
  }, []);

  const onTouchEnd = useCallback(() => {
    const s = start.current;
    start.current = null;
    setDragging(false);
    if (!s || s.horizontal !== true) return;
    setDx((v) => (v < SWIPE_OPEN_PX / 2 ? SWIPE_OPEN_PX : 0));
  }, []);

  if (!enabled) return <>{children}</>;

  return (
    <div className="relative">
      <div
        className={`absolute inset-y-0 right-0 w-24 ${
          dx < 0 ? "" : "pointer-events-none opacity-0"
        }`}
      >
        <button
          type="button"
          onClick={() => {
            setDx(0);
            onRemove();
          }}
          className="flex h-full w-full items-center justify-center rounded-2xl border border-red-400/40 bg-red-500/15 pl-2 text-sm font-semibold text-red-300"
        >
          Remove
        </button>
      </div>
      <div
        style={{
          // Only transform while swiped/dragging: a permanent transform
          // would give every card its own stacking context, and the server
          // chip menu (z-40) would paint under the next card.
          transform: dx !== 0 ? `translateX(${dx}px)` : undefined,
          transition: dragging ? "none" : "transform 0.2s ease",
          touchAction: "pan-y",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClickCapture={(e) => {
          if (dx !== 0) {
            e.preventDefault();
            e.stopPropagation();
            setDx(0);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** lg breakpoint: the split view replaces the sheet from here up. */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

/**
 * Full-video card: the Player's poster (the ONLY match-footage video)
 * plus ONE header action — the ↓ icon for the owner (downloads the cut
 * video directly), a plain Download button for coach viewers. Everything
 * else (score, share, coach, export) lives in the Tools card below.
 * Tapping the poster opens the Player takeover in watch mode.
 *
 * The ↓ stays as a one-tap shortcut for the plain full-match (no-score)
 * download — the most common export. The Tools "Export" row opens the full
 * menu (full match with/without score, starred points, raw upload); this
 * quick affordance is deliberately kept alongside it.
 */
function DownloadCard({
  matchId,
  isOwner,
  children,
}: {
  matchId: string;
  /** Owner gets the quiet ↓ icon; coach viewers the plain Download pill. */
  isOwner: boolean;
  /** The Player (poster preview while closed). */
  children: React.ReactNode;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch("/api/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.url) throw new Error("no url");
      window.location.href = data.url;
    } catch {
      setError("Couldn't create a download link. Try again shortly.");
    } finally {
      setDownloading(false);
    }
  }, [matchId]);

  return (
    <div
      id="full-video-card"
      className="w-full overflow-hidden rounded-2xl border border-edge bg-surface sm:max-w-sm"
    >
      {children}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Full video</p>
          <p className="text-xs text-zinc-500">Playtime only</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isOwner ? (
            <button
              type="button"
              onClick={() => void download()}
              disabled={downloading}
              aria-label="Download video"
              title="Download video"
              className="rounded-full border border-edge px-3 py-2 text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-60"
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-5 w-5 ${downloading ? "animate-pulse" : ""}`}
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
          ) : (
            <button
              type="button"
              onClick={() => void download()}
              disabled={downloading}
              className="glow-cta rounded-full bg-cyan-glow px-3.5 py-2 text-sm font-semibold text-ink disabled:opacity-60"
            >
              {downloading ? "Preparing…" : "Download"}
            </button>
          )}
        </div>
      </div>
      {error && <p className="px-4 pb-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}

export function MatchView({
  match,
  initialPoints,
  initialNotes,
  userId,
  accountName,
  strictness,
}: {
  match: Match;
  initialPoints: Point[];
  initialNotes: Note[];
  userId: string;
  /** The viewer's account first name (Google auth), or null. Used as the
   * owner's own-name fallback wherever a tagged-side name is missing. */
  accountName: string | null;
  strictness: string;
}) {
  const [points, setPoints] = useState<Point[]>(initialPoints);
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [opponentName, setOpponentName] = useState(match.opponent_name ?? "");
  const [userSide, setUserSide] = useState<Side | null>(match.user_side);
  const [nearName, setNearName] = useState(match.player_near_name ?? "");
  const [farName, setFarName] = useState(match.player_far_name ?? "");
  const [firstServer, setFirstServer] = useState<MatchServer | null>(
    match.first_server
  );
  const [activePointId, setActivePointId] = useState<string | null>(null);
  // Header title edit: the title is DERIVED (opponent · venue · date); this
  // flips the opponent input back on for manual fixes (venue lives on the
  // upload form). The derived title stays the header's source of truth.
  const [titleEditing, setTitleEditing] = useState(false);

  // Undo snackbar for "Not a point" soft deletes. Holds the whole deleted
  // set so bulk removals ("delete all before") undo in one tap too.
  const [snackbar, setSnackbar] = useState<{
    text: string;
    pointIds: string[];
  } | null>(null);
  const snackbarTimer = useRef<number | null>(null);
  // Debounce: many quick edits -> ONE reclip job per match.
  const reclipTimer = useRef<number | null>(null);

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackBody, setFeedbackBody] = useState("");
  const [feedbackState, setFeedbackState] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");

  const isOwner = match.user_id === userId;
  const isDesktop = useIsDesktop();

  // The Player: one takeover surface owning the only match-footage video.
  // Its handle opens it inside the entry tap's call stack so video.play()
  // runs synchronously in the user gesture (iOS autoplay requirement).
  const playerRef = useRef<PlayerHandle | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);

  // Public-link ShareSheet target: {} = the whole match, { pointId } = one
  // point. Owner only (the sheet's API calls are owner-scoped anyway).
  const [shareTarget, setShareTarget] = useState<{ pointId?: string } | null>(
    null
  );
  // Coach-invite sheet, opened from the Tools "Coach" row.
  const [coachOpen, setCoachOpen] = useState(false);

  // "Which player are you?" — a snapshot picker against the cut video (a
  // real point of play ~60s in). The first-open banner shows while
  // user_side is still null (session-dismissable, re-shows on a fresh open);
  // the Tools "Your side" row opens the same picker as a change sheet.
  const [sideSheetOpen, setSideSheetOpen] = useState(false);
  const [firstOpenDismissed, setFirstOpenDismissed] = useState(false);
  const [cutPreviewUrl, setCutPreviewUrl] = useState<string | null>(null);

  // Tools-row live statuses (owner only; null = not loaded yet, the row
  // shows no status until the RLS-scoped reads land). Refetched when the
  // share/coach sheets close so a freshly created link shows up.
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

  // One playing video at a time, page-wide. Capture-phase listener on the
  // document so it also covers videos that mount in overlays (point sheet,
  // Keep-score takeover) without threading refs everywhere.
  useEffect(() => {
    const onPlay = (e: Event) => {
      const target = e.target;
      if (!(target instanceof HTMLVideoElement)) return;
      document.querySelectorAll("video").forEach((v) => {
        if (v !== target && !v.paused) v.pause();
      });
    };
    document.addEventListener("play", onPlay, true);
    return () => document.removeEventListener("play", onPlay, true);
  }, []);

  // Opponent name: save on blur / Enter, only when it changed.
  const saveOpponentName = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (trimmed === (match.opponent_name ?? "").trim()) return;
      const supabase = createClient();
      await supabase
        .from("matches")
        .update({ opponent_name: trimmed || null })
        .eq("id", match.id);
      match.opponent_name = trimmed || null;
    },
    [match]
  );

  // The uploader's OWN-side name — the header edit panel's "Your name" field.
  // Prefilled from the tagged side's player name, falling back to the account
  // first name. Mirrors saveOpponentName but writes the user_side's
  // player_*_name column (near when user_side is unset), NEVER opponent_name.
  // Naming this side as a DIFFERENT person is what flips the match to neutral.
  const [ownNameDraft, setOwnNameDraft] = useState(
    (match.user_side === "far"
      ? match.player_far_name
      : match.player_near_name
    )?.trim() || (accountName ?? "")
  );
  const saveOwnName = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      const yourSideIsFar = userSide === "far";
      const current = (
        (yourSideIsFar ? match.player_far_name : match.player_near_name) ?? ""
      ).trim();
      if (trimmed === current) return;
      if (yourSideIsFar) {
        setFarName(trimmed);
        match.player_far_name = trimmed || null;
      } else {
        setNearName(trimmed);
        match.player_near_name = trimmed || null;
      }
      const supabase = createClient();
      await supabase
        .from("matches")
        .update(
          yourSideIsFar
            ? { player_far_name: trimmed || null }
            : { player_near_name: trimmed || null }
        )
        .eq("id", match.id);
    },
    [match, userSide]
  );

  // Venue + match type — the other atomic facts the derived title is built
  // from. Editing the title edits these, since the title itself is derived.
  const [venue, setVenue] = useState(match.venue ?? "");
  const saveVenue = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (trimmed === (match.venue ?? "").trim()) return;
      const supabase = createClient();
      await supabase
        .from("matches")
        .update({ venue: trimmed || null })
        .eq("id", match.id);
      match.venue = trimmed || null;
    },
    [match]
  );
  const [matchType, setMatchType] = useState(match.match_type ?? "");
  const saveMatchType = useCallback(
    async (value: string) => {
      const next = (value || null) as Match["match_type"];
      if (next === (match.match_type ?? null)) return;
      setMatchType(value);
      match.match_type = next;
      const supabase = createClient();
      await supabase
        .from("matches")
        .update({ match_type: next })
        .eq("id", match.id);
    },
    [match]
  );

  const toggleStar = useCallback(async (point: Point) => {
    const next = !point.starred;
    setPoints((ps) =>
      ps.map((p) => (p.id === point.id ? { ...p, starred: next } : p))
    );
    const supabase = createClient();
    const { error } = await supabase
      .from("points")
      .update({ starred: next })
      .eq("id", point.id);
    if (error) {
      setPoints((ps) =>
        ps.map((p) => (p.id === point.id ? { ...p, starred: !next } : p))
      );
    }
  }, []);

  const sendFeedback = useCallback(async () => {
    const body = feedbackBody.trim();
    if (!body) return;
    setFeedbackState("sending");
    const supabase = createClient();
    const { error } = await supabase.from("feedback").insert({
      user_id: userId,
      match_id: match.id,
      body,
    });
    if (error) {
      setFeedbackState("error");
      return;
    }
    setFeedbackBody("");
    setFeedbackState("sent");
  }, [feedbackBody, userId, match.id]);

  const noteCountByPoint = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) {
      if (n.point_id) map.set(n.point_id, (map.get(n.point_id) ?? 0) + 1);
    }
    return map;
  }, [notes]);

  const matchNotes = notes.filter((n) => n.point_id === null);

  // Timeline = non-deleted points in source-video order; display numbers
  // are positions in this list (soft deletes renumber automatically).
  // Removed points collapse at the bottom, recoverable. (The old warmup
  // classifier is gone; any legacy warmup flag is ignored.)
  const orderedPoints = useMemo(() => sortPoints(points), [points]);
  const visiblePoints = useMemo(
    () => orderedPoints.filter((p) => !p.deleted),
    [orderedPoints]
  );
  const removedPoints = useMemo(
    () => orderedPoints.filter((p) => p.deleted),
    [orderedPoints]
  );
  const [removedOpen, setRemovedOpen] = useState(false);
  const score = useMemo(
    () => computeMatchScore(visiblePoints),
    [visiblePoints]
  );

  // Clip context padding for this match's cut (strictness lives on the
  // job): cut_t0 is the PADDED clip start, so every rally-end computation
  // needs these numbers (see playhead.ts).
  const pad = useMemo(() => clipPad(strictness), [strictness]);

  // Deleted points' footage spans inside the cut video (until a reclip
  // regenerates it, their footage is still physically in the file). The
  // Player jumps over these during playback and never lands inside one.
  // Each span runs to the FULL padded end (cut_t0 + pre + rally + post —
  // the same extent the reel route cuts), clamped to the next visible
  // rally's padded start: plays split inside one activity span share
  // footage, so a deleted rally's post pad can poke into the next live
  // rally's pre pad — auto-skip must never swallow a live serve.
  const deletedSpans = useMemo(() => {
    const visibleStarts = orderedPoints
      .filter((p) => !p.deleted && p.cut_t0 !== null)
      .map((p) => Number(p.cut_t0));
    const spans = orderedPoints
      .filter((p) => p.deleted && p.cut_t0 !== null)
      .map((p) => {
        const start = Number(p.cut_t0);
        let end = paddedEnd(p, pad) ?? start;
        const nextStart = visibleStarts.find((s) => s > start + 0.01);
        if (nextStart !== undefined && end > nextStart) end = nextStart;
        return { start, end };
      })
      .filter((s) => s.end > s.start)
      .sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last && s.start <= last.end + 0.01) {
        last.end = Math.max(last.end, s.end);
      } else {
        merged.push({ ...s });
      }
    }
    return merged;
  }, [orderedPoints, pad]);

  // 0-based game index per point, from the confirmed score's boundaries.
  // The placement map needs it: players change ends every game, so the
  // user's physical side flips on odd games (see PlacementMap invariant).
  const gameIndexByPoint = useMemo(() => {
    const map = new Map<string, number>();
    let g = 0;
    for (const p of visiblePoints) {
      map.set(p.id, g);
      if (score.boundaryAfter.has(p.id)) g += 1;
    }
    return map;
  }, [visiblePoints, score]);

  // The uploader's own-side player name (near when user_side is unset,
  // matching /api/reel + ownName). The raw tagged value — no accountName
  // fallback — because it's what decides "neutral" below.
  const ownSideName = (userSide === "far" ? farName : nearName).trim();

  // NEUTRAL / third-party match (~5-10%): the uploader is NOT one of the
  // players — a coach/scout analyzing someone else's match. Detected by the
  // owner naming their own side as someone who isn't the account holder.
  // When neutral, "Me/Them" become the two players' names and the title
  // reads "A vs B" instead of opponent-led. Threaded down to every surface
  // that would otherwise say "Me"/"your". Owner-only: coach viewers already
  // see names, and we only know the ACCOUNT holder's name for the owner.
  const neutral = useMemo(() => {
    if (!isOwner || !ownSideName) return false;
    const acct = (accountName ?? "").trim().toLowerCase();
    return acct === "" || ownSideName.toLowerCase() !== acct;
  }, [isOwner, ownSideName, accountName]);

  // Placement map labels. The user is always drawn at the bottom edge;
  // the near/far pair is the neutral fallback while user_side is unset.
  // In a neutral match "Me" becomes the bottom player's actual name.
  const mapLabels: MapLabels = useMemo(() => {
    const userName =
      (userSide === "near" ? nearName : farName).trim() || "Player";
    return {
      you: isOwner && !neutral ? "Me" : userName,
      them: opponentName.trim() || (isOwner ? "Them" : "Opponent"),
      near: nearName.trim() || "Near player",
      far: farName.trim() || "Far player",
    };
  }, [isOwner, neutral, userSide, nearName, farName, opponentName]);

  // ITTF rotation from first_server (overrides re-anchor downstream);
  // recomputes instantly on any first_server / override / let change.
  const serving = useMemo(
    () => computeServing(visiblePoints, firstServer),
    [visiblePoints, firstServer]
  );
  const serveGuess = useMemo(
    () => firstServerGuess(visiblePoints, userSide),
    [visiblePoints, userSide]
  );

  // Derived match stats (scored points only) + placement-mapped count.
  // Both feed the bottom sections AND their Tools-card rows, so the row
  // summaries and the sections read from one computation.
  const stats = useMemo(
    () => computeMatchStats(visiblePoints, serving, score),
    [visiblePoints, serving, score]
  );
  const mappedCount = useMemo(
    () => mappedPointCount(visiblePoints),
    [visiblePoints]
  );

  // The bottom sections the Tools rows smooth-scroll to (analysis, stats,
  // overall notes) and the Tools card itself (the back-to-top target).
  const matchAnalysisRef = useRef<HTMLDivElement | null>(null);
  const matchStatsRef = useRef<HTMLDivElement | null>(null);
  const notesRef = useRef<HTMLDivElement | null>(null);
  const toolsRef = useRef<HTMLElement | null>(null);
  const scrollToSection = useCallback(
    (ref: React.RefObject<HTMLElement | null>) => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    []
  );

  const saveFirstServer = useCallback(
    async (value: MatchServer) => {
      const prev = firstServer;
      setFirstServer(value);
      const supabase = createClient();
      const { error } = await supabase
        .from("matches")
        .update({ first_server: value })
        .eq("id", match.id);
      if (error) setFirstServer(prev);
      else match.first_server = value;
    },
    [firstServer, match]
  );

  // Desktop always shows a point in the pane (default: the first).
  // Mobile opens the sheet only after a tap.
  const selectedPoint =
    visiblePoints.find((p) => p.id === activePointId) ?? null;
  const panePoint = selectedPoint ?? visiblePoints[0] ?? null;
  const paneIndex = panePoint
    ? visiblePoints.findIndex((p) => p.id === panePoint.id)
    : -1;

  // Running match line AS OF the open point: completed games + current
  // game over the visible points up to and including it. Shown in the
  // point-view headers so a correction pass can watch the score track —
  // it recomputes live as outcomes get flipped.
  const runningScore = useMemo(
    () => computeMatchScore(visiblePoints.slice(0, paneIndex + 1)),
    [visiblePoints, paneIndex]
  );

  const goToIndex = useCallback(
    (i: number) => {
      if (i < 0 || i >= visiblePoints.length) return;
      const id = visiblePoints[i].id;
      setActivePointId(id);
      document
        .getElementById(`point-card-${id}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    [visiblePoints]
  );

  // Point deep links: ?p=<display number or point id> selects a point on
  // load (shared "watch in full" round-trips, future coach point-links).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("p");
    if (!p) return;
    const target =
      visiblePoints.find((pt) => pt.id === p) ??
      (/^\d+$/.test(p) ? visiblePoints[Number(p) - 1] : undefined);
    if (target) setActivePointId(target.id);
    // mount only: the deep link reflects the URL the page opened with
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep ?p= in sync with the selection. history.replaceState (not
  // router.replace) so the shallow URL update never refetches the server
  // component; the existing state object is preserved so Keep-score's
  // pushState/popstate dance keeps working.
  useEffect(() => {
    const url = new URL(window.location.href);
    const i = activePointId
      ? visiblePoints.findIndex((pt) => pt.id === activePointId)
      : -1;
    if (i >= 0) url.searchParams.set("p", String(i + 1));
    else url.searchParams.delete("p");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [activePointId, visiblePoints]);

  // Desktop arrow-key navigation between points (the Player owns the
  // arrow keys while its takeover is up).
  useEffect(() => {
    if (!isDesktop || visiblePoints.length === 0 || playerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const next = e.key === "ArrowDown" || e.key === "ArrowRight";
      const prev = e.key === "ArrowUp" || e.key === "ArrowLeft";
      if (!next && !prev) return;
      const t = e.target as HTMLElement | null;
      if (
        t?.closest(
          'input, textarea, select, video, audio, [contenteditable="true"]'
        )
      )
        return;
      e.preventDefault();
      goToIndex(paneIndex + (next ? 1 : -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDesktop, visiblePoints.length, playerOpen, paneIndex, goToIndex]);

  const updatePoint = useCallback((pointId: string, patch: Partial<Point>) => {
    setPoints((ps) =>
      ps.map((p) => (p.id === pointId ? { ...p, ...patch } : p))
    );
  }, []);

  // Optimistic confirmed_winner write; shared by the card taps and
  // Keep-score mode. confirmed_how stays untouched (set in the point view).
  // Mutual exclusion with is_let: assigning a winner means the rally
  // counted, so a non-null winner clears is_let in the SAME write (a row
  // must never be both a let and a scored point).
  const setWinner = useCallback(
    async (point: Point, next: "user" | "opponent" | null) => {
      const prev = point.confirmed_winner;
      const prevLet = point.is_let;
      const clearLet = next !== null && prevLet;
      if (prev === next && !clearLet) return;
      const patch: Partial<Point> = {
        confirmed_winner: next,
        ...(clearLet ? { is_let: false } : {}),
      };
      updatePoint(point.id, patch);
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update(patch)
        .eq("id", point.id);
      if (error)
        updatePoint(point.id, { confirmed_winner: prev, is_let: prevLet });
    },
    [updatePoint]
  );

  // Inline winner tap on a card: one tap confirms, tapping the same side
  // again clears it. On a skipped point it converts to a winner (setWinner
  // clears is_let in the same write).
  const tapWinner = useCallback(
    (point: Point, side: "user" | "opponent") =>
      setWinner(point, point.confirmed_winner === side ? null : side),
    [setWinner]
  );

  // Optimistic skipped write (is_let column; timeline Skip, Keep-score's
  // Skip pill + its undo, the server-chip menu). Mutual exclusion with
  // confirmed_winner: a skipped point never scores, so skipping clears the
  // winner in the SAME write (DB constraint points_let_never_scored).
  const setSkipped = useCallback(
    async (point: Point, next: boolean) => {
      const prevLet = point.is_let;
      const prevWinner = point.confirmed_winner;
      const clearWinner = next && prevWinner !== null;
      if (prevLet === next && !clearWinner) return;
      const patch: Partial<Point> = {
        is_let: next,
        ...(clearWinner ? { confirmed_winner: null } : {}),
      };
      updatePoint(point.id, patch);
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update(patch)
        .eq("id", point.id);
      if (error)
        updatePoint(point.id, {
          is_let: prevLet,
          confirmed_winner: prevWinner,
        });
    },
    [updatePoint]
  );

  // Inline Skip tap on a card: skip a scored/unscored point, un-skip back
  // to unscored on a second tap.
  const tapSkip = useCallback(
    (point: Point) => setSkipped(point, !point.is_let),
    [setSkipped]
  );

  // Optimistic server correction (the Player's serve ball). Rotation
  // re-anchors from the most recent override, so one fix heals the rest.
  const setServerOverride = useCallback(
    async (point: Point, next: "user" | "opponent") => {
      const prev = point.server_override;
      updatePoint(point.id, { server_override: next });
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update({ server_override: next })
        .eq("id", point.id);
      if (error) updatePoint(point.id, { server_override: prev });
    },
    [updatePoint]
  );

  // Optimistic game-boundary override write (Keep score's pills and the
  // point-detail scorecard line): 'end' closes a game after the point
  // regardless of score, 'continue' holds it open past the auto rule
  // until an explicit 'end', null restores automatic. Every consumer
  // (score line, dividers, serve rotation, side flips, reel manifest)
  // recomputes from the shared walk. Returns success so the scorecard
  // can flash Saved / show its error.
  const setGameEndOverride = useCallback(
    async (point: Point, next: GameEndOverride): Promise<boolean> => {
      const prev = point.game_end_override;
      if (prev === next) return true;
      updatePoint(point.id, { game_end_override: next });
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update({ game_end_override: next })
        .eq("id", point.id);
      if (error) {
        updatePoint(point.id, { game_end_override: prev });
        return false;
      }
      return true;
    },
    [updatePoint]
  );

  const dismissSnackbar = useCallback(() => {
    if (snackbarTimer.current) window.clearTimeout(snackbarTimer.current);
    snackbarTimer.current = null;
    setSnackbar(null);
  }, []);

  // Soft delete: hide from the timeline immediately, undoable for a bit.
  const deletePoint = useCallback(
    async (point: Point) => {
      updatePoint(point.id, { deleted: true });
      // Deleting from the point view advances to the next point (previous
      // at the end) instead of dumping back to the overview; row deletes
      // (no active point) don't open anything.
      setActivePointId((cur) => {
        if (cur !== point.id) return cur;
        const idx = visiblePoints.findIndex((p) => p.id === point.id);
        const next = visiblePoints[idx + 1] ?? visiblePoints[idx - 1] ?? null;
        return next ? next.id : null;
      });
      if (snackbarTimer.current) window.clearTimeout(snackbarTimer.current);
      setSnackbar({ text: "Point removed", pointIds: [point.id] });
      snackbarTimer.current = window.setTimeout(() => setSnackbar(null), 6000);
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update({ deleted: true })
        .eq("id", point.id);
      if (error) {
        updatePoint(point.id, { deleted: false });
        dismissSnackbar();
      }
    },
    [updatePoint, dismissSnackbar, visiblePoints]
  );

  // Player-originated soft delete (score mode's Delete button): same
  // write, but NO snackbar — the takeover sits at z-[80], above the
  // z-[70] snackbar, so it would be invisible; the Player's own undo
  // stack owns recovery there (undo calls undoDelete below). activePointId
  // is untouched: no sheet is involved under the takeover.
  const deletePointQuiet = useCallback(
    async (point: Point) => {
      updatePoint(point.id, { deleted: true });
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update({ deleted: true })
        .eq("id", point.id);
      if (error) updatePoint(point.id, { deleted: false });
    },
    [updatePoint]
  );

  // Undo accepts one id (Player undo stack, Removed list) or a whole set
  // (the bulk snackbar) — either way it's ONE restore write.
  const undoDelete = useCallback(
    async (target: string | string[]) => {
      const ids = new Set(Array.isArray(target) ? target : [target]);
      dismissSnackbar();
      setPoints((ps) =>
        ps.map((p) => (ids.has(p.id) ? { ...p, deleted: false } : p))
      );
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update({ deleted: false })
        .in("id", [...ids]);
      if (error)
        setPoints((ps) =>
          ps.map((p) => (ids.has(p.id) ? { ...p, deleted: true } : p))
        );
    },
    [dismissSnackbar]
  );

  // Bulk soft delete: everything before a point, in ONE batched write.
  // Warm-up rallies and mid-session breaks are real play the detector
  // can't distinguish — the honest fix is the owner finding the first
  // REAL point and sweeping away what came before it. The open point
  // stays open (it becomes point 1); the snackbar Undo restores the set.
  const deleteAllBefore = useCallback(
    async (point: Point) => {
      const idx = visiblePoints.findIndex((p) => p.id === point.id);
      if (idx < 1) return;
      const ids = new Set(visiblePoints.slice(0, idx).map((p) => p.id));
      setPoints((ps) =>
        ps.map((p) => (ids.has(p.id) ? { ...p, deleted: true } : p))
      );
      if (snackbarTimer.current) window.clearTimeout(snackbarTimer.current);
      setSnackbar({
        text: `${ids.size} point${ids.size === 1 ? "" : "s"} removed`,
        pointIds: [...ids],
      });
      snackbarTimer.current = window.setTimeout(() => setSnackbar(null), 8000);
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update({ deleted: true })
        .in("id", [...ids]);
      if (error) {
        setPoints((ps) =>
          ps.map((p) => (ids.has(p.id) ? { ...p, deleted: false } : p))
        );
        dismissSnackbar();
      }
    },
    [visiblePoints, dismissSnackbar]
  );

  // The owner's own name: their tagged side's name (a null user_side falls
  // back to near, matching /api/reel), else the account first name. The
  // account name means we never have to ASK the owner for their own name.
  const ownName = useMemo(() => {
    const tagged = (userSide === "far" ? farName : nearName).trim();
    return tagged || (isOwner ? (accountName ?? "").trim() : "");
  }, [userSide, nearName, farName, isOwner, accountName]);

  // Default share-link title material: "Adil vs Vaibhav" with the owner
  // first when we know their side, else "vs Marco", else null (the sheet
  // falls back to "My match").
  const shareNames = useMemo(() => {
    const near = nearName.trim();
    const far = farName.trim();
    if (near && far)
      return userSide === "far" ? `${far} vs ${near}` : `${near} vs ${far}`;
    const opp = opponentName.trim();
    if (!opp) return null;
    // Owners sometimes type the full matchup ("Adil vs Vaibhav") into the
    // opponent field — don't prefix a second "vs".
    if (/\bvs\b/i.test(opp)) return opp;
    return ownName ? `${ownName} vs ${opp}` : `vs ${opp}`;
  }, [nearName, farName, userSide, opponentName, ownName]);

  // Derived match title as a title/subtitle pair: primary "{opponent} ·
  // {venue}" (the identifying line), secondary "{date} · {type}" (muted).
  // Never stored; shared with the dashboard cards (src/lib/matchTitle.ts)
  // so the two never disagree. Venue is set from the upload form; the
  // header edit below only touches the opponent field.
  const titleParts = useMemo(
    () =>
      deriveMatchTitleParts({
        opponentName,
        venue,
        playedAt: match.played_at,
        matchType,
        neutral,
        nameA: ownSideName,
        nameB: opponentName.trim(),
      }),
    [opponentName, venue, match.played_at, matchType, neutral, ownSideName]
  );

  const hasCutOffsets = visiblePoints.some((p) => p.cut_t0 !== null);

  // Presigned cut-video URL for the side picker — the same inline preview
  // the Player fetches. Loaded lazily the moment the picker could show (the
  // first-open banner while untagged, or the change sheet), so a tagged
  // match that never opens it pays nothing.
  const needSidePicker =
    isOwner &&
    hasCutOffsets &&
    ((userSide === null && !firstOpenDismissed) || sideSheetOpen);
  useEffect(() => {
    if (!needSidePicker || cutPreviewUrl) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/media-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId: match.id, preview: true }),
        });
        const data = res.ok ? await res.json() : null;
        if (data?.url && !cancelled) setCutPreviewUrl(data.url);
      } catch {
        // No frame is fine; the picker keeps its Loading state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needSidePicker, cutPreviewUrl, match.id]);

  // Score placement: lives in the header row while the top of the page is
  // on screen; detaches into the floating pill only once the header (video
  // card area) scrolls away.
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [scoreDetached, setScoreDetached] = useState(false);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setScoreDetached(!entry.isIntersecting),
      { rootMargin: "-80px 0px 0px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // One debounced 'reclip' job per match: skip when one is already queued
  // (a job that is mid-processing may have read the points before the
  // latest edit, so only 'queued' suppresses a new enqueue).
  const enqueueReclip = useCallback(async () => {
    const supabase = createClient();
    const { data: queued } = await supabase
      .from("jobs")
      .select("id")
      .eq("kind", "reclip")
      .eq("status", "queued")
      .contains("options", { match_id: match.id })
      .limit(1);
    if (queued && queued.length > 0) return;
    await supabase
      .from("jobs")
      .insert({ user_id: userId, kind: "reclip", options: { match_id: match.id } });
  }, [match.id, userId]);

  const scheduleReclip = useCallback(() => {
    if (reclipTimer.current) window.clearTimeout(reclipTimer.current);
    reclipTimer.current = window.setTimeout(() => {
      reclipTimer.current = null;
      void enqueueReclip();
    }, 4000);
  }, [enqueueReclip]);

  const addSplitPoint = useCallback((newPoint: Point) => {
    setPoints((ps) =>
      ps.some((p) => p.id === newPoint.id) ? ps : [...ps, newPoint]
    );
  }, []);

  // While clips are regenerating, poll so 'Updating clip' resolves into the
  // fresh clip without a manual refresh. t0/t1 truth lives in Postgres; the
  // video is the only thing arriving late.
  const hasPendingClips = points.some((p) => p.edited && !p.deleted);
  useEffect(() => {
    if (!hasPendingClips) return;
    const supabase = createClient();
    const iv = window.setInterval(() => {
      void (async () => {
        const { data } = await supabase
          .from("points")
          .select("id, t0, t1, clip_path, edited, deleted, tight_start, tight_end")
          .eq("match_id", match.id);
        if (!data) return;
        setPoints((ps) =>
          ps.map((p) => {
            const fresh = data.find((d) => d.id === p.id);
            return fresh ? { ...p, ...fresh } : p;
          })
        );
      })();
    }, 8000);
    return () => window.clearInterval(iv);
  }, [hasPendingClips, match.id]);

  const onTaggingChange = useCallback(
    (patch: {
      userSide?: Side;
      nearName?: string;
      farName?: string;
      opponentName?: string;
    }) => {
      if (patch.userSide !== undefined) setUserSide(patch.userSide);
      if (patch.nearName !== undefined) setNearName(patch.nearName);
      if (patch.farName !== undefined) setFarName(patch.farName);
      if (patch.opponentName !== undefined) {
        setOpponentName(patch.opponentName);
        match.opponent_name = patch.opponentName;
      }
    },
    [match]
  );

  // Set user_side from the placement map's orientation prompt while
  // untagged. Writes exactly what PlayerTagging.chooseSide does — the same
  // columns and the same name-fill — so the two entry points never disagree.
  const handleSetUserSide = useCallback(
    async (side: Side) => {
      const account = (accountName ?? "").trim();
      const opp = opponentName.trim();
      let near = nearName.trim();
      let far = farName.trim();
      if (side === "near") {
        near = near || account;
        far = far || opp;
      } else {
        far = far || account;
        near = near || opp;
      }
      const opponent = (side === "near" ? far : near).trim();
      onTaggingChange({
        userSide: side,
        nearName: near,
        farName: far,
        ...(opponent ? { opponentName: opponent } : {}),
      });
      const supabase = createClient();
      await supabase
        .from("matches")
        .update({
          user_side: side,
          player_near_name: near || null,
          player_far_name: far || null,
          ...(opponent ? { opponent_name: opponent } : {}),
        })
        .eq("id", match.id);
    },
    [accountName, opponentName, nearName, farName, onTaggingChange, match.id]
  );

  // Score-mode names prompt. The reel scorebug renders FULL names — you =
  // your tagged side, them = the other side falling back to opponent_name,
  // with a null user_side treated as near (see /api/reel) — so score mode
  // asks for whichever is missing under that exact mapping. null = both
  // names usable, never prompt.
  // "you" counts the account first name as known (same fallback the reel
  // manifest applies), so score mode only ever asks for a truly unknown
  // opponent — never for the owner's own name.
  const namesPrompt = useMemo(() => {
    if (!isOwner) return null;
    const near = nearName.trim();
    const far = farName.trim();
    const you = (userSide === "far" ? far : near) || (accountName ?? "").trim();
    const them = (userSide === "far" ? near : far) || opponentName.trim();
    if (you && them) return null;
    return { you, them };
  }, [isOwner, userSide, nearName, farName, opponentName, accountName]);

  // The names sheet writes the SAME columns PlayerTagging writes: the
  // per-side name columns under the current side mapping (user_side null
  // falls back to you = near, matching the reel), and opponent_name only
  // when user_side is known (PlayerTagging's opponentFor semantics) — so
  // the two features never disagree.
  const saveNames = useCallback(
    async (you: string, them: string) => {
      const yourSideIsFar = userSide === "far";
      const near = (yourSideIsFar ? them : you).trim();
      const far = (yourSideIsFar ? you : them).trim();
      const opponent =
        userSide === null ? "" : userSide === "near" ? far : near;
      onTaggingChange({
        nearName: near,
        farName: far,
        ...(opponent ? { opponentName: opponent } : {}),
      });
      const supabase = createClient();
      await supabase
        .from("matches")
        .update({
          player_near_name: near || null,
          player_far_name: far || null,
          ...(opponent ? { opponent_name: opponent } : {}),
        })
        .eq("id", match.id);
    },
    [userSide, onTaggingChange, match.id]
  );

  const winnerText = (p: Point) => {
    const won = p.confirmed_winner === "user";
    // Neutral: name the actual player instead of "I"/"They".
    if (neutral) return won ? `${mapLabels.you} won` : `${mapLabels.them} won`;
    if (won) return isOwner ? "I won" : "Player won";
    return isOwner ? "They won" : "Opponent won";
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12 lg:max-w-6xl">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-white"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
        </svg>
        Dashboard
      </Link>

      {/* header — the title gets the full width; the score sits on the
          meta line below it so the two never fight for the same row. */}
      <div className="mt-4" ref={headerRef}>
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight sm:text-3xl">
            {titleParts.primary}
          </h1>
          {isOwner && (
            <button
              type="button"
              onClick={() => setTitleEditing((v) => !v)}
              aria-label="Edit match details"
              title="Edit match details"
              className={`shrink-0 rounded-full p-1.5 transition-colors ${
                titleEditing
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
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1 1-4L16.5 4.5Z"
                />
              </svg>
            </button>
          )}
        </div>

        {/* meta line: date · type on the left, score on the right */}
        <div className="mt-1 flex items-baseline justify-between gap-4">
          <p className="min-w-0 truncate text-sm text-zinc-500">
            {titleParts.secondary}
          </p>
          {score.confirmedCount > 0 && (
            <ScoreLine
              score={score}
              className="shrink-0 text-base font-bold tabular-nums tracking-tight sm:text-lg"
            />
          )}
        </div>

        {/* edit panel: the title is derived, so editing edits the fields */}
        {isOwner && titleEditing && (
          <div className="mt-3 space-y-3 rounded-2xl border border-edge bg-surface p-4 sm:max-w-sm">
            {/* Your name: the uploader's own side. Editing it to someone
                who isn't you turns this into a neutral third-party match —
                the title flips to "A vs B" and "Me" becomes the name. */}
            <label className="block">
              <span className="text-xs font-medium text-zinc-400">
                Your name
              </span>
              <input
                value={ownNameDraft}
                onChange={(e) => setOwnNameDraft(e.target.value)}
                onBlur={(e) => void saveOwnName(e.target.value)}
                placeholder={accountName ?? "Name"}
                aria-label="Your name"
                className="mt-1 w-full rounded-xl border border-edge bg-ink/60 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/60"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-zinc-400">Opponent</span>
              <input
                value={opponentName}
                onChange={(e) => setOpponentName(e.target.value)}
                onBlur={(e) => void saveOpponentName(e.target.value)}
                placeholder="Name"
                aria-label="Opponent name"
                className="mt-1 w-full rounded-xl border border-edge bg-ink/60 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/60"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-zinc-400">Venue</span>
              <input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                onBlur={(e) => void saveVenue(e.target.value)}
                placeholder="Club or location"
                aria-label="Venue"
                className="mt-1 w-full rounded-xl border border-edge bg-ink/60 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/60"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {(["practice", "league", "tournament"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={matchType === t}
                  onClick={() =>
                    void saveMatchType(matchType === t ? "" : t)
                  }
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    matchType === t
                      ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                      : "border-edge bg-ink/40 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setTitleEditing(false)}
              className="rounded-full bg-cyan-glow px-4 py-2 text-sm font-semibold text-ink"
            >
              Done
            </button>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-start gap-3">
          <DownloadCard matchId={match.id} isOwner={isOwner}>
            <Player
              ref={playerRef}
              matchId={match.id}
              points={visiblePoints}
              canScore={isOwner && hasCutOffsets}
              opponentName={opponentName}
              youLabel={mapLabels.you}
              firstServer={firstServer}
              serveGuess={serveGuess}
              serving={serving}
              score={score}
              pad={pad}
              deletedSpans={deletedSpans}
              onDeletePoint={(p) => void deletePointQuiet(p)}
              onUndoDelete={(id) => void undoDelete(id)}
              namesPrompt={namesPrompt}
              onSaveNames={(you, them) => void saveNames(you, them)}
              onSaveFirstServer={(v) => void saveFirstServer(v)}
              onSetWinner={(p, v) => void setWinner(p, v)}
              onSetSkipped={(p, v) => void setSkipped(p, v)}
              onSetServer={(p, v) => void setServerOverride(p, v)}
              onSetGameOverride={(p, v) => void setGameEndOverride(p, v)}
              onToggleStar={(p) => void toggleStar(p)}
              onSplit={(parent, patch, child) => {
                updatePoint(parent.id, patch);
                addSplitPoint(child);
                scheduleReclip();
              }}
              onUnsplit={(parentId, patch, childId) => {
                setPoints((ps) =>
                  ps
                    .filter((p) => p.id !== childId)
                    .map((p) => (p.id === parentId ? { ...p, ...patch } : p))
                );
                scheduleReclip();
              }}
              onMerge={(survivorId, patch, removedIds) => {
                const drop = new Set(removedIds);
                setPoints((ps) =>
                  ps
                    .filter((p) => !drop.has(p.id))
                    .map((p) => (p.id === survivorId ? { ...p, ...patch } : p))
                );
                scheduleReclip();
              }}
              onOpenPoint={(id) => {
                const i = visiblePoints.findIndex((p) => p.id === id);
                if (i >= 0) goToIndex(i);
              }}
              onOpenChange={setPlayerOpen}
            />
          </DownloadCard>
        </div>
      </div>

      {/* Tools: the owner's match actions in one card — score, share
          links, coach invite, export. Coach viewers never see it
          (every row is an owner action). scroll-mt keeps the back-to-top
          jump target clear of the sticky header + floating score pill. */}
      {isOwner && (
        <section className="mt-8 scroll-mt-32" ref={toolsRef}>
          <h2 className="text-lg font-semibold">Tools</h2>
          <div className="mt-3 w-full divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface sm:max-w-sm">
            {hasCutOffsets && (
              <button
                type="button"
                onClick={() => playerRef.current?.openScore()}
                className={TOOL_ROW_CLASS}
              >
                <span className="text-sm font-semibold">Keep score</span>
                <span className="flex shrink-0 items-center gap-2">
                  {score.confirmedCount > 0 && (
                    <ScoreLine
                      score={score}
                      className="shrink-0 text-xs font-semibold tabular-nums"
                    />
                  )}
                  <ToolRowChevron />
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShareTarget({})}
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
            {hasCutOffsets && (
              <ReelRow
                matchId={match.id}
                visiblePoints={visiblePoints}
                canScore={score.confirmedCount > 0}
              />
            )}
            {/* Jump to the bottom analysis sections. Always visible for the
                owner (the sections carry their own zero/teaching states),
                consistent with the always-visible Export row. */}
            <button
              type="button"
              onClick={() => scrollToSection(matchAnalysisRef)}
              className={TOOL_ROW_CLASS}
            >
              <span className="text-sm font-semibold">Match Analysis</span>
              <span className="flex shrink-0 items-center gap-2">
                {mappedCount > 0 && (
                  <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                    {mappedCount} mapped
                  </span>
                )}
                <ToolRowChevron />
              </span>
            </button>
            <button
              type="button"
              onClick={() => scrollToSection(matchStatsRef)}
              className={TOOL_ROW_CLASS}
            >
              <span className="text-sm font-semibold">Match Statistics</span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={`shrink-0 text-xs ${
                    stats.hasData ? "text-zinc-400" : "text-zinc-500"
                  }`}
                >
                  {statsRowSummary(stats)}
                </span>
                <ToolRowChevron />
              </span>
            </button>
            {/* Jump to the overall notes at the bottom — saves the long
                scroll past every point on mobile. */}
            <button
              type="button"
              onClick={() => scrollToSection(notesRef)}
              className={TOOL_ROW_CLASS}
            >
              <span className="text-sm font-semibold">Notes</span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={`shrink-0 text-xs ${
                    matchNotes.length > 0 ? "text-zinc-400" : "text-zinc-500"
                  }`}
                >
                  {matchNotes.length > 0
                    ? `${matchNotes.length} note${matchNotes.length === 1 ? "" : "s"}`
                    : "Add a note"}
                </span>
                <ToolRowChevron />
              </span>
            </button>
            {/* Your side: the one fact that orients maps and "Me" labels.
                Shows the tagged anchor side; tap to change against the cut
                video. Null reads "Set your side" (the first-open banner is
                the primary path). */}
            {hasCutOffsets && (
              <button
                type="button"
                onClick={() => setSideSheetOpen(true)}
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
            {/* Report an issue: a proactive path straight to feedback with
                this match pre-selected, so anything that looks off in the
                recording or scoring gets back to us with context attached. */}
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

      {/* first-open "which player are you?" — a compact banner (not the old
          giant card) shown once a processed match opens still untagged.
          Answering writes user_side (chooseSide name-fill semantics) and it
          collapses; session-dismissable, re-shows on a fresh open. */}
      {isOwner &&
        hasCutOffsets &&
        userSide === null &&
        !firstOpenDismissed && (
          <section className="mt-6 rounded-2xl border border-cyan-glow/30 bg-surface p-4 sm:max-w-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">
                  Which player are you?
                </h2>
                <p className="mt-0.5 text-sm text-zinc-400">
                  So your labels and placement maps come out right.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFirstOpenDismissed(true)}
                aria-label="Not now"
                className="shrink-0 rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:text-white"
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
            <div className="mt-3">
              <PickSide
                src={cutPreviewUrl}
                atSeconds={60}
                onPick={(s) => void handleSetUserSide(s)}
              />
            </div>
          </section>
        )}

      {/* first server: anchors the ITTF serve rotation for every point */}
      {isOwner && firstServer === null && visiblePoints.length > 0 && (
        <div className="mt-6 rounded-2xl border border-cyan-glow/30 bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Who served first?</h2>
              <p className="mt-0.5 text-sm text-zinc-400">
                Sets the serve rotation for the whole match.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {(
                [
                  { value: "user", label: neutral ? mapLabels.you : "Me" },
                  { value: "opponent", label: neutral ? mapLabels.them : "Them" },
                ] as const
              ).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => void saveFirstServer(o.value)}
                  className={`min-w-0 max-w-[45%] rounded-lg border px-5 py-2.5 text-sm font-semibold transition-colors ${
                    serveGuess === o.value
                      ? "border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow"
                      : "border-edge bg-ink/40 text-zinc-300 hover:border-cyan-glow/40"
                  }`}
                >
                  <span className="block truncate">{o.label}</span>
                </button>
              ))}
            </div>
          </div>
          {serveGuess !== null && (
            <p className="mt-2 text-[11px] text-zinc-500">
              Auto-detect thinks{" "}
              {neutral
                ? serveGuess === "user"
                  ? mapLabels.you
                  : mapLabels.them
                : serveGuess === "user"
                  ? "you"
                  : "they"}{" "}
              served first.
            </p>
          )}
        </div>
      )}

      {/* split view on lg+: point list left, sticky detail pane right */}
      <div className="lg:grid lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:items-start lg:gap-8">
        {/* point timeline */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Points</h2>

          {points.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              No point breakdown for this match.
            </p>
          ) : visiblePoints.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              No points in the timeline.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {visiblePoints.map((point, i) => {
                const duration =
                  point.t0 !== null && point.t1 !== null
                    ? Math.max(0, Number(point.t1) - Number(point.t0))
                    : null;
                const noteCount = noteCountByPoint.get(point.id) ?? 0;
                const isActive = isDesktop && panePoint?.id === point.id;
                const nextGame = score.boundaryAfter.get(point.id);
                return (
                  <li key={point.id} id={`point-card-${point.id}`}>
                    <SwipeRemoveRow
                      enabled={isOwner}
                      onRemove={() => void deletePoint(point)}
                    >
                    {/* The whole card opens the point; the explicit controls
                        (server chip, winner taps, star, trash) stop
                        propagation so they never open it. */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setActivePointId(point.id)}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        setActivePointId(point.id);
                      }}
                      aria-current={isActive || undefined}
                      aria-label={`Open point ${i + 1}`}
                      className={`flex cursor-pointer items-center gap-3 rounded-2xl border bg-surface p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-glow/70 ${
                        isActive
                          ? "border-cyan-glow/60"
                          : "border-edge hover:border-cyan-glow/40"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge bg-ink/60 text-sm font-bold text-zinc-300"
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        {/* the chip is its own tap target (server menu),
                            so it lives outside the open-point button */}
                        <div className="flex flex-wrap items-center gap-2">
                          <ServerChipMenu
                            point={point}
                            serve={serving.get(point.id)}
                            userSide={userSide}
                            isOwner={isOwner}
                            neutralLabels={
                              neutral
                                ? { you: mapLabels.you, them: mapLabels.them }
                                : undefined
                            }
                            onPointUpdate={updatePoint}
                          />
                          {point.confirmed_winner && !point.is_let && (
                            <span
                              className={`text-[11px] font-medium ${
                                point.confirmed_winner === "user"
                                  ? "text-emerald-400"
                                  : "text-zinc-400"
                              }`}
                            >
                              {winnerText(point)}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex w-full items-center gap-3 text-left text-xs text-zinc-500">
                          {duration !== null ? (
                            <span>{duration.toFixed(1)}s</span>
                          ) : (
                            <span>View point</span>
                          )}
                          {noteCount > 0 && (
                            <span>
                              {noteCount} note{noteCount === 1 ? "" : "s"}
                            </span>
                          )}
                          {point.edited && (
                            <span className="animate-pulse text-cyan-glow/80">
                              Updating clip
                            </span>
                          )}
                        </div>
                      </div>
                      {/* one-tap outcome: You/Them build the score without
                          opening the point (tap the same side again to
                          clear); Skip below is the quieter third outcome —
                          skipped points never score, tap again to un-skip */}
                      {isOwner && (
                        <span className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void tapWinner(point, "user");
                            }}
                            aria-pressed={point.confirmed_winner === "user"}
                            aria-label={`Point ${i + 1}: I won`}
                            className={`rounded-md border px-2 py-1 text-[11px] font-semibold leading-none transition-colors ${
                              point.confirmed_winner === "user"
                                ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                                : "border-edge bg-ink/40 text-zinc-400 hover:border-cyan-glow/40"
                            }`}
                          >
                            You
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void tapWinner(point, "opponent");
                            }}
                            aria-pressed={point.confirmed_winner === "opponent"}
                            aria-label={`Point ${i + 1}: they won`}
                            className={`rounded-md border px-2 py-1 text-[11px] font-semibold leading-none transition-colors ${
                              point.confirmed_winner === "opponent"
                                ? "border-magenta-glow/60 bg-magenta-glow/15 text-magenta-soft"
                                : "border-edge bg-ink/40 text-zinc-400 hover:border-magenta-glow/40"
                            }`}
                          >
                            Them
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void tapSkip(point);
                            }}
                            aria-pressed={point.is_let}
                            aria-label={`Point ${i + 1}: ${
                              point.is_let ? "un-skip" : "skip"
                            }`}
                            className={`rounded-md border px-2 py-1 text-[10px] font-medium leading-none transition-colors ${
                              point.is_let
                                ? "border-amber-400/50 bg-amber-400/10 text-amber-300"
                                : "border-edge bg-ink/40 text-zinc-400 hover:border-amber-400/40 hover:text-amber-300"
                            }`}
                          >
                            Skip
                          </button>
                        </span>
                      )}
                      {!isOwner && point.starred && (
                        <span className="shrink-0 p-2 text-amber-300">
                          <svg
                            viewBox="0 0 24 24"
                            className="h-5 w-5"
                            fill="currentColor"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"
                            />
                          </svg>
                        </span>
                      )}
                      {isOwner && (
                        <span className="flex shrink-0 items-center">
                          <span className="flex flex-col items-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void toggleStar(point);
                            }}
                            aria-pressed={point.starred}
                            aria-label={
                              point.starred ? "Remove star" : "Star this point"
                            }
                            className={`rounded-full p-1.5 transition-colors ${
                              point.starred
                                ? "text-amber-300"
                                : "text-zinc-600 hover:text-zinc-400"
                            }`}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="h-5 w-5"
                              fill={point.starred ? "currentColor" : "none"}
                              stroke="currentColor"
                              strokeWidth="1.8"
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void deletePoint(point);
                            }}
                            aria-label={`Remove point ${i + 1}`}
                            className="rounded-full p-1.5 text-zinc-600 transition-colors hover:text-red-300"
                          >
                            <TrashIcon className="h-5 w-5" />
                          </button>
                          </span>
                        </span>
                      )}
                    </div>
                    </SwipeRemoveRow>
                    {/* game boundary from the confirmed sequence */}
                    {nextGame !== undefined && (
                      <div
                        className="mt-3 flex items-center gap-3"
                        aria-hidden="true"
                      >
                        <span className="h-px flex-1 bg-edge" />
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                          Game {nextGame.game} · {nextGame.you}-{nextGame.them}
                        </span>
                        <span className="h-px flex-1 bg-edge" />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* removed points: persistent undo at the bottom */}
          {isOwner && removedPoints.length > 0 && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setRemovedOpen((o) => !o)}
                aria-expanded={removedOpen}
                className="flex w-full items-center justify-between rounded-2xl border border-edge/70 bg-surface/50 px-4 py-3 text-left transition-colors hover:border-cyan-glow/30"
              >
                <span className="text-sm font-medium text-zinc-300">
                  Removed ({removedPoints.length})
                </span>
                <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                  {removedOpen ? "Hide" : "Show"}
                  <svg
                    viewBox="0 0 24 24"
                    className={`h-3.5 w-3.5 transition-transform ${
                      removedOpen ? "rotate-180" : ""
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
              {removedOpen && (
                <ul className="mt-2 space-y-2">
                  {removedPoints.map((p) => {
                    const dur =
                      p.t0 !== null && p.t1 !== null
                        ? Math.max(0, Number(p.t1) - Number(p.t0))
                        : null;
                    return (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-edge/60 bg-surface/40 px-4 py-3"
                      >
                        <span className="text-xs text-zinc-400">
                          {p.t0 !== null
                            ? `At ${formatClock(Number(p.t0))}`
                            : "Removed point"}
                          {dur !== null && ` · ${dur.toFixed(1)}s`}
                        </span>
                        <button
                          type="button"
                          onClick={() => void undoDelete(p.id)}
                          className="shrink-0 rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
                        >
                          Restore
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* desktop detail pane */}
        {isDesktop && panePoint && (
          <aside className="sticky top-20 mt-8 hidden max-h-[calc(100vh-6rem)] overflow-y-auto rounded-2xl border border-edge bg-surface p-5 lg:block">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold">
                Point {paneIndex + 1}
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  {paneIndex + 1} of {visiblePoints.length}
                </span>
              </p>
              {/* running score as of this point (chevrons on the clip +
                  arrow keys handle prev/next) */}
              <ScoreLine
                score={runningScore}
                className="text-sm font-bold tabular-nums tracking-tight"
              />
            </div>
            <PointDetail
              key={panePoint.id}
              matchId={match.id}
              ownerId={match.user_id}
              point={panePoint}
              serve={serving.get(panePoint.id)}
              notes={notes.filter((n) => n.point_id === panePoint.id)}
              userId={userId}
              userSide={userSide}
              gameIndex={gameIndexByPoint.get(panePoint.id) ?? 0}
              gameEnd={{
                endsHere: score.boundaryAfter.has(panePoint.id),
                openHere: score.openAfter.has(panePoint.id),
              }}
              onSetGameOverride={(v) => setGameEndOverride(panePoint, v)}
              mapLabels={mapLabels}
              neutral={neutral}
              onSetUserSide={isOwner ? handleSetUserSide : undefined}
              strictness={strictness}
              nav={{
                hasPrev: paneIndex > 0,
                hasNext: paneIndex < visiblePoints.length - 1,
                onPrev: () => goToIndex(paneIndex - 1),
                onNext: () => goToIndex(paneIndex + 1),
              }}
              onPointUpdate={(patch) => updatePoint(panePoint.id, patch)}
              onNoteAdded={(note) => setNotes((ns) => [...ns, note])}
              onDelete={(p) => void deletePoint(p)}
              deleteBefore={
                isOwner && paneIndex >= 2
                  ? {
                      count: paneIndex,
                      onConfirm: () => void deleteAllBefore(panePoint),
                    }
                  : undefined
              }
              onSplit={addSplitPoint}
              onClipEdited={scheduleReclip}
              onShare={
                isOwner
                  ? () => setShareTarget({ pointId: panePoint.id })
                  : undefined
              }
              onOpenInPlayer={
                panePoint.cut_t0 !== null
                  ? () => {
                      setActivePointId(null);
                      playerRef.current?.openWatch(Number(panePoint.cut_t0));
                    }
                  : undefined
              }
            />
          </aside>
        )}
      </div>

      {/* match-level placement: where the ball lands, aggregated across all
          points that have mappable bounces, normalized so you're always at
          the bottom. Owner-only. Sits near the bottom (below the points,
          above notes) so the timeline stays the page's spine. */}
      {isOwner && (
        <div ref={matchAnalysisRef} className="scroll-mt-32">
          <PlacementAggregate
            points={visiblePoints}
            userSide={userSide}
            gameIndexByPoint={gameIndexByPoint}
            labels={mapLabels}
          />
        </div>
      )}

      {/* derived match statistics: scored-point stats only (serve win %,
          2nd-serve win %, points won on serve/receive, …). Owner-only. */}
      {isOwner && (
        <div ref={matchStatsRef} className="scroll-mt-32">
          <MatchStatistics
            stats={stats}
            neutral={neutral}
            youLabel={mapLabels.you}
          />
        </div>
      )}

      {/* match-level notes (point_id null): overall takeaways + coach review */}
      <section className="mt-10 scroll-mt-32 lg:max-w-2xl" ref={notesRef}>
        <h2 className="text-lg font-semibold">Overall notes</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Notes about the whole match. Type or record a voice note.
        </p>
        {matchNotes.length > 0 && (
          <ul className="mt-4 space-y-3">
            {matchNotes.map((n) => (
              <NoteItem
                key={n.id}
                note={n}
                matchId={match.id}
                ownerId={match.user_id}
                viewerId={userId}
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

      {/* feedback: owner only (coaches report through their own matches) */}
      {isOwner && (
        <div className="mt-12 border-t border-edge/60 pt-6">
          {feedbackState === "sent" ? (
            <p className="text-sm text-emerald-400">
              Thanks. We read every report.
            </p>
          ) : feedbackOpen ? (
            <div>
              <p className="text-sm font-medium text-zinc-300">
                Something wrong with this match?
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Wrong server, missed points, bad cuts. Tell us and we fix the
                pipeline.
              </p>
              <textarea
                value={feedbackBody}
                onChange={(e) => setFeedbackBody(e.target.value)}
                rows={3}
                placeholder="What looks off?"
                className="mt-3 w-full resize-y rounded-lg border border-edge bg-ink/60 px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600"
              />
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  disabled={
                    feedbackState === "sending" ||
                    feedbackBody.trim().length === 0
                  }
                  onClick={() => void sendFeedback()}
                  className="rounded-full bg-cyan-glow px-4 py-1.5 text-sm font-semibold text-ink disabled:opacity-50"
                >
                  {feedbackState === "sending" ? "Sending…" : "Send"}
                </button>
                <button
                  type="button"
                  onClick={() => setFeedbackOpen(false)}
                  className="text-sm text-zinc-500 hover:text-zinc-300"
                >
                  Cancel
                </button>
                {feedbackState === "error" && (
                  <p className="text-xs text-red-400">
                    Couldn&apos;t send. Try again.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              className="text-sm text-zinc-500 underline underline-offset-2 transition-colors hover:text-zinc-300"
            >
              Something wrong with this match?
            </button>
          )}
        </div>
      )}

      {/* floating score pill: only once the header has scrolled away
          (while at top the same score sits in the title row) */}
      {scoreDetached && score.confirmedCount > 0 && !playerOpen && (
        <div className="pointer-events-none fixed inset-x-0 top-[4.25rem] z-30 md:top-[4.75rem]">
          <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:max-w-6xl">
            <div className="lg:max-w-[340px]">
              <div className="ks-fade flex items-center justify-between gap-3 rounded-full border border-edge bg-ink/90 px-5 py-2.5 shadow-lg shadow-black/50 backdrop-blur-md">
                <ScoreLine
                  score={score}
                  className="text-base font-bold tabular-nums tracking-tight"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* floating back-to-top: long point lists are a lot of scrolling on
          mobile. Appears on the SAME signal as the score pill (header
          scrolled away) and jumps back up to the Tools card, which lands
          just under the persistent header. Sits clear of the bottom nav
          (safe-area aware) and the top-anchored score pill. */}
      {scoreDetached && !playerOpen && (
        <button
          type="button"
          onClick={() => scrollToSection(toolsRef)}
          aria-label="Back to top"
          className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex h-11 w-11 items-center justify-center rounded-full border border-edge bg-ink/70 text-zinc-200 shadow-lg shadow-black/40 backdrop-blur-md transition-colors hover:text-white md:bottom-6"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 19V5M6 11l6-6 6 6"
            />
          </svg>
        </button>
      )}

      {/* mobile point sheet */}
      {!isDesktop && selectedPoint && (
        <PointSheet
          matchId={match.id}
          ownerId={match.user_id}
          point={selectedPoint}
          serve={serving.get(selectedPoint.id)}
          notes={notes.filter((n) => n.point_id === selectedPoint.id)}
          userId={userId}
          userSide={userSide}
          gameIndex={gameIndexByPoint.get(selectedPoint.id) ?? 0}
          gameEnd={{
            endsHere: score.boundaryAfter.has(selectedPoint.id),
            openHere: score.openAfter.has(selectedPoint.id),
          }}
          onSetGameOverride={(v) => setGameEndOverride(selectedPoint, v)}
          mapLabels={mapLabels}
          neutral={neutral}
          onSetUserSide={isOwner ? handleSetUserSide : undefined}
          strictness={strictness}
          index={visiblePoints.findIndex((p) => p.id === selectedPoint.id)}
          total={visiblePoints.length}
          score={runningScore}
          onClose={() => setActivePointId(null)}
          onPrev={() =>
            goToIndex(
              visiblePoints.findIndex((p) => p.id === selectedPoint.id) - 1
            )
          }
          onNext={() =>
            goToIndex(
              visiblePoints.findIndex((p) => p.id === selectedPoint.id) + 1
            )
          }
          onPointUpdate={(patch) => updatePoint(selectedPoint.id, patch)}
          onNoteAdded={(note) => setNotes((ns) => [...ns, note])}
          onDelete={(p) => void deletePoint(p)}
          deleteBefore={
            // paneIndex IS this point's index: panePoint = selectedPoint
            // whenever the sheet is open.
            isOwner && paneIndex >= 2
              ? {
                  count: paneIndex,
                  onConfirm: () => void deleteAllBefore(selectedPoint),
                }
              : undefined
          }
          onSplit={addSplitPoint}
          onClipEdited={scheduleReclip}
          onShare={
            isOwner
              ? () => setShareTarget({ pointId: selectedPoint.id })
              : undefined
          }
          onOpenInPlayer={
            selectedPoint.cut_t0 !== null
              ? () => {
                  setActivePointId(null);
                  playerRef.current?.openWatch(Number(selectedPoint.cut_t0));
                }
              : undefined
          }
        />
      )}

      {/* public-link share sheet (match, starred set, or single point);
          the coach invite lives inside it too — the sheet is the single
          share entry on the match page */}
      {isOwner && (
        <ShareSheet
          open={shareTarget !== null}
          onClose={() => {
            setShareTarget(null);
            void loadToolStatus();
          }}
          matchId={match.id}
          pointId={shareTarget?.pointId}
          pointNumber={
            shareTarget?.pointId
              ? visiblePoints.findIndex((p) => p.id === shareTarget.pointId) +
                1
              : undefined
          }
          starredCount={visiblePoints.filter((p) => p.starred).length}
          userId={userId}
          names={shareNames}
        />
      )}

      {/* coach invite sheet, from the Tools "Coach" row */}
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

      {/* "Your side" change sheet, from the Tools row. Same PickSide as the
          first-open banner, against the cut video; picking writes user_side
          (handleSetUserSide == PlayerTagging's chooseSide) and closes. */}
      {isOwner && sideSheetOpen && (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setSideSheetOpen(false)}
            className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-edge bg-surface p-5 pb-8 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Which player are you?</h2>
              <button
                type="button"
                onClick={() => setSideSheetOpen(false)}
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
                src={cutPreviewUrl}
                atSeconds={60}
                selected={userSide}
                onPick={(s) => {
                  void handleSetUserSide(s);
                  setSideSheetOpen(false);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* undo snackbar for "Not a point" */}
      {snackbar && (
        <div className="fixed inset-x-0 bottom-24 z-[70] flex justify-center px-4 md:bottom-6">
          <div className="flex items-center gap-4 rounded-full border border-edge bg-surface px-5 py-3 shadow-2xl">
            <span className="text-sm text-zinc-200">{snackbar.text}</span>
            <button
              type="button"
              onClick={() => void undoDelete(snackbar.pointIds)}
              className="text-sm font-semibold text-cyan-glow hover:underline"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={dismissSnackbar}
              aria-label="Dismiss"
              className="text-zinc-500 transition-colors hover:text-zinc-300"
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
        </div>
      )}
    </div>
  );
}
