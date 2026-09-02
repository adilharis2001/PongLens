"use client";

import Link from "next/link";
import { SectionHeading } from "@/components/SectionHeading";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatBytes } from "@/app/dashboard/shared";
import type {
  Match,
  Note,
  NoteAuthor,
  Point,
  PointTag,
  ServeStartMeta,
  Tag,
} from "@/lib/types";
import { TagGlyph, TagPicker } from "./Tags";
import { deriveMatchTitleParts } from "@/lib/matchTitle";
import { ShareSheet } from "@/components/ShareSheet";
import { ShareWithCoachSheet } from "@/components/ShareWithCoach";
import { CoachCta } from "@/components/reviews/CoachCta";
import { OriginalVideoButton } from "@/components/OriginalVideo";
import {
  computeMatchScore,
  sortPoints,
  type GameEndOverride,
} from "./gameScore";
import { GamesPair, GamesToggle, ScoreLine } from "./ScoreLine";
import {
  SpokenGamesToggle,
  SpokenLine,
  SpokenScoreEditor,
  cleanSpoken,
} from "./SpokenScore";
import { ReelRow, TOOL_ROW_CLASS, ToolRowChevron } from "./ReelBar";
import { HighlightsRow } from "./HighlightsRow";
import { NoteComposer, NoteItem } from "./Notes";
import { hasPlacementBounces, type MapLabels } from "./PlacementMap";
import {
  mappedPointCount,
  PlacementAggregate,
} from "./PlacementAggregate";
import { PlacementToolsRow } from "./PlacementToolsRow";
import { usePlacementLifecycle } from "./usePlacementLifecycle";
import { AnalysisCards } from "./AnalysisCards";
import { ShareResult } from "@/app/s/[token]/ShareResult";
import { ShareStats } from "@/app/s/[token]/ShareStats";
import { SharePlacement } from "@/app/s/[token]/SharePlacement";
import {
  collectServePlacementObservations,
  collectTrustedPlacementObservations,
  trustedPlacementPointCount,
} from "@/lib/placement/placementAggregate";
import { computeMatchAnalysis } from "./matchAnalysis";
import { computeMatchStats, statsRowSummary } from "./matchStats";
import { mergeSkipSpans, paddedEnd,
  type EndOptions,
} from "./playhead";
import { clipPad } from "./clipEdit";
import { adjustPatch, runJoinPlan, runSplitPlan } from "./modifyOps";
import { Player, type PlayerHandle } from "./Player";
import { PointDetail } from "./PointDetail";
import { PointSheet } from "./PointSheet";
import { PickSide } from "./PickSide";
import { tracksServe } from "@/lib/matchTitle";
import { ServerChipMenu } from "./ServerChipMenu";
import { NameCombobox } from "@/app/dashboard/NameCombobox";
import {
  computeServing,
  firstServerGuess,
  type MatchServer,
} from "./serving";
import type { Side } from "./sides";
import {
  userConfirmedFirstServer,
  userFirstServerUpdate,
} from "./matchStructure";
import { normalizeCustomReasonLabel } from "./scorecard";
import {
  SIDE_CHANGE_LABEL,
  sideChangesByPoint,
  type SideChangeMarker,
} from "./sideChanges.ts";
import {
  placementNoticeForViewer,
  scrollToReadyPlacement,
  showPlacementDeepDive,
} from "@/lib/placement/placementRetry";

/** Source-video timestamp as m:ss. */
function formatClock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Checkbox for the unscore picker. A box rather than a switch, because
 *  several of these are ticked at once. */
function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
        on ? "border-cyan-glow bg-cyan-glow text-ink" : "border-zinc-600"
      }`}
    >
      {on && (
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4 10-10" />
        </svg>
      )}
    </span>
  );
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

/** Small comment/note bubble — the discreet marker that a point carries a
 *  note (from the owner, a coach, or anyone the match is shared with). */
function NoteGlyph({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9A1.5 1.5 0 0 1 18.5 16H9l-4 4V5.5Z"
      />
      <path strokeLinecap="round" d="M8 8.5h8M8 11.5h5" />
    </svg>
  );
}

const SWIPE_OPEN_PX = -88;

/** How many points the timeline shows before you ask for the rest. Enough
 *  to see the shape of the opening; short enough that the analysis below is
 *  a scroll away rather than a expedition. */
const POINTS_PREVIEW = 10;
const POINTS_EXPANDED_KEY = "ponglens.pointsExpanded";

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
 * Full-video card: the Player's poster plus the actions that are about
 * the match's FOOTAGE — watch the original, download the cut. Everything
 * else (score, share, coach, export) lives in the Tools card below.
 * Tapping the poster opens the Player takeover in watch mode.
 *
 * The rule here used to be "ONE header action", and the card used to be
 * the only match-footage video on the page. Both were retired by the
 * Original pill, and the narrower rule that replaces them still does the
 * work the old one did: THIS CARD HOLDS THE MATCH'S VIDEOS, ONE SHORTCUT
 * EACH; ACTIONS LIVE IN TOOLS. Placement and Match analysis are not
 * videos and still have no business here.
 *
 * The Original pill cannot live in Tools, which is why it is here: Tools
 * is `{isOwner && (`, and a coach looking at a poor cut wants the
 * original for the same reason the player does.
 *
 * The ↓ stays as a one-tap shortcut for the plain full-match (no-score)
 * download — the most common export. The Tools "Export" row opens the full
 * menu (full match with/without score, starred points, the original); this
 * quick affordance is deliberately kept alongside it.
 */
function DownloadCard({
  matchId,
  isOwner,
  hasOriginal,
  children,
}: {
  matchId: string;
  /** Owner gets the quiet ↓ icon; coach viewers the plain Download pill. */
  isOwner: boolean;
  /** Is there an original upload left to watch? Server-resolved, so the
   *  pill is correct at first paint rather than appearing a beat late. */
  hasOriginal: boolean;
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
      className="w-full overflow-hidden rounded-2xl border border-edge bg-surface sm:max-w-sm lg:max-w-none"
    >
      {children}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Full video</p>
          <p className="text-xs text-zinc-500">Playtime only</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasOriginal && <OriginalVideoButton matchId={matchId} />}
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

function PfSegment<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            value === o.value
              ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
              : "border-edge bg-ink/40 text-zinc-400 hover:border-cyan-glow/40"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function MatchView({
  match,
  initialPoints,
  ownerHandedness,
  initialNotes,
  userId,
  canLabelServeStart = false,
  accountName,
  ownerName,
  strictness,
  noteAuthors,
  initialTags,
  initialPointTags,
  initialLossReasonLabels = [],
  placementServesOnly = false,
  gameEndDetection = false,
  ends = { tapEnd: false },
  hasOriginal = false,
}: {
  match: Match;
  initialPoints: Point[];
  /** Match owner's handedness (player_profiles) — labels the FH/BH
   *  corners of their half on the serve map; null keeps the map bare. */
  ownerHandedness?: "right" | "left" | null;
  initialNotes: Note[];
  userId: string;
  /** Admin, on their own match: shows the serve-start label in Keep score
   *  (089). Off for everyone else, and the DB trigger enforces it too. */
  canLabelServeStart?: boolean;
  /** The viewer's account first name (Google auth), or null. Used as the
   * owner's own-name fallback wherever a tagged-side name is missing. */
  accountName: string | null;
  /** The match owner's display name, for viewers who are not the owner
   *  (match_owner_name, migration 034). null for the owner's own view. */
  ownerName: string | null;
  strictness: string;
  /** Display names for the note authors on this match, so the thread can
   * name each coach rather than labelling all of them "Coach". */
  noteAuthors: NoteAuthor[];
  /** The owner's tag vocabulary (035) and this match's applications. */
  initialTags: Tag[];
  initialPointTags: PointTag[];
  /** The owner's own "why I lost it" pills (loss_reason_labels, 060). */
  initialLossReasonLabels?: { id: string; label: string }[];
  /** app_config placement_serves_only (132). Read on the server so the
   *  match page and the share link cannot disagree about what the maps
   *  show for the same match. */
  placementServesOnly?: boolean;
  /** app_config game_end_detection (140). Draws a marker between two
   *  rallies where the video shows the players swapping ends. Read on the
   *  server; off means no marker anywhere and no behaviour change at all. */
  gameEndDetection?: boolean;
  /** Which endings trim a point (playhead.effectiveEnd): the winner tap
   *  plus half a second on a scored point (tap_end_playback, 138), the
   *  observed rally end plus its buffer on an unscored one
   *  (unscored_rally_end, 143). Both read on the server, so the match
   *  page and the share link cannot disagree about the same match. */
  ends?: EndOptions;
  /** Is there an original upload left to watch? Resolved on the server
   *  from matches.raw_path, falling back to the source job's input_path
   *  for rows that predate the column — so the pill is right at first
   *  paint instead of appearing a beat later and shifting the layout. */
  hasOriginal?: boolean;
}) {
  const [points, setPoints] = useState<Point[]>(initialPoints);
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [tagVocab, setTagVocab] = useState<Tag[]>(initialTags);
  const [pointTags, setPointTags] = useState<PointTag[]>(initialPointTags);
  // Timeline tagging: which point's picker is open (the star's sibling).
  const [tagPickerPoint, setTagPickerPoint] = useState<Point | null>(null);
  /** The detected side-change marker the owner tapped in the point list. */
  const [sideChangeSheet, setSideChangeSheet] = useState<Point | null>(null);
  const [opponentName, setOpponentName] = useState(match.opponent_name ?? "");
  const [userSide, setUserSide] = useState<Side | null>(match.user_side);
  const [nearName, setNearName] = useState(match.player_near_name ?? "");
  const [farName, setFarName] = useState(match.player_far_name ?? "");
  const [firstServer, setFirstServer] = useState<MatchServer | null>(
    userConfirmedFirstServer(match)
  );
  const [activePointId, setActivePointId] = useState<string | null>(null);
  // Header title edit: the title is DERIVED (opponent · venue · date); this
  // flips the opponent input back on for manual fixes (venue lives on the
  // upload form). The derived title stays the header's source of truth.
  const [titleEditing, setTitleEditing] = useState(false);
  // The details panel has always existed; its only way in was a 16px
  // pencil beside the title, which disappears entirely once the header
  // collapses into the sticky bar. Tools is where people already go to
  // change something about a match, so it gets a named row that opens the
  // same panel and brings it into view.
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const openDetails = useCallback(() => {
    setTitleEditing(true);
    window.setTimeout(
      () =>
        detailsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        }),
      60
    );
  }, []);

  // Undo snackbar for structural edits made outside the Keep-score takeover
  // (which has its own undo stack): deletes, bulk delete-before, timing
  // adjusts, point-view splits. Each producer supplies its own inverse;
  // Cmd/Ctrl+Z presses the same Undo while the snackbar is up.
  const [snackbar, setSnackbar] = useState<{
    text: string;
    undo: () => void;
  } | null>(null);
  const snackbarTimer = useRef<number | null>(null);
  // Debounce: many quick edits -> ONE reclip job per match.
  const reclipTimer = useRef<number | null>(null);

  const isOwner = match.user_id === userId;
  const isDesktop = useIsDesktop();
  const placement = usePlacementLifecycle({
    matchId: match.id,
    initialStatus: match.placement_status,
    initialRetryCount: match.placement_retry_count,
    initialExpiresAt: match.placement_retry_expires_at,
    initialFailureCode: match.placement_failure_code,
  });

  // The Player: one takeover surface owning the only match-footage video.
  // Its handle opens it inside the entry tap's call stack so video.play()
  // runs synchronously in the user gesture (iOS autoplay requirement).
  const playerRef = useRef<PlayerHandle | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);

  /**
   * The open point view was reached from the scoring pad, so closing it
   * owes you the pad back rather than the match page.
   *
   * A ref, not state: nothing renders from it, and it must be readable
   * inside the close handler without re-running anything.
   */
  const cameFromScore = useRef(false);
  // Any other way of closing the point view spends the promise too — the
  // pad is gone, and a stale flag would ambush the NEXT point you open
  // from the timeline.
  useEffect(() => {
    if (activePointId === null) cameFromScore.current = false;
  }, [activePointId]);

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
  const [sideError, setSideError] = useState<string | null>(null);
  const [cutPreviewUrl, setCutPreviewUrl] = useState<string | null>(null);

  // "Not now" used to live only in component state, so it came back on
  // every fresh open of the same match — the reason this question felt
  // like it never stopped asking. Remembering the refusal per match makes
  // it a real answer. Tools > Your side is always there to reopen it.
  const sideAskKey = `ponglens:side-asked:${match.id}`;
  useEffect(() => {
    try {
      if (localStorage.getItem(sideAskKey) === "1") setFirstOpenDismissed(true);
    } catch {}
  }, [sideAskKey]);
  const dismissSideBanner = useCallback(() => {
    setFirstOpenDismissed(true);
    try {
      localStorage.setItem(sideAskKey, "1");
    } catch {}
  }, [sideAskKey]);

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
        .or(
          `scope_match_id.eq.${match.id},and(scope_match_id.is.null,all_matches.eq.true)`,
        )
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

  // Names this owner has used before, for the opponent field's suggestions.
  // Own matches only (RLS also returns coached ones), most recent first;
  // fetched once when the edit panel is first opened, since nothing else on
  // the page needs it.
  const [pastOpponents, setPastOpponents] = useState<string[]>([]);
  useEffect(() => {
    if (!titleEditing || !isOwner || pastOpponents.length) return;
    const supabase = createClient();
    void supabase
      .from("matches")
      .select("opponent_name")
      .eq("user_id", userId)
      .not("opponent_name", "is", null)
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (!data) return;
        const seen = new Set<string>();
        const list: string[] = [];
        for (const r of data as { opponent_name: string | null }[]) {
          const v = (r.opponent_name ?? "").trim();
          const k = v.toLowerCase();
          if (v && !seen.has(k)) {
            seen.add(k);
            list.push(v);
          }
        }
        setPastOpponents(list);
      });
  }, [titleEditing, isOwner, userId, pastOpponents.length]);

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
  // Drills and practice are not played to a score, so serve rotation is
  // not being followed and there is no score to keep. Derived from the
  // LIVE type state rather than the row, so switching the type in Details
  // below adds or removes these surfaces without a reload — the same rule
  // and the same behaviour as MatchTitle.tracksServe on iOS.
  const scored = tracksServe(matchType || null);
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


  const noteCountByPoint = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) {
      if (n.point_id) map.set(n.point_id, (map.get(n.point_id) ?? 0) + 1);
    }
    return map;
  }, [notes]);

  const matchNotes = notes.filter((n) => n.point_id === null);

  // Tags (035): resolved per-point lists, plus the picker's chip order —
  // most recently used in THIS match first (the point-40 repeat case),
  // then newest label.
  const tagsById = useMemo(
    () => new Map(tagVocab.map((t) => [t.id, t])),
    [tagVocab]
  );
  const tagsByPoint = useMemo(() => {
    const map = new Map<string, Tag[]>();
    for (const pt of pointTags) {
      const tag = tagsById.get(pt.tag_id);
      if (!tag) continue;
      const list = map.get(pt.point_id) ?? [];
      list.push(tag);
      map.set(pt.point_id, list);
    }
    return map;
  }, [pointTags, tagsById]);
  const sortedVocab = useMemo(() => {
    const lastUsed = new Map<string, string>();
    for (const pt of pointTags) {
      const cur = lastUsed.get(pt.tag_id);
      if (!cur || pt.created_at > cur) lastUsed.set(pt.tag_id, pt.created_at);
    }
    return [...tagVocab].sort((a, b) => {
      const ua = lastUsed.get(a.id) ?? "";
      const ub = lastUsed.get(b.id) ?? "";
      if (ua !== ub) return ub.localeCompare(ua);
      return b.created_at.localeCompare(a.created_at);
    });
  }, [tagVocab, pointTags]);

  // Apply/remove an existing tag on a point, optimistically. Any viewer
  // with match access may tag; RLS enforces the rest.
  const toggleTag = useCallback(
    async (pointId: string, tag: Tag) => {
      const supabase = createClient();
      const applied = pointTags.some(
        (pt) => pt.point_id === pointId && pt.tag_id === tag.id
      );
      if (applied) {
        setPointTags((pts) =>
          pts.filter(
            (pt) => !(pt.point_id === pointId && pt.tag_id === tag.id)
          )
        );
        const { error } = await supabase
          .from("point_tags")
          .delete()
          .eq("point_id", pointId)
          .eq("tag_id", tag.id);
        if (error) {
          setPointTags((pts) => [
            ...pts,
            {
              point_id: pointId,
              tag_id: tag.id,
              created_by: userId,
              created_at: new Date().toISOString(),
            },
          ]);
        }
      } else {
        setPointTags((pts) => [
          ...pts,
          {
            point_id: pointId,
            tag_id: tag.id,
            created_by: userId,
            created_at: new Date().toISOString(),
          },
        ]);
        const { error } = await supabase
          .from("point_tags")
          .insert({ point_id: pointId, tag_id: tag.id, created_by: userId });
        if (error) {
          setPointTags((pts) =>
            pts.filter(
              (pt) => !(pt.point_id === pointId && pt.tag_id === tag.id)
            )
          );
        }
      }
    },
    [pointTags, userId]
  );

  // Create a tag in the OWNER's vocabulary and apply it. A concurrent
  // create of the same label (the coach and player typing together) hits
  // the unique index — recover by adopting the winner's row.
  const createTag = useCallback(
    async (pointId: string, label: string) => {
      const clean = label.trim().slice(0, 40);
      if (!clean) return;
      const existing = tagVocab.find(
        (t) => t.label.toLowerCase() === clean.toLowerCase()
      );
      if (existing) {
        void toggleTag(pointId, existing);
        return;
      }
      const supabase = createClient();
      const { data } = await supabase
        .from("tags")
        .insert({ owner_id: match.user_id, label: clean })
        .select()
        .maybeSingle();
      let tag = data as Tag | null;
      if (!tag) {
        const { data: again } = await supabase
          .from("tags")
          .select("*")
          .eq("owner_id", match.user_id)
          .ilike("label", clean.replace(/[%_\\]/g, (m) => `\\${m}`))
          .maybeSingle();
        tag = again as Tag | null;
      }
      if (!tag) return;
      const t = tag;
      setTagVocab((v) => (v.some((x) => x.id === t.id) ? v : [t, ...v]));
      void toggleTag(pointId, t);
    },
    [tagVocab, match.user_id, toggleTag]
  );

  const tagsForPoint = useCallback(
    (pointId: string) => tagsByPoint.get(pointId) ?? [],
    [tagsByPoint]
  );

  /**
   * The owner's own "why I lost it" pills (migration 060). Owner-keyed like
   * tags and created the same way, including the unique-index race: two
   * points adding the same words at once means one insert loses, so the
   * loser re-reads the row rather than reporting a failure.
   */
  const [customReasons, setCustomReasons] = useState<
    { id: string; label: string }[]
  >(initialLossReasonLabels);

  const createCustomReason = useCallback(
    async (label: string): Promise<string | null> => {
      // Normalized before the lookup as well as the insert: "MISREAD THE
      // PIPS" must find the existing "Misread the pips" rather than race
      // the unique index and come back as a second row.
      const clean = normalizeCustomReasonLabel(label);
      if (!clean) return null;
      const existing = customReasons.find(
        (r) => r.label.toLowerCase() === clean.toLowerCase()
      );
      if (existing) return existing.id;
      const supabase = createClient();
      const { data } = await supabase
        .from("loss_reason_labels")
        .insert({ owner_id: match.user_id, label: clean })
        .select("id,label")
        .maybeSingle();
      let row = data as { id: string; label: string } | null;
      if (!row) {
        const { data: again } = await supabase
          .from("loss_reason_labels")
          .select("id,label")
          .eq("owner_id", match.user_id)
          .ilike("label", clean.replace(/[%_\\]/g, (m) => `\\${m}`))
          .maybeSingle();
        row = again as { id: string; label: string } | null;
      }
      if (!row) return null;
      const created = row;
      setCustomReasons((v) =>
        v.some((x) => x.id === created.id) ? v : [...v, created]
      );
      return created.id;
    },
    [customReasons, match.user_id]
  );

  const customReasonLabels = useMemo(
    () => new Map(customReasons.map((r) => [r.id, r.label])),
    [customReasons]
  );

  // author_id -> display name. Notes the viewer writes in this session are
  // always labelled "You", so this never needs refetching mid-visit.
  const authorNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of noteAuthors) {
      if (a.name) map.set(a.author_id, a.name);
    }
    return map;
  }, [noteAuthors]);

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
  // Tag share/export options (036): each tag with its tagged visible
  // points — count for the share rows, clip-bearing ids (timeline order,
  // the set /api/reel would render) for the export rows' freshness check.
  const tagShareOptions = useMemo(() => {
    const byTag = new Map<
      string,
      { id: string; label: string; count: number; pointIds: string[] }
    >();
    for (const p of visiblePoints) {
      for (const t of tagsByPoint.get(p.id) ?? []) {
        let entry = byTag.get(t.id);
        if (!entry) {
          entry = { id: t.id, label: t.label, count: 0, pointIds: [] };
          byTag.set(t.id, entry);
        }
        entry.count += 1;
        if (p.clip_path) entry.pointIds.push(p.id);
      }
    }
    return [...byTag.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [visiblePoints, tagsByPoint]);
  const [removedOpen, setRemovedOpen] = useState(false);
  const score = useMemo(
    () => computeMatchScore(visiblePoints),
    [visiblePoints]
  );


  // Clip context padding for this match's cut (strictness lives on the
  // job): cut_t0 is the PADDED clip start, so every rally-end computation
  // needs these numbers (see playhead.ts).
  const pad = useMemo(
    () => clipPad(strictness, match.clip_pads),
    [strictness, match.clip_pads]
  );

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
    // The shared merge (playhead.ts): a run of deleted rallies fuses into
    // one jump — the cut keeps slivers of unowned padding between clips,
    // and the old 0.01 tolerance turned a deleted warm-up into a hop per
    // rally — while the kept-rally guard keeps a fuse from ever spanning
    // a rally somebody kept.
    return mergeSkipSpans(spans, [...visibleStarts].sort((a, b) => a - b));
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
    // "Player" is the last resort, not the first: an untagged match still
    // belongs to someone, and a coach can be told who (match_owner_name).
    const userName =
      (userSide === "near" ? nearName : farName).trim() ||
      (ownerName ?? "").trim() ||
      "Player";
    return {
      you: isOwner && !neutral ? "Me" : userName,
      them: opponentName.trim() || (isOwner ? "Them" : "Opponent"),
      near: nearName.trim() || "Near player",
      far: farName.trim() || "Far player",
    };
  }, [isOwner, neutral, userSide, nearName, farName, opponentName, ownerName]);

  // ITTF rotation from first_server (overrides re-anchor downstream);
  // recomputes instantly on any first_server / override / let change.
  const serving = useMemo(
    () => computeServing(visiblePoints, firstServer),
    [visiblePoints, firstServer]
  );
  const placementMappedPoints = useMemo(
    () =>
      mappedPointCount(
        visiblePoints,
        userSide,
        gameIndexByPoint,
        serving,
        placementServesOnly
      ),
    [visiblePoints, userSide, gameIndexByPoint, serving, placementServesOnly]
  );
  // "Looks wrong" on the whole match's maps. Optimistic like the per-point
  // flag: the section stands down on the tap, and a failed write puts it
  // straight back.
  const [placementFlagged, setPlacementFlagged] = useState(
    match.placement_flagged === true
  );
  const savePlacementFlagged = useCallback(
    (flagged: boolean) => {
      setPlacementFlagged(flagged);
      match.placement_flagged = flagged;
      void createClient()
        .from("matches")
        .update({ placement_flagged: flagged })
        .eq("id", match.id)
        .then(({ error }) => {
          if (!error) return;
          setPlacementFlagged(!flagged);
          match.placement_flagged = !flagged;
        });
    },
    [match]
  );
  const placementNotice = placementNoticeForViewer(placement.view, isOwner);
  // A coach's maps are the public share page's maps (Adil, 2026-09-02):
  // the same collectors, the same three-point floor, the same read-only
  // deck. The owner keeps the interactive aggregate below.
  const coachPlacement = useMemo(() => {
    if (isOwner) return null;
    if (match.placement_status !== "ready" || placementFlagged) return null;
    const observations = (
      placementServesOnly
        ? collectServePlacementObservations
        : collectTrustedPlacementObservations
    )({ points: visiblePoints, userSide, gameIndexByPoint, serving });
    const mapped = trustedPlacementPointCount(observations);
    return mapped < 3 ? null : { observations, mapped };
  }, [
    isOwner,
    match.placement_status,
    placementFlagged,
    placementServesOnly,
    visiblePoints,
    userSide,
    gameIndexByPoint,
    serving,
  ]);
  const showPointPlacementNotice = showPlacementDeepDive(
    placement.view,
    false,
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
  const analysis = useMemo(
    () =>
      computeMatchAnalysis(
        visiblePoints,
        serving,
        new Map(),
        customReasonLabels
      ),
    [visiblePoints, serving, customReasonLabels]
  );
  // The timeline is the page's spine, but a 156-point match buries
  // everything under it — you cannot reach the analysis without scrolling
  // past every rally. So it shows a window by default and opens on request.
  //
  // The choice is a PREFERENCE, not per-match state: someone who works
  // through every point wants that on every match, so it persists globally
  // and survives navigating away. Collapsed is the default because the
  // majority visit is "watch a few, read the analysis".
  const [pointsExpanded, setPointsExpanded] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(POINTS_EXPANDED_KEY) === "1") {
        setPointsExpanded(true);
      }
    } catch {
      // private mode / storage disabled: collapsed is a fine default
    }
  }, []);
  // Selecting a point the window doesn't cover has to open the list, or the
  // deep link, the arrow keys and prev/next would all point at a card that
  // isn't rendered. Opening is the honest resolution; it is also what the
  // person asking for point 120 clearly wants.
  useEffect(() => {
    if (pointsExpanded || !activePointId) return;
    const i = visiblePoints.findIndex((p) => p.id === activePointId);
    if (i >= POINTS_PREVIEW) setPointsExpanded(true);
  }, [activePointId, visiblePoints, pointsExpanded]);

  const togglePoints = useCallback(() => {
    setPointsExpanded((v) => {
      const next = !v;
      try {
        localStorage.setItem(POINTS_EXPANDED_KEY, next ? "1" : "0");
      } catch {
        // preference just won't persist; the toggle still works
      }
      return next;
    });
  }, []);

  // ---- point filters (mirrors the Matches library overlay) ----
  const [pointFiltersOpen, setPointFiltersOpen] = useState(false);
  const [pf, setPf] = useState<{
    served: "any" | "me" | "them";
    won: "any" | "me" | "them";
    tagId: string | null;
    starred: boolean;
    skipped: boolean;
    deleted: boolean;
  }>({
    served: "any",
    won: "any",
    tagId: null,
    starred: false,
    skipped: false,
    deleted: false,
  });
  const pfActive =
    pf.served !== "any" ||
    pf.won !== "any" ||
    pf.tagId !== null ||
    pf.starred ||
    pf.skipped ||
    pf.deleted;
  const clearPointFilters = useCallback(
    () =>
      setPf({
        served: "any",
        won: "any",
        tagId: null,
        starred: false,
        skipped: false,
        deleted: false,
      }),
    []
  );
  const filteredPoints = useMemo(() => {
    if (!pfActive || pf.deleted) return visiblePoints;
    return visiblePoints.filter((p) => {
      if (pf.starred && !p.starred) return false;
      if (pf.skipped && !p.is_let) return false;
      if (pf.tagId === "any") {
        if ((tagsByPoint.get(p.id) ?? []).length === 0) return false;
      } else if (
        pf.tagId &&
        !(tagsByPoint.get(p.id) ?? []).some((t) => t.id === pf.tagId)
      ) {
        return false;
      }
      const srv = serving.get(p.id)?.server ?? p.server ?? null;
      if (pf.served === "me" && srv !== "user") return false;
      if (pf.served === "them" && srv !== "opponent") return false;
      if (pf.won === "me" && p.confirmed_winner !== "user") return false;
      if (pf.won === "them" && p.confirmed_winner !== "opponent") return false;
      return true;
    });
  }, [pfActive, pf, visiblePoints, tagsByPoint, serving]);
  // Display numbers must survive filtering: number by position in the
  // FULL timeline, never by position in whatever subset is shown.
  const visibleIndexById = useMemo(() => {
    const m = new Map<string, number>();
    visiblePoints.forEach((p, i) => m.set(p.id, i));
    return m;
  }, [visiblePoints]);

  // ---- game checkpoints: jump chips to each game's first point ----
  const gameStarts = useMemo(() => {
    const out: { game: number; pointId: string }[] = [];
    if (visiblePoints.length > 0) {
      out.push({ game: 1, pointId: visiblePoints[0].id });
    }
    visiblePoints.forEach((p, i) => {
      const b = score.boundaryAfter.get(p.id);
      const next = visiblePoints[i + 1];
      if (b && next) out.push({ game: b.game + 1, pointId: next.id });
    });
    return out;
  }, [visiblePoints, score]);
  /**
   * Where the video says the players swapped ends and the score has not
   * said so yet (140/146). Purely a marker: it is never folded into the
   * boundary walk, so nothing below this line changes what a match scores.
   * Fades as the match gets scored — see sideChanges.ts.
   */
  const sideChanges = useMemo(
    () =>
      sideChangesByPoint({
        evidence: match.match_structure,
        visiblePoints,
        boundaryAfter: score.boundaryAfter,
        enabled: gameEndDetection,
        scoredType: scored,
      }),
    [
      match.match_structure,
      visiblePoints,
      score.boundaryAfter,
      gameEndDetection,
      scored,
    ]
  );

  /**
   * The match split into games — the same boundary walk the score uses, so
   * "Game 3" here is the Game 3 everywhere else. Feeds the unscore picker,
   * which needs each game's points, its score, and whether it finished.
   */
  const gameSegments = useMemo(() => {
    const out: {
      game: number;
      pointIds: string[];
      you: number;
      them: number;
      complete: boolean;
    }[] = [];
    let run: string[] = [];
    for (const p of visiblePoints) {
      run.push(p.id);
      const b = score.boundaryAfter.get(p.id);
      if (b) {
        out.push({
          game: b.game,
          pointIds: run,
          you: b.you,
          them: b.them,
          complete: true,
        });
        run = [];
      }
    }
    // Whatever trails the last boundary is the game still in progress.
    if (run.length > 0) {
      out.push({
        game: out.length + 1,
        pointIds: run,
        you: score.current.you,
        them: score.current.them,
        complete: false,
      });
    }
    return out;
  }, [visiblePoints, score]);

  const jumpToGame = useCallback((pointId: string) => {
    // The target card must be rendered before it can be scrolled to.
    setPointsExpanded(true);
    setTimeout(() => {
      document
        .getElementById(`point-card-${pointId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, []);

  const shownPoints = pfActive
    ? filteredPoints
    : pointsExpanded
      ? visiblePoints
      : visiblePoints.slice(0, POINTS_PREVIEW);
  const hiddenPoints = pfActive
    ? 0
    : visiblePoints.length - shownPoints.length;

  // The bottom sections the Tools rows smooth-scroll to (analysis, overall
  // notes) and the Tools card itself (the back-to-top target).
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
        .update(userFirstServerUpdate(value))
        .eq("id", match.id);
      if (error) setFirstServer(prev);
      else {
        match.first_server = value;
        match.first_server_source = "user";
      }
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
    async (
      point: Point,
      next: "user" | "opponent" | null,
      scoredAtCutS?: number
    ) => {
      const prev = point.confirmed_winner;
      const prevLet = point.is_let;
      const clearLet = next !== null && prevLet;
      if (prev === next && !clearLet) return;
      const patch: Partial<Point> = {
        confirmed_winner: next,
        // The playhead label rides with the score and dies with it (067).
        scored_at_cut_s:
          next === null ? null : (scoredAtCutS ?? point.scored_at_cut_s ?? null),
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

  // Admin-only serve-start label (089). Deliberately NOT coupled to the
  // score the way scored_at_cut_s is: where the serve began is true
  // regardless of who won, so clearing a winner must not clear it. Passing
  // null clears the label itself.
  const setServeStart = useCallback(
    async (
      point: Point,
      atCutS: number | null,
      meta: ServeStartMeta | null
    ) => {
      const prevAt = point.serve_start_at_cut_s ?? null;
      const prevMeta = point.serve_start_meta ?? null;
      const patch: Partial<Point> = {
        serve_start_at_cut_s: atCutS,
        serve_start_meta: atCutS === null ? null : meta,
      };
      updatePoint(point.id, patch);
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update(patch)
        .eq("id", point.id);
      // The trigger rejects a non-admin write, so a failure here rolls the
      // label back rather than leaving the UI claiming a label that the DB
      // refused.
      if (error)
        updatePoint(point.id, {
          serve_start_at_cut_s: prevAt,
          serve_start_meta: prevMeta,
        });
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

  // Optimistic serve correction. The Keep-score serve balls, the point
  // sheet's "Who served?" and the point-list chip menu ALL land here, so
  // there is one implementation of what a correction means. `next: null`
  // clears this point's own correction.
  //
  // set_server_override (migration 100) writes the anchor and clears every
  // correction AFTER it in the same statement. The rotation anchors to the
  // most recent override before each point, so a stale correction further
  // down the match used to win over this one and quietly undo it from
  // there on — fixing one rotation meant re-tapping every correction
  // downstream. Corrections BEFORE this one stand: they anchor a stretch
  // this one does not speak for.
  const setServerOverride = useCallback(
    async (point: Point, next: "user" | "opponent" | null) => {
      const i = visiblePoints.findIndex((p) => p.id === point.id);
      // The clear is mirrored locally as well as written: the rows go
      // clean either way, but the chips downstream would keep their
      // override styling until a reload.
      const stale =
        i < 0
          ? []
          : visiblePoints
              .slice(i + 1)
              .filter((p) => p.server_override !== null)
              .map((p) => ({ id: p.id, was: p.server_override }));
      const prev = point.server_override;
      updatePoint(point.id, { server_override: next });
      for (const s of stale) updatePoint(s.id, { server_override: null });
      const supabase = createClient();
      const { error } = await supabase.rpc("set_server_override", {
        p_id: point.id,
        p_value: next,
      });
      if (error) {
        updatePoint(point.id, { server_override: prev });
        for (const s of stale) updatePoint(s.id, { server_override: s.was });
      }
    },
    [updatePoint, visiblePoints]
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
      // A named game winner (099) belongs to the 'end' pinned here: unpin
      // the end and the answer has nothing to be the answer to, so it goes
      // in the SAME write — never a stale winner on a point that no longer
      // closes a game.
      const prevWinner = point.game_winner_override;
      const clearWinner = next !== "end" && prevWinner !== null;
      const patch: Partial<Point> = {
        game_end_override: next,
        ...(clearWinner ? { game_winner_override: null } : {}),
      };
      updatePoint(point.id, patch);
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update(patch)
        .eq("id", point.id);
      if (error) {
        updatePoint(point.id, {
          game_end_override: prev,
          ...(clearWinner ? { game_winner_override: prevWinner } : {}),
        });
        return false;
      }
      return true;
    },
    [updatePoint]
  );

  // Optimistic game-winner naming (099): who took the game that ends at
  // this point, for pinned ends the score can't prove. Passing null clears
  // the answer (the divider sheet's toggle-off).
  const setGameWinnerOverride = useCallback(
    async (point: Point, next: "user" | "opponent" | null) => {
      const prev = point.game_winner_override;
      if (prev === next) return;
      updatePoint(point.id, { game_winner_override: next });
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update({ game_winner_override: next })
        .eq("id", point.id);
      if (error) updatePoint(point.id, { game_winner_override: prev });
    },
    [updatePoint]
  );

  // Hide a detected side-change marker (146). Display only, and
  // deliberately NOT a 'continue' override: 'continue' suppresses the
  // automatic 11-clear-by-2 rule from here on, which is a real change to
  // the score, and saying "they just changed ends" must cost nothing.
  const dismissSideChange = useCallback(
    async (point: Point) => {
      updatePoint(point.id, { side_change_dismissed: true });
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update({ side_change_dismissed: true })
        .eq("id", point.id);
      if (error) updatePoint(point.id, { side_change_dismissed: false });
    },
    [updatePoint]
  );

  // Nudge a game boundary one point earlier ("up") or later ("down") from
  // the divider — for when a rally near the end of a game landed in the
  // wrong game (e.g. the score ran past 11 and a point belongs to the next
  // game). Boundaries are POSITIONAL overrides: moving up pins 'end' on the
  // previous point (this boundary point then joins the game below); moving
  // down holds this game open through the point and pins 'end' on the next
  // (that next point joins the game above). One tap, no per-point sheets.
  const moveGameBoundary = useCallback(
    async (boundaryPoint: Point, dir: "up" | "down") => {
      const ps = visiblePoints;
      const i = ps.findIndex((p) => p.id === boundaryPoint.id);
      if (i < 0) return;
      if (dir === "up") {
        const prev = ps[i - 1];
        if (!prev) return;
        await setGameEndOverride(prev, "end");
        await setGameEndOverride(boundaryPoint, null);
      } else {
        const next = ps[i + 1];
        if (!next) return;
        await setGameEndOverride(boundaryPoint, "continue");
        await setGameEndOverride(next, "end");
      }
    },
    [visiblePoints, setGameEndOverride]
  );

  const dismissSnackbar = useCallback(() => {
    if (snackbarTimer.current) window.clearTimeout(snackbarTimer.current);
    snackbarTimer.current = null;
    setSnackbar(null);
  }, []);

  // Undo accepts one id (Player undo stack, Removed list) or a whole set
  // (the bulk snackbar) — either way it's ONE restore write. Defined above
  // its producers: the snackbar entries close over it.
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
      setSnackbar({
        text: "Point removed",
        undo: () => void undoDelete([point.id]),
      });
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
    [updatePoint, dismissSnackbar, undoDelete, visiblePoints]
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
        undo: () => void undoDelete([...ids]),
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
    [visiblePoints, dismissSnackbar, undoDelete]
  );

  // The pad's "match starts here" sweep: same write as deleteAllBefore but
  // NO snackbar — the takeover covers it, and the pad's own undo stack
  // owns recovery (one bulk-delete entry).
  const deleteAllBeforeQuiet = useCallback(
    async (point: Point) => {
      const idx = visiblePoints.findIndex((p) => p.id === point.id);
      if (idx < 1) return;
      const ids = new Set(visiblePoints.slice(0, idx).map((p) => p.id));
      setPoints((ps) =>
        ps.map((p) => (ids.has(p.id) ? { ...p, deleted: true } : p))
      );
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update({ deleted: true })
        .in("id", [...ids]);
      if (error)
        setPoints((ps) =>
          ps.map((p) => (ids.has(p.id) ? { ...p, deleted: false } : p))
        );
    },
    [visiblePoints]
  );

  // The owner's own name: their tagged side's name (a null user_side falls
  // back to near, matching /api/reel), else the account first name — or, for
  // a coach, the owner's name from match_owner_name. The account name means
  // we never have to ASK the owner for their own name; ownerName means a
  // coach is never shown the word "Player" where a person should be.
  const ownName = useMemo(() => {
    const tagged = (userSide === "far" ? farName : nearName).trim();
    if (tagged) return tagged;
    return isOwner
      ? (accountName ?? "").trim()
      : (ownerName ?? "").trim();
  }, [userSide, nearName, farName, isOwner, accountName, ownerName]);

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
  const router = useRouter();
  const [scoreDetached, setScoreDetached] = useState(false);
  /** Per-game breakdown revealed under the games total, in the page header
   *  and in the floating bar independently. */
  const [barScoreOpen, setBarScoreOpen] = useState(false);
  const [headerScoreOpen, setHeaderScoreOpen] = useState(false);
  /** The spoken score's own disclosure while it stands in the slot. */
  const [spokenOpen, setSpokenOpen] = useState(false);
  const [spokenEditing, setSpokenEditing] = useState(false);
  const [spokenRows, setSpokenRows] = useState(() =>
    cleanSpoken(match.spoken_scores)
  );
  /** Owner-only match settings (unscore / delete) next to the title. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmUnscore, setConfirmUnscore] = useState(false);
  const [unscoring, setUnscoring] = useState(false);
  const [unscoreError, setUnscoreError] = useState<string | null>(null);
  /** Unscore target: the whole match, or the game numbers ticked below it. */
  const [unscoreWhole, setUnscoreWhole] = useState(true);
  const [unscoreGames, setUnscoreGames] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBytes, setDeleteBytes] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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

  /**
   * Unscore: clear every answer the scorer wrote, across every point,
   * leaving the match itself intact — the points, their clips, stars, tags,
   * notes and deleted-point state all survive, as does who served first, so
   * scoring again picks up from the setup you already did.
   *
   * No API route needed: points' UPDATE policy is owner-only (a coach can
   * read this match but not write it), so RLS is the authorisation.
   */
  const unscoreMatch = useCallback(async () => {
    setUnscoring(true);
    setUnscoreError(null);
    const supabase = createClient();
    // Everything the scorer wrote. game_end_override is handled separately:
    // clearing it is right for the whole match and wrong for one game.
    const CLEARED = {
      confirmed_winner: null,
      confirmed_how: null,
      is_let: false,
      server_override: null,
      serve_spin: null,
      serve_sidespin: null,
      serve_length: null,
      direction: null,
      loss_reasons: null,
      misread_kind: null,
    };
    try {
      if (unscoreWhole) {
        const { error } = await supabase
          .from("points")
          .update({ ...CLEARED, game_end_override: null })
          .eq("match_id", match.id);
        if (error) throw error;
      } else {
        const picked = gameSegments.filter((s) => unscoreGames.has(s.game));
        const ids = picked.flatMap((s) => s.pointIds);
        // Pin each cleared game's end where it already is. A game normally
        // closes because someone reached 11 — take those scores away and
        // the automatic boundary stops firing, so Game 2 and Game 3 would
        // silently merge and every game after would renumber. The last
        // game needs no pin: nothing follows it to run into.
        const lastGame = gameSegments[gameSegments.length - 1]?.game;
        const pins = picked
          .filter((s) => s.complete && s.game !== lastGame)
          .map((s) => s.pointIds[s.pointIds.length - 1]);
        // Chunked: ids ride in the query string.
        for (let i = 0; i < ids.length; i += 100) {
          const { error } = await supabase
            .from("points")
            .update(CLEARED)
            .in("id", ids.slice(i, i + 100));
          if (error) throw error;
        }
        if (pins.length > 0) {
          const { error } = await supabase
            .from("points")
            .update({ game_end_override: "end" })
            .in("id", pins);
          if (error) throw error;
        }
      }
    } catch {
      setUnscoreError("Couldn't unscore. Try again.");
      setUnscoring(false);
      return;
    }
    // Every surface on this page reads from the points held in state — the
    // score, the analysis, the serve rotation, the game rail. Reloading is
    // the honest way to bring all of them back in step at once.
    window.location.reload();
  }, [match.id, unscoreWhole, unscoreGames, gameSegments]);

  const openDeleteConfirm = useCallback(async () => {
    setSettingsOpen(false);
    setConfirmDelete(true);
    setDeleteBytes(null);
    setDeleteError(null);
    try {
      const res = await fetch("/api/delete-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", matchId: match.id }),
      });
      const data = res.ok ? await res.json() : null;
      setDeleteBytes(typeof data?.bytes === "number" ? data.bytes : 0);
    } catch {
      setDeleteBytes(0);
    }
  }, [match.id]);

  const deleteMatch = useCallback(async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/delete-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", matchId: match.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "delete failed");
      // replace, not push: Back must not return to a match that is gone.
      router.replace("/matches");
    } catch (e) {
      setDeleteError(
        e instanceof Error && e.message !== "delete failed"
          ? e.message
          : "Could not delete the match. Try again."
      );
      setDeleting(false);
    }
  }, [match.id, router]);

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

  /**
   * Add a card for a rally the cut missed.
   *
   * insert_point (101) does the whole thing in one statement: creates the
   * card, trims each neighbour only where the new window overlapped it, and
   * clears the serve corrections after it — an insert changes the rotation
   * from here on, so a correction downstream was answering a rotation that
   * no longer exists.
   *
   * The rotation itself needs nothing else. It is a COUNT of cards, so
   * restoring the beat fixes who served every later point, the score, the
   * deuce switch and the game boundaries at once, with no correction at all.
   */
  const insertMissingPoint = useCallback(
    async (
      prevPoint: Point | null,
      nextPoint: Point | null,
      t0: number,
      t1: number,
      cutT0: number,
      winner: "user" | "opponent" | null
    ): Promise<boolean> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("insert_point", {
        p_prev_id: prevPoint?.id ?? null,
        p_next_id: nextPoint?.id ?? null,
        p_t0: t0,
        p_t1: t1,
        p_cut_t0: cutT0,
      });
      if (error || !data) return false;
      const created = data as Point;
      addSplitPoint(created);
      // Mirror what the RPC did to the neighbours and to any stale
      // corrections, so the strip is truthful before any refetch.
      if (prevPoint && prevPoint.t1 !== null && Number(prevPoint.t1) > t0) {
        updatePoint(prevPoint.id, { t1: t0, edited: true });
      }
      if (nextPoint && nextPoint.t0 !== null && Number(nextPoint.t0) < t1) {
        updatePoint(nextPoint.id, { t0: t1, edited: true });
      }
      for (const p of visiblePoints) {
        if (p.server_override === null) continue;
        if (p.t0 !== null && Number(p.t0) > t0) {
          updatePoint(p.id, { server_override: null });
        }
      }
      // The clip has to be cut from the raw: this footage is either missing
      // from the cut video entirely or shared with a neighbour that just
      // gave it up.
      scheduleReclip();
      if (winner) void setWinner(created, winner);
      return true;
    },
    [
      addSplitPoint,
      updatePoint,
      visiblePoints,
      scheduleReclip,
      setWinner,
    ]
  );

  // The Adjust save — ONE timing write for both surfaces (the pad's Modify
  // and the point view's). Tight flags dissolve when their edge moved
  // (adjustPatch), unless the undo path pins them back explicitly. A DB
  // trigger marks the point edited on any t0/t1 change; the optimistic
  // mirror sets it too so the "Updating clip" state shows immediately.
  const adjustPointTiming = useCallback(
    async (
      point: Point,
      t0New: number,
      t1New: number,
      tight?: { tight_start: boolean; tight_end: boolean }
    ): Promise<boolean> => {
      const patch: Partial<Point> = tight
        ? { t0: t0New, t1: t1New, ...tight }
        : adjustPatch(point, t0New, t1New);
      const prev: Partial<Point> = {
        t0: point.t0,
        t1: point.t1,
        tight_start: point.tight_start,
        tight_end: point.tight_end,
        edited: point.edited,
      };
      updatePoint(point.id, { ...patch, edited: true });
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update(patch)
        .eq("id", point.id);
      if (error) {
        updatePoint(point.id, prev);
        return false;
      }
      scheduleReclip();
      return true;
    },
    [updatePoint, scheduleReclip]
  );

  // Cmd/Ctrl+Z presses the snackbar's Undo while it's on screen. The
  // Keep-score takeover has its own undo stack (and its own key handling);
  // typing surfaces keep the browser's text undo.
  useEffect(() => {
    if (!snackbar) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      snackbar.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snackbar]);

  /**
   * The point view's Modify → Split. Same machinery as the pad's
   * (modifyOps.runSplitPlan); recovery is the snackbar rather than the
   * pad's session undo stack — one compound Undo reverses every split and
   * puts the root point's outcome back.
   */
  const modifySplitFromDetail = useCallback(
    async (
      point: Point,
      cutTimes: number[],
      segments: ("user" | "opponent" | "skip")[]
    ): Promise<boolean> => {
      const origWinner = point.confirmed_winner;
      const origSkipped = point.is_let;
      const { ok, created, unsplits } = await runSplitPlan({
        point,
        pad,
        cutTimes,
        onChild: (parent, patch, child) => {
          updatePoint(parent.id, patch);
          addSplitPoint(child);
        },
      });
      if (created.length > 0) scheduleReclip();
      if (!ok && unsplits.length === 0) return false;
      const segPoints = [point, ...created];
      for (let i = 0; i < segPoints.length && i < segments.length; i++) {
        const d = segments[i];
        if (d === "skip") void setSkipped(segPoints[i], true);
        else void setWinner(segPoints[i], d);
      }
      const undoSplit = () => {
        dismissSnackbar();
        void (async () => {
          const supabase = createClient();
          for (const u of unsplits) {
            const { error } = await supabase.rpc("unsplit_point", {
              p_parent: u.parentId,
              p_child: u.childId,
              parent_t1: u.prevT1,
              parent_tight_end: u.prevTightEnd,
              parent_edited: u.prevEdited,
            });
            if (error) return;
            setPoints((ps) =>
              ps
                .filter((p) => p.id !== u.childId)
                .map((p) =>
                  p.id === u.parentId
                    ? { ...p, t1: u.prevT1, tight_end: u.prevTightEnd, edited: true }
                    : p
                )
            );
          }
          // The root row survives every unsplit; the writes key on its id.
          // Its state right now is whatever the modal's first segment set,
          // so hand setWinner/setSkipped THAT as the baseline — the stale
          // pre-split object would trip their no-change guards.
          const seg0 = segments[0];
          const rootNow = {
            ...point,
            confirmed_winner: seg0 === "skip" ? null : (seg0 ?? null),
            is_let: seg0 === "skip",
          } as Point;
          void setWinner(rootNow, origWinner);
          if (rootNow.is_let !== origSkipped)
            void setSkipped({ ...rootNow, confirmed_winner: origWinner }, origSkipped);
          scheduleReclip();
        })();
      };
      if (snackbarTimer.current) window.clearTimeout(snackbarTimer.current);
      setSnackbar({
        text: ok
          ? `Split into ${segPoints.length}`
          : "Split partly failed — Undo reverts what landed",
        undo: undoSplit,
      });
      snackbarTimer.current = window.setTimeout(() => setSnackbar(null), 10000);
      return ok;
    },
    [
      pad,
      updatePoint,
      addSplitPoint,
      scheduleReclip,
      setWinner,
      setSkipped,
      dismissSnackbar,
    ]
  );

  /** The point view's Modify → Join (merge_points is destructive — the
   *  modal confirms; no undo, same as the pad). */
  const modifyJoinFromDetail = useCallback(
    async (
      point: Point,
      count: number,
      winner: "user" | "opponent" | "skip"
    ): Promise<boolean> => {
      const plan = await runJoinPlan({ point, points: visiblePoints, count });
      if (!plan) return false;
      const drop = new Set(plan.mergedIds);
      setPoints((ps) =>
        ps
          .filter((p) => !drop.has(p.id))
          .map((p) => (p.id === point.id ? { ...p, ...plan.survivorPatch } : p))
      );
      scheduleReclip();
      if (winner === "skip") void setSkipped(plan.survivor, true);
      else void setWinner(plan.survivor, winner);
      return true;
    },
    [visiblePoints, scheduleReclip, setWinner, setSkipped]
  );

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
      // Nullable so a failed write can put an unanswered match back to
      // unanswered rather than leaving the optimistic side showing.
      userSide?: Side | null;
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
      const prev = {
        userSide,
        nearName,
        farName,
        opponentName,
      };
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
      const { error } = await supabase
        .from("matches")
        .update({
          user_side: side,
          player_near_name: near || null,
          player_far_name: far || null,
          ...(opponent ? { opponent_name: opponent } : {}),
        })
        .eq("id", match.id);
      // This used to be fire and forget over an optimistic local update,
      // so a write that failed — an expired session answers 204 and
      // changes nothing — looked exactly like a write that worked, and
      // the question came back on the next load with no explanation.
      // Put the old answer back and say so instead.
      if (error) {
        onTaggingChange(prev);
        setSideError("That didn't save. Check your connection and try again.");
        return;
      }
      setSideError(null);
    },
    [
      accountName,
      opponentName,
      nearName,
      farName,
      userSide,
      onTaggingChange,
      match.id,
    ]
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
      {/* Up, not back: this always climbs to the match library, so it says
          where it goes and behaves the same whether you arrived from Home,
          a share link or a cold tab. The browser's own Back
          (and the Android hardware key) still walks history — the two are
          different jobs. Built as a pill because everything else you can
          press on this page is one; the bare text link read like a
          leftover. The same control reappears in the bar below once the
          header scrolls away, so it is never off screen. */}
      <Link
        href="/matches"
        className="group inline-flex items-center gap-2 rounded-full border border-edge bg-surface/70 py-1.5 pl-1.5 pr-4 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-zinc-400 transition-colors group-hover:text-cyan-glow">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m15 6-6 6 6 6"
            />
          </svg>
        </span>
        Matches
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
          {/* Match settings: the two actions that change or end the match
              as a whole, kept out of the scorer (where every control edits
              ONE point) and off the pencil (which edits the details). */}
          {isOwner && (
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
                      disabled={score.confirmedCount === 0}
                      onClick={() => {
                        setSettingsOpen(false);
                        setUnscoreError(null);
                        // Reopen always starts at the whole match, never at
                        // whatever was ticked last time.
                        setUnscoreWhole(true);
                        setUnscoreGames(new Set());
                        setConfirmUnscore(true);
                      }}
                      className="flex w-full items-center gap-2.5 whitespace-nowrap px-3.5 py-2 text-left text-[13px] font-medium text-zinc-200 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4 shrink-0 text-zinc-400"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4"
                        />
                      </svg>
                      Unscore match
                    </button>
                    <div className="mx-3 my-1 border-t border-edge/60" />
                    <button
                      type="button"
                      onClick={() => void openDeleteConfirm()}
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
                          d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-.7 12.1a2 2 0 0 1-2 1.9H8.7a2 2 0 0 1-2-1.9L6 7m4 4v6m4-6v6"
                        />
                      </svg>
                      Delete match
                    </button>
                  </div>
                </>
              )}
            </span>
          )}
        </div>

        {/* meta line: date · type on the left, score on the right.
            The score is the games total, not the per-game line: the line
            needed so much of this row that it was cut off mid-number AND
            squeezed the date down to "Jul 30, 202…". Two short numbers
            leave the date whole, and the breakdown opens underneath at
            full width, where it wraps instead of scrolling. */}
        <div className="mt-1 flex items-baseline justify-between gap-4">
          <p className="min-w-0 truncate text-sm text-zinc-500">
            {titleParts.secondary}
          </p>
          {/* `scored` too, not just "has winners": a match that was scored
              and then re-tagged as practice keeps its winner rows in the
              database, and a games total beside the word "Practice" reads
              as a contradiction. Flip the type back and the score returns. */}
          {scored && score.confirmedCount > 0 ? (
            <GamesToggle
              score={score}
              open={headerScoreOpen}
              onToggle={() => setHeaderScoreOpen((o) => !o)}
              className="text-lg font-bold tracking-tight sm:text-xl lg:text-2xl"
            />
          ) : (
            spokenRows.length > 0 && (
              // No scored result yet: the spoken score stands in the
              // slot, muted and labelled. Which number is the record is
              // answered by weight before anyone reads the label.
              <SpokenGamesToggle
                rows={spokenRows}
                open={spokenOpen}
                onToggle={() => setSpokenOpen((o) => !o)}
                className="text-lg sm:text-xl"
              />
            )
          )}
        </div>
        {headerScoreOpen && scored && score.confirmedCount > 0 && (
          <>
            <ScoreLine
              wrap
              score={score}
              className="mt-2 text-sm font-semibold tabular-nums"
            />
            {/* The record, then the testimony, one weight apart. */}
            {spokenRows.length > 0 && !spokenEditing && (
              <button
                type="button"
                onClick={() => isOwner && setSpokenEditing(true)}
                className="mt-1.5 flex items-baseline gap-2 text-left"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                  Spoken
                </span>
                <SpokenLine rows={spokenRows} className="text-sm" />
              </button>
            )}
          </>
        )}
        {spokenOpen && !(scored && score.confirmedCount > 0) && !spokenEditing && (
          <div className="mt-2 space-y-1.5">
            <button
              type="button"
              onClick={() => isOwner && setSpokenEditing(true)}
              className="block text-left"
            >
              <SpokenLine rows={spokenRows} className="text-sm font-semibold" />
            </button>
            {/* Spoken is the appetizer. The analysis only comes from
                scoring the points, and the nudge rides the peek. */}
            {isOwner && hasCutOffsets && scored && (
              <button
                type="button"
                onClick={() => playerRef.current?.openScore()}
                className="text-sm font-semibold text-cyan-glow"
              >
                Score the match to unlock your analysis →
              </button>
            )}
          </div>
        )}
        {spokenEditing && isOwner && (
          <SpokenScoreEditor
            matchId={match.id}
            initial={spokenRows}
            youLabel={ownSideName.trim() || "You"}
            themLabel={opponentName.trim() || "Opponent"}
            onClose={() => setSpokenEditing(false)}
            onSaved={(rows) => setSpokenRows(rows)}
          />
        )}

        {/* edit panel: the title is derived, so editing edits the fields */}
        {isOwner && titleEditing && (
          <div
            ref={detailsRef}
            className="mt-3 space-y-3 rounded-2xl border border-edge bg-surface p-4 sm:max-w-sm"
          >
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
            {/* Same suggestions as the upload form. This is where a name
                actually gets fixed after the fact, and one spelling per
                person is what makes "how do I do against X" possible
                later. */}
            <div className="block">
              <span className="text-xs font-medium text-zinc-400">Opponent</span>
              <div className="mt-1">
                <NameCombobox
                  value={opponentName}
                  options={pastOpponents}
                  onChange={setOpponentName}
                  onCommit={() => void saveOpponentName(opponentName)}
                  placeholder="Name"
                  ariaLabel="Opponent name"
                  className="w-full rounded-xl border border-edge bg-ink/60 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/60"
                />
              </div>
            </div>
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
            {/* The same five types the upload form offers, in the same
                order. This panel is where a recording that came in through
                the wrong door gets fixed, so a type missing here (drills
                was, and "match" could only be said by unsetting) meant the
                fix was impossible on exactly the page you'd look for it. */}
            <div className="flex flex-wrap gap-2">
              {(["drills", "practice", "match", "league", "tournament"] as const).map((t) => (
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
      </div>

      {/* Desktop: a full-width video hero, with Tools as a horizontal
          control-panel grid below. Mobile / portrait: stacked, Tools a list. */}
      <div>
        <div className="mt-4 flex min-w-0 flex-wrap items-start gap-3">
          <DownloadCard
            matchId={match.id}
            isOwner={isOwner}
            hasOriginal={hasOriginal}
          >
            <Player
              ref={playerRef}
              matchId={match.id}
              customReasons={customReasons}
              onCreateCustomReason={createCustomReason}
              points={visiblePoints}
              removedPoints={removedPoints}
              canScore={isOwner && hasCutOffsets}
              scoringRelevant={scored}
              opponentName={opponentName}
              youLabel={mapLabels.you}
              firstServer={firstServer}
              serveGuess={serveGuess}
              serving={serving}
              score={score}
              pad={pad}
              ends={ends}
              deletedSpans={deletedSpans}
              onDeletePoint={(p) => void deletePointQuiet(p)}
              onUndoDelete={(id) => void undoDelete(id)}
              onDeleteAllBefore={(p) => void deleteAllBeforeQuiet(p)}
              namesPrompt={namesPrompt}
              onSaveNames={(you, them) => void saveNames(you, them)}
              onSaveFirstServer={(v) => void saveFirstServer(v)}
              onSetWinner={(p, v, at) => void setWinner(p, v, at)}
              canLabelServeStart={canLabelServeStart}
              onSetServeStart={(p, at, meta) =>
                void setServeStart(p, at, meta)
              }
              onSetSkipped={(p, v) => void setSkipped(p, v)}
              onSetServer={(p, v) => void setServerOverride(p, v)}
              onInsertPoint={isOwner ? insertMissingPoint : undefined}
              onSetGameOverride={(p, v) => void setGameEndOverride(p, v)}
              onSetGameWinner={(p, v) => void setGameWinnerOverride(p, v)}
              sideChanges={sideChanges}
              onDismissSideChange={
                gameEndDetection && isOwner
                  ? (p) => void dismissSideChange(p)
                  : undefined
              }
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
              onAdjustTiming={adjustPointTiming}
              onOpenPoint={(id) => {
                const i = visiblePoints.findIndex((p) => p.id === id);
                if (i < 0) return;
                // Opening a point from the pad leaves Keep score, so
                // closing that point should bring it back — see
                // cameFromScore.
                cameFromScore.current = true;
                goToIndex(i);
              }}
              onOpenChange={setPlayerOpen}
              userId={userId}
              ownerId={match.user_id}
              notes={notes}
              authorNames={authorNames}
              onNoteAdded={(note) => setNotes((ns) => [...ns, note])}
              mapLabels={mapLabels}
              neutral={neutral}
              onPointUpdate={(id, patch) => updatePoint(id, patch)}
              tagsForPoint={tagsForPoint}
              tagVocab={sortedVocab}
              onToggleTag={(pointId, tag) => void toggleTag(pointId, tag)}
              onCreateTag={(pointId, label) =>
                void createTag(pointId, label)
              }
            />
          </DownloadCard>
        </div>

        {/* A coach viewing someone's match is exactly who paid reviews are
            for; one dismissible line, never for the owner. */}
        {!isOwner && (
          <div className="mt-4">
            <CoachCta compact />
          </div>
        )}

        {/* Tools: the owner's match actions in one card — score, share
            links, coach invite, export, and placement maps. Coach viewers never see it
            (every row is an owner action). On desktop this sits in the left
            column; scroll-mt keeps the back-to-top jump target clear. */}
        {isOwner && (
          <section className="mt-8 scroll-mt-32" ref={toolsRef}>
          <SectionHeading>Tools</SectionHeading>
          <div className="mt-3 w-full divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface lg:grid lg:grid-cols-3 lg:gap-3 lg:divide-y-0 lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent">
            {hasCutOffsets && scored && (
              <button
                type="button"
                onClick={() => playerRef.current?.openScore()}
                className={TOOL_ROW_CLASS}
              >
                {/* Games won, not the per-game line: this row is itself a
                    button (it opens the scorer), so it can't nest a
                    disclosure — and the line it used to show was cut off
                    mid-number with nothing to say the rest existed. Two
                    short numbers always fit, and the detail is one row up
                    in the header. */}
                <span className="shrink-0 text-sm font-semibold">
                  Score the Match
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  {score.confirmedCount > 0 && (
                    <GamesPair
                      score={score}
                      className="text-xs font-semibold"
                    />
                  )}
                  <ToolRowChevron />
                </span>
              </button>
            )}
            {hasCutOffsets && (
              <HighlightsRow
                matchId={match.id}
                points={visiblePoints}
                pad={pad}
                ends={ends}
                onPlay={(ids, onDownload) =>
                  playerRef.current?.openHighlights(ids, onDownload)
                }
              />
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
                tagOptions={tagShareOptions}
              />
            )}
            <PlacementToolsRow
              controller={placement}
              onReady={() => scrollToReadyPlacement(document)}
            />
            {/* Placement owns its lifecycle row above; this remains the one
                jump for the rest of the analysis area. Visible for the owner
                on scored types because the section carries its own teaching
                states; absent for practice, whose section it would jump to
                does not exist — every number in it derives from a confirmed
                score, and a practice never has one. */}
            {scored && (
              <button
                type="button"
                onClick={() => scrollToSection(matchStatsRef)}
                className={TOOL_ROW_CLASS}
              >
                <span className="text-sm font-semibold">Match analysis</span>
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
            )}
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
            {/* Match details: opponent, venue, type and your own name.
                The same panel the header pencil opens, named and sized
                like every other tool so it can actually be found. */}
            <button
              type="button"
              onClick={openDetails}
              className={TOOL_ROW_CLASS}
            >
              <span className="text-sm font-semibold">Match details</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="min-w-0 shrink truncate text-xs text-zinc-400">
                  {[opponentName.trim(), venue.trim()]
                    .filter(Boolean)
                    .join(" · ") || "Add opponent and venue"}
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
      </div>

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
                onClick={dismissSideBanner}
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
            {sideError && (
              <p role="alert" className="mt-3 text-sm text-amber-300/90">
                {sideError}
              </p>
            )}
          </section>
        )}

      {/* first server: anchors the ITTF serve rotation for every point —
          so it is only a question where a rotation exists. `scored` is
          tracksServe on the live type, which means changing a match to
          Practice takes the prompt away without a reload. */}
      {isOwner && scored && firstServer === null && visiblePoints.length > 0 && (
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
          <div className="flex items-center justify-between gap-3">
            <SectionHeading>Points</SectionHeading>
            {visiblePoints.length > 0 && (
              <button
                type="button"
                onClick={() => setPointFiltersOpen((o) => !o)}
                aria-expanded={pointFiltersOpen}
                aria-label="Filter points"
                className={`shrink-0 rounded-xl border p-2 transition-colors ${
                  pfActive || pointFiltersOpen
                    ? "border-cyan-glow/60 text-cyan-glow"
                    : "border-edge text-zinc-400 hover:text-zinc-200"
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
                  <path strokeLinecap="round" d="M4 6h16M7 12h10m-7 6h4" />
                </svg>
              </button>
            )}
          </div>

          {/* game checkpoints: nobody scrolls a 60-point timeline blind.
              Scored types only — games are a score construct. */}
          {scored && !pfActive && gameStarts.length > 1 && (
            <div className="relative mt-3">
              <div className="flex gap-1.5 overflow-x-auto pb-1 pr-8">
                {gameStarts.map((g) => (
                <button
                  key={g.game}
                  type="button"
                  onClick={() => jumpToGame(g.pointId)}
                  className="inline-flex shrink-0 items-center rounded-full border border-edge px-3 py-1 text-xs font-medium text-zinc-400 transition-colors hover:border-cyan-glow/40 hover:text-white"
                >
                    Game {g.game}
                  </button>
                ))}
              </div>
              {/* the cut-off edge is the "this scrolls" signal */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 w-10"
                style={{
                  background:
                    "linear-gradient(to left, #0a0a12 15%, transparent)",
                }}
              />
            </div>
          )}

          {pointFiltersOpen && (
            <div className="mt-3 space-y-3 rounded-2xl border border-edge/70 bg-surface/50 p-4">
              {(
                [
                  // Serve and winner are score facts, and practice collects
                  // neither — the filters would only ever return nothing.
                  ...(scored
                    ? [
                        {
                          label: "Serve",
                          row: (
                            <PfSegment
                              value={pf.served}
                              onChange={(v) => setPf({ ...pf, served: v, deleted: false })}
                              options={[
                                { value: "any", label: "Anyone" },
                                { value: "me", label: "I served" },
                                { value: "them", label: "They served" },
                              ]}
                            />
                          ),
                        },
                        {
                          label: "Winner",
                          row: (
                            <PfSegment
                              value={pf.won}
                              onChange={(v) => setPf({ ...pf, won: v, deleted: false })}
                              options={[
                                { value: "any", label: "Anyone" },
                                { value: "me", label: "I won" },
                                { value: "them", label: "They won" },
                              ]}
                            />
                          ),
                        },
                      ]
                    : []),
                  ...(tagShareOptions.length > 0
                    ? [
                        {
                          label: "Tag",
                          row: (
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                aria-pressed={pf.tagId === "any"}
                                onClick={() =>
                                  setPf({
                                    ...pf,
                                    tagId: pf.tagId === "any" ? null : "any",
                                    deleted: false,
                                  })
                                }
                                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                  pf.tagId === "any"
                                    ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                                    : "border-edge bg-ink/40 text-zinc-400 hover:border-cyan-glow/40"
                                }`}
                              >
                                Any tag
                              </button>
                              {tagShareOptions.map((t) => {
                                const on = pf.tagId === t.id;
                                return (
                                  <button
                                    key={t.id}
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() =>
                                      setPf({
                                        ...pf,
                                        tagId: on ? null : t.id,
                                        deleted: false,
                                      })
                                    }
                                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                      on
                                        ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                                        : "border-edge bg-ink/40 text-zinc-400 hover:border-cyan-glow/40"
                                    }`}
                                  >
                                    {t.label} <span className="opacity-60">{t.count}</span>
                                  </button>
                                );
                              })}
                            </div>
                          ),
                        },
                      ]
                    : []),
                  {
                    label: "Only",
                    row: (
                      <div className="flex flex-wrap gap-1.5">
                        {(
                          [
                            { key: "starred", label: "Starred" },
                            // "Skipped" partitions the scoring, which
                            // practice doesn't do.
                            ...(scored
                              ? ([{ key: "skipped", label: "Skipped" }] as const)
                              : []),
                            { key: "deleted", label: "Deleted" },
                          ] as const
                        ).map((o) => {
                          const on = pf[o.key];
                          return (
                            <button
                              key={o.key}
                              type="button"
                              aria-pressed={on}
                              onClick={() =>
                                o.key === "deleted"
                                  ? setPf({
                                      served: "any",
                                      won: "any",
                                      tagId: null,
                                      starred: false,
                                      skipped: false,
                                      deleted: !on,
                                    })
                                  : setPf({
                                      ...pf,
                                      [o.key]: !on,
                                      deleted: false,
                                    })
                              }
                              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                on
                                  ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                                  : "border-edge bg-ink/40 text-zinc-400 hover:border-cyan-glow/40"
                              }`}
                            >
                              {o.label}
                            </button>
                          );
                        })}
                      </div>
                    ),
                  },
                ] as { label: string; row: React.ReactNode }[]
              ).map(({ label, row }) => (
                <div key={label} className="flex items-start gap-3">
                  <span className="w-12 shrink-0 pt-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {label}
                  </span>
                  <div className="min-w-0 flex-1">{row}</div>
                </div>
              ))}
            </div>
          )}

          {pfActive && !pf.deleted && (
            <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
              <span>
                {filteredPoints.length} of {visiblePoints.length} points
              </span>
              <button
                type="button"
                onClick={clearPointFilters}
                className="font-medium text-cyan-glow transition-colors hover:text-white"
              >
                Clear filters
              </button>
            </div>
          )}

          {pf.deleted ? (
            <div className="mt-3">
              {removedPoints.length === 0 ? (
                <p className="text-sm text-zinc-500">No removed points.</p>
              ) : (
                <ul className="space-y-2">
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
                        {isOwner && (
                          <button
                            type="button"
                            onClick={() => void undoDelete(p.id)}
                            className="shrink-0 rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
                          >
                            Restore
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <button
                type="button"
                onClick={clearPointFilters}
                className="mt-3 text-xs font-medium text-cyan-glow transition-colors hover:text-white"
              >
                Back to the timeline
              </button>
            </div>
          ) : points.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              No point breakdown for this match.
            </p>
          ) : visiblePoints.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              No points in the timeline.
            </p>
          ) : pfActive && filteredPoints.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              No points match these filters.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {shownPoints.map((point, i) => {
                const duration =
                  point.t0 !== null && point.t1 !== null
                    ? Math.max(0, Number(point.t1) - Number(point.t0))
                    : null;
                const noteCount = noteCountByPoint.get(point.id) ?? 0;
                const tagCount = tagsByPoint.get(point.id)?.length ?? 0;
                const isActive = isDesktop && panePoint?.id === point.id;
                const nextGame = score.boundaryAfter.get(point.id);
                const displayNo = (visibleIndexById.get(point.id) ?? i) + 1;
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
                      aria-label={`Open point ${displayNo}`}
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
                        {displayNo}
                      </span>
                      <div className="min-w-0 flex-1">
                        {/* the chip is its own tap target (server menu),
                            so it lives outside the open-point button */}
                        <div className="flex flex-wrap items-center gap-2">
                          {scored && <ServerChipMenu
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
                            onSetServer={(v) => setServerOverride(point, v)}
                          />}
                          {scored && point.confirmed_winner && !point.is_let && (
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
                            <span
                              className="inline-flex items-center gap-1 text-zinc-500"
                              aria-label={`${noteCount} note${
                                noteCount === 1 ? "" : "s"
                              }`}
                              title={`${noteCount} note${
                                noteCount === 1 ? "" : "s"
                              }`}
                            >
                              <NoteGlyph className="h-3.5 w-3.5 shrink-0" />
                              {noteCount > 1 && (
                                <span className="tabular-nums">{noteCount}</span>
                              )}
                            </span>
                          )}
                          {tagCount > 0 && (
                            <span
                              className="inline-flex items-center gap-1 text-zinc-500"
                              aria-label={`${tagCount} tag${
                                tagCount === 1 ? "" : "s"
                              }`}
                              title={(tagsByPoint.get(point.id) ?? [])
                                .map((t) => t.label)
                                .join(", ")}
                            >
                              <TagGlyph className="h-3.5 w-3.5 shrink-0" />
                              {tagCount > 1 && (
                                <span className="tabular-nums">{tagCount}</span>
                              )}
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
                          skipped points never score, tap again to un-skip.
                          Scored types only: a practice point has no winner
                          to collect, so the rally list is just the rallies. */}
                      {isOwner && scored && (
                        <span className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void tapWinner(point, "user");
                            }}
                            aria-pressed={point.confirmed_winner === "user"}
                            aria-label={`Point ${displayNo}: I won`}
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
                            aria-label={`Point ${displayNo}: they won`}
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
                            aria-label={`Point ${displayNo}: ${
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
                      {!isOwner && (
                        <span className="flex shrink-0 flex-col items-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTagPickerPoint(point);
                            }}
                            aria-label={`Tag point ${displayNo}`}
                            className={`rounded-full p-1.5 transition-colors ${
                              tagCount > 0
                                ? "text-cyan-glow"
                                : "text-zinc-600 hover:text-zinc-400"
                            }`}
                          >
                            <TagGlyph className="h-5 w-5" />
                          </button>
                          {point.starred && (
                            <span className="p-1.5 text-amber-300">
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
                        </span>
                      )}
                      {isOwner && (
                        <span className="flex shrink-0 items-center">
                          <span className="flex flex-col items-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTagPickerPoint(point);
                            }}
                            aria-label={`Tag point ${displayNo}`}
                            className={`rounded-full p-1.5 transition-colors ${
                              tagCount > 0
                                ? "text-cyan-glow"
                                : "text-zinc-600 hover:text-zinc-400"
                            }`}
                          >
                            <TagGlyph className="h-5 w-5" />
                          </button>
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
                            aria-label={`Remove point ${displayNo}`}
                            className="rounded-full p-1.5 text-zinc-600 transition-colors hover:text-red-300"
                          >
                            <TrashIcon className="h-5 w-5" />
                          </button>
                          </span>
                        </span>
                      )}
                    </div>
                    </SwipeRemoveRow>
                    {/* game boundary from the confirmed sequence. The owner
                        can nudge it a point up/down when a rally landed in
                        the wrong game (score ran past 11). Scored types
                        only — games are a score construct. */}
                    {/* The video saw them swap ends and the score has not
                        said so. Dashed, because the solid rule above means
                        "a game ended here and the score proves it" and this
                        is a different claim — dashed is already this page's
                        vocabulary for not-yet-answered. Never both: a
                        boundary within three rallies silences this one. */}
                    {scored && !pfActive && nextGame === undefined &&
                      sideChanges.has(point.id) && (
                      <div className="mt-3 flex items-center gap-3">
                        <span className="h-px flex-1 border-t border-dashed border-edge" />
                        {isOwner ? (
                          <button
                            type="button"
                            onClick={() => setSideChangeSheet(point)}
                            className="rounded-full border border-dashed border-edge px-3 py-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:border-cyan-glow/50 hover:text-zinc-300"
                          >
                            {SIDE_CHANGE_LABEL}
                          </button>
                        ) : (
                          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                            {SIDE_CHANGE_LABEL}
                          </span>
                        )}
                        <span className="h-px flex-1 border-t border-dashed border-edge" />
                      </div>
                    )}
                    {scored && !pfActive && nextGame !== undefined && (
                      <div className="mt-3 flex items-center gap-3">
                        <span className="h-px flex-1 bg-edge" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Game {nextGame.game} ends {nextGame.you}-
                          {nextGame.them}
                          {visiblePoints[i + 1]
                            ? ` · game ${nextGame.game + 1} begins`
                            : ""}
                        </span>
                        {isOwner && (
                          <span className="flex items-center">
                            <button
                              type="button"
                              onClick={() => void moveGameBoundary(point, "up")}
                              disabled={
                                i === 0 ||
                                score.boundaryAfter.has(
                                  visiblePoints[i - 1].id
                                )
                              }
                              aria-label="Move this game boundary up a point"
                              className="rounded-full p-1 text-zinc-600 transition-colors hover:text-cyan-glow disabled:opacity-25 disabled:hover:text-zinc-600"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                className="h-4 w-4"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                aria-hidden="true"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="m6 15 6-6 6 6"
                                />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void moveGameBoundary(point, "down")
                              }
                              disabled={i >= visiblePoints.length - 1}
                              aria-label="Move this game boundary down a point"
                              className="rounded-full p-1 text-zinc-600 transition-colors hover:text-cyan-glow disabled:opacity-25 disabled:hover:text-zinc-600"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                className="h-4 w-4"
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
                            </button>
                            {/* Remove the break entirely: holds the game open
                                through this point, whether the break came
                                from the score or from a Game ended tap. The
                                point's own "Game ended" action puts one back. */}
                            <button
                              type="button"
                              onClick={() =>
                                void setGameEndOverride(point, "continue")
                              }
                              aria-label="Game didn't end here"
                              title="Game didn't end here"
                              className="rounded-full p-1 text-zinc-600 transition-colors hover:text-red-300"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                className="h-4 w-4"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                aria-hidden="true"
                              >
                                <path
                                  strokeLinecap="round"
                                  d="M6 6l12 12M18 6L6 18"
                                />
                              </svg>
                            </button>
                          </span>
                        )}
                        <span className="h-px flex-1 bg-edge" />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Open / close the timeline. Counted, so the choice is informed:
              "Show all 156" is a different decision from "Show all 12". */}
          {visiblePoints.length > POINTS_PREVIEW && (
            <button
              type="button"
              hidden={pfActive}
              onClick={togglePoints}
              aria-expanded={pointsExpanded}
              className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-edge/70 bg-surface/50 px-4 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:border-cyan-glow/40 hover:text-white"
            >
              {pointsExpanded
                ? `Show first ${POINTS_PREVIEW}`
                : `Show all ${visiblePoints.length} points`}
              {!pointsExpanded && (
                <span className="text-xs font-normal text-zinc-500">
                  ({hiddenPoints} more)
                </span>
              )}
              <svg
                viewBox="0 0 24 24"
                className={`h-4 w-4 transition-transform ${
                  pointsExpanded ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </button>
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
                  arrow keys handle prev/next). Scored types only. */}
              {scored && (
                <ScoreLine
                  score={runningScore}
                  className="text-sm font-bold tabular-nums tracking-tight"
                />
              )}
            </div>
            <PointDetail
              key={panePoint.id}
              matchId={match.id}
              // panePoint falls back to the first point when nothing is
              // selected, which is how opening a match on desktop landed
              // on a page already playing point 1 with sound. A real
              // selection autoplays as before.
              startPaused={selectedPoint === null}
              customReasons={customReasons}
              onCreateCustomReason={createCustomReason}
              ownerId={match.user_id}
              point={panePoint}
              serve={serving.get(panePoint.id)}
              notes={notes.filter((n) => n.point_id === panePoint.id)}
              authorNames={authorNames}
              userId={userId}
              userSide={userSide}
              gameIndex={gameIndexByPoint.get(panePoint.id) ?? 0}
              gameEnd={{
                endsHere: score.boundaryAfter.has(panePoint.id),
                openHere: score.openAfter.has(panePoint.id),
              }}
              onSetGameOverride={(v) => setGameEndOverride(panePoint, v)}
              onSetServer={(v) => setServerOverride(panePoint, v)}
              mapLabels={mapLabels}
              neutral={neutral}
              scored={scored}
              onSetUserSide={isOwner ? handleSetUserSide : undefined}
              strictness={strictness}
              placementNotice={
                showPointPlacementNotice &&
                !hasPlacementBounces(panePoint.placement)
                  ? placementNotice
                  : null
              }
              clipPads={match.clip_pads}
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
              points={visiblePoints}
              onModifySplit={isOwner ? modifySplitFromDetail : undefined}
              onModifyJoin={isOwner ? modifyJoinFromDetail : undefined}
              onAdjustTiming={isOwner ? adjustPointTiming : undefined}
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
              tags={tagsForPoint(panePoint.id)}
              tagVocab={sortedVocab}
              onToggleTag={(tag) => void toggleTag(panePoint.id, tag)}
              onCreateTag={(label) => void createTag(panePoint.id, label)}
              onToggleStar={
                isOwner ? () => void toggleStar(panePoint) : undefined
              }
            />
          </aside>
        )}
      </div>

      {/* Match analysis: the card deck summarises what the confirmed score
          knows (swipe on mobile, grid on desktop). Owner-only, and only on
          scored types — every card derives from confirmed winners, and a
          practice never collects any, so for it this whole section could
          only ever say "score a full game", which is an instruction to do
          the one thing practice removed. */}
      {/* A coach sees the scored half of the match the way a share link
          shows it (Adil, 2026-09-02): the result, the stats and the maps,
          in the public page's own components, so the two never drift. The
          owner keeps the interactive deck below. */}
      {!isOwner && scored && score.games.length > 0 && (
        <ShareResult
          you={mapLabels.you}
          them={mapLabels.them}
          games={score.games}
          gamesYou={score.gamesYou}
          gamesThem={score.gamesThem}
        />
      )}
      {!isOwner && scored && (
        <ShareStats
          stats={stats}
          momentum={analysis.momentum}
          you={mapLabels.you}
          them={mapLabels.them}
        />
      )}
      {!isOwner && coachPlacement && (
        <SharePlacement
          observations={coachPlacement.observations}
          mappedPoints={coachPlacement.mapped}
          totalPoints={visiblePoints.length}
          labels={mapLabels}
          servesOnly={placementServesOnly}
        />
      )}

      {isOwner && scored && (
        <div ref={matchStatsRef} className="scroll-mt-32">
          <AnalysisCards
            stats={stats}
            analysis={analysis}
            neutral={neutral}
            youLabel={mapLabels.you}
          />
        </div>
      )}

      {/* Placement maps: where the ball landed, aggregated across every
          point with a trusted bounce and normalized so you're always at the
          bottom. A SIBLING of the analysis, not a subsection of it — it
          answers a different question (the camera's evidence, not the
          scorecard's), it carries the same name as its Tools row so tapping
          that row lands on a matching heading, and nesting its card deck
          inside the analysis deck stacked two dot pagers. Owner-only; sits
          below the points so the timeline stays the page's spine.

          On practice the section appears only once it has real maps to
          show: the empty-state pitch is scored-match furniture on a page
          that shed the rest of it, but maps that exist are the camera's
          own data and stay shown whatever the type. Generation stays in
          Tools either way. */}
      {isOwner && (scored || placementMappedPoints > 0) && (
        <div id="ball-map" className="scroll-mt-32">
          {showPlacementDeepDive(
            placement.view,
            placementMappedPoints > 0,
          ) && (
            <PlacementAggregate
              points={visiblePoints}
              matchId={match.id}
              flagged={placementFlagged}
              onFlagChange={savePlacementFlagged}
              userSide={userSide}
              gameIndexByPoint={gameIndexByPoint}
              serving={serving}
              labels={mapLabels}
              ownerHandedness={ownerHandedness ?? null}
              emptyMessage={placementNotice}
              servesOnly={placementServesOnly}
            />
          )}
        </div>
      )}

      {/* match-level notes (point_id null): overall takeaways + coach review */}
      <section className="mt-10 scroll-mt-32" ref={notesRef}>
        <SectionHeading>Overall notes</SectionHeading>
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

      {/* Floating match bar: appears once the page header has scrolled
          away, and carries the three things you lose with it — the way
          out, which match you are in, and the score. It used to carry the
          score alone, which meant that below the fold the only way back
          was the bottom bar's Home (same place, but it reads as "leave
          the match", not "up one level") or the browser chrome.
          Deep in a long point list you should never have to hunt for
          either. Tapping the title returns to the top of the page. */}
      {scoreDetached && !playerOpen && (
        <div className="pointer-events-none fixed inset-x-0 top-[4.25rem] z-30 md:top-[4.75rem]">
          <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:max-w-6xl">
            <div className="lg:max-w-[340px]">
              <div
                className={`ks-fade pointer-events-auto border border-edge bg-ink/90 shadow-lg shadow-black/50 backdrop-blur-md ${
                  barScoreOpen ? "rounded-3xl" : "rounded-full"
                }`}
              >
                <div className="flex items-center gap-2 py-1.5 pl-1.5 pr-3">
                  <Link
                    href="/matches"
                    aria-label="Back to matches"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-zinc-300 transition-colors hover:text-cyan-glow"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m15 6-6 6 6 6"
                      />
                    </svg>
                  </Link>
                  <button
                    type="button"
                    onClick={() =>
                      window.scrollTo({ top: 0, behavior: "smooth" })
                    }
                    title="Back to top"
                    className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-zinc-200 transition-colors hover:text-white"
                  >
                    {titleParts.primary}
                  </button>
                  {scored && score.confirmedCount > 0 && (
                    // Games won, for the same reason as the page header:
                    // the per-game line used to live here in 45% of the
                    // bar, cut off mid-number with a hidden scrollbar as
                    // its only hint that the rest existed.
                    <GamesToggle
                      score={score}
                      open={barScoreOpen}
                      onToggle={() => setBarScoreOpen((o) => !o)}
                      className="text-base font-bold tracking-tight"
                    />
                  )}
                </div>
                {barScoreOpen && scored && score.confirmedCount > 0 && (
                  <div className="border-t border-edge/60 px-4 py-2">
                    <ScoreLine
                      wrap
                      score={score}
                      className="text-sm font-semibold tabular-nums"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* floating back-to-top: long point lists are a lot of scrolling on
          mobile. Appears on the SAME signal as the score pill (header
          scrolled away) and jumps back up to the Tools card, which lands
          just under the persistent header. Pinned bottom-LEFT so it never
          collides with the notes composer's right-aligned mic + submit
          controls; sits clear of the bottom nav (safe-area aware) and the
          top-anchored score pill. */}
      {/* Only worth its space while the timeline is open — that is the only
          thing on this page long enough to need a shortcut back. */}
      {scoreDetached && !playerOpen && pointsExpanded && (
        <button
          type="button"
          onClick={() => scrollToSection(toolsRef)}
          aria-label="Back to top"
          className="fixed left-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex h-11 w-11 items-center justify-center rounded-full border border-edge bg-ink/70 text-zinc-200 shadow-lg shadow-black/40 backdrop-blur-md transition-colors hover:text-white md:bottom-6"
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
          customReasons={customReasons}
          onCreateCustomReason={createCustomReason}
          point={selectedPoint}
          serve={serving.get(selectedPoint.id)}
          notes={notes.filter((n) => n.point_id === selectedPoint.id)}
          authorNames={authorNames}
          userId={userId}
          userSide={userSide}
          gameIndex={gameIndexByPoint.get(selectedPoint.id) ?? 0}
          gameEnd={{
            endsHere: score.boundaryAfter.has(selectedPoint.id),
            openHere: score.openAfter.has(selectedPoint.id),
          }}
          onSetGameOverride={(v) => setGameEndOverride(selectedPoint, v)}
          onSetServer={(v) => setServerOverride(selectedPoint, v)}
          mapLabels={mapLabels}
          neutral={neutral}
          scored={scored}
          onSetUserSide={isOwner ? handleSetUserSide : undefined}
          strictness={strictness}
          placementNotice={
            showPointPlacementNotice &&
            !hasPlacementBounces(selectedPoint.placement)
              ? placementNotice
              : null
          }
          index={visiblePoints.findIndex((p) => p.id === selectedPoint.id)}
          total={visiblePoints.length}
          score={runningScore}
          onClose={() => {
            // Continuity: if this point was opened FROM the pad, closing it
            // goes back to the pad, on the point you were looking at — not
            // to the match page, from which reaching that rally again is
            // Keep score, wait for the resume, then hunt for it.
            //
            // Prev/next inside the sheet keep the promise: you come back to
            // wherever you navigated to, which is the point on screen.
            const back = cameFromScore.current ? selectedPoint.id : null;
            cameFromScore.current = false;
            setActivePointId(null);
            if (back) playerRef.current?.openScore(back);
          }}
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
          points={visiblePoints}
          onModifySplit={isOwner ? modifySplitFromDetail : undefined}
          onModifyJoin={isOwner ? modifyJoinFromDetail : undefined}
          onAdjustTiming={isOwner ? adjustPointTiming : undefined}
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
          tags={tagsForPoint(selectedPoint.id)}
          tagVocab={sortedVocab}
          onToggleTag={(tag) => void toggleTag(selectedPoint.id, tag)}
          onCreateTag={(label) => void createTag(selectedPoint.id, label)}
          onToggleStar={
            isOwner ? () => void toggleStar(selectedPoint) : undefined
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
          tagOptions={tagShareOptions}
          pointNumber={
            shareTarget?.pointId
              ? visiblePoints.findIndex((p) => p.id === shareTarget.pointId) +
                1
              : undefined
          }
          starredCount={visiblePoints.filter((p) => p.starred).length}
          userId={userId}
          names={shareNames}
          scored={score.confirmedCount > 0}
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

      {/* undo snackbar for structural edits (deletes, timing, splits) */}
      {snackbar && (
        <div className="fixed inset-x-0 bottom-24 z-[70] flex justify-center px-4 md:bottom-6">
          <div className="flex items-center gap-4 rounded-full border border-edge bg-surface px-5 py-3 shadow-2xl">
            <span className="text-sm text-zinc-200">{snackbar.text}</span>
            <button
              type="button"
              onClick={snackbar.undo}
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

      {/* Timeline tag picker — the star's sibling on the point rows */}
      {tagPickerPoint && (
        <TagPicker
          pointLabel={`Point ${
            visiblePoints.findIndex((p) => p.id === tagPickerPoint.id) + 1
          }`}
          vocab={sortedVocab}
          appliedIds={
            new Set(tagsForPoint(tagPickerPoint.id).map((t) => t.id))
          }
          onToggle={(tag) => void toggleTag(tagPickerPoint.id, tag)}
          onCreate={(label) => void createTag(tagPickerPoint.id, label)}
          onClose={() => setTagPickerPoint(null)}
        />
      )}

      {/* The detected side change, tapped in the point list. Two answers
          and a way out. "Game ended here" writes the SAME override the
          owner could pin by hand, so a game ended from a marker is
          indistinguishable afterwards from one ended any other way — the
          detector never gets its own private path into the score. */}
      {sideChangeSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-6">
            <h3 className="text-lg font-semibold text-zinc-100">
              The players changed ends here
            </h3>
            <p className="mt-1 text-sm text-zinc-400">
              This usually means the game ended.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  const point = sideChangeSheet;
                  setSideChangeSheet(null);
                  void setGameEndOverride(point, "end");
                }}
                className="rounded-full border border-cyan-glow/40 bg-cyan-glow/10 px-4 py-2.5 text-sm font-semibold text-cyan-glow transition-colors hover:bg-cyan-glow/20"
              >
                Game ended here
              </button>
              <button
                type="button"
                onClick={() => {
                  const point = sideChangeSheet;
                  setSideChangeSheet(null);
                  void dismissSideChange(point);
                }}
                className="rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:text-white"
              >
                They just changed ends
              </button>
              <button
                type="button"
                onClick={() => setSideChangeSheet(null)}
                className="rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unscore confirmation. Spells out both sides of the line, because
          "start from scratch" is the kind of phrase people read as safer
          than it is. */}
      {confirmUnscore && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-6">
            <h3 className="text-lg font-semibold text-zinc-100">
              What should we unscore?
            </h3>

            {/* Rows, not chips: a whole row is an easy thumb target, and
                the game's score reads better beside its number than under
                it. Scrolls past a handful of games so the buttons below
                stay reachable on a short phone. */}
            <div className="mt-4 max-h-56 space-y-1 overflow-y-auto">
              <button
                type="button"
                onClick={() => {
                  setUnscoreWhole(true);
                  setUnscoreGames(new Set());
                }}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  unscoreWhole
                    ? "border-cyan-glow/60 bg-cyan-glow/10"
                    : "border-edge hover:border-zinc-600"
                }`}
              >
                <Tick on={unscoreWhole} />
                <span className="flex-1 text-sm font-semibold text-zinc-100">
                  Whole match
                </span>
                <span className="text-xs text-zinc-500">
                  {gameSegments.length} game
                  {gameSegments.length === 1 ? "" : "s"}
                </span>
              </button>

              {gameSegments.length > 1 &&
                gameSegments.map((s) => {
                  const on = unscoreWhole || unscoreGames.has(s.game);
                  return (
                    <button
                      key={s.game}
                      type="button"
                      onClick={() => {
                        // Both setters at the top level: a setState called
                        // from inside another's updater is dropped, which
                        // left every row stuck on "whole match".
                        const wasWhole = unscoreWhole;
                        setUnscoreWhole(false);
                        setUnscoreGames((prev) => {
                          // Picking a game means it's no longer "the whole
                          // match" — start from just this one.
                          const next = wasWhole
                            ? new Set<number>()
                            : new Set(prev);
                          if (next.has(s.game)) next.delete(s.game);
                          else next.add(s.game);
                          return next;
                        });
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        on
                          ? "border-cyan-glow/60 bg-cyan-glow/10"
                          : "border-edge hover:border-zinc-600"
                      }`}
                    >
                      <Tick on={on} />
                      <span className="flex-1 text-sm font-medium text-zinc-200">
                        Game {s.game}
                        {!s.complete && (
                          <span className="ml-1.5 text-xs font-normal text-zinc-500">
                            in progress
                          </span>
                        )}
                      </span>
                      <span className="text-xs font-semibold tabular-nums">
                        <span className="text-cyan-glow">{s.you}</span>
                        <span className="text-zinc-600">-</span>
                        <span className="text-magenta-soft">{s.them}</span>
                      </span>
                    </button>
                  );
                })}
            </div>

            {unscoreError && (
              <p className="mt-3 text-sm text-red-400">{unscoreError}</p>
            )}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmUnscore(false)}
                disabled={unscoring}
                className="flex-1 rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void unscoreMatch()}
                disabled={unscoring || (!unscoreWhole && unscoreGames.size === 0)}
                className="flex-1 rounded-full bg-cyan-glow px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-cyan-300 disabled:opacity-50"
              >
                {unscoring
                  ? "Unscoring…"
                  : unscoreWhole
                    ? "Unscore match"
                    : `Unscore ${unscoreGames.size} game${
                        unscoreGames.size === 1 ? "" : "s"
                      }`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation — same copy and flow as the library's card
          menu, so deleting reads identically wherever you start it. */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-6">
            <h3 className="text-lg font-semibold text-zinc-100">
              Delete this match?
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              {deleteBytes === null
                ? "Checking how much space this frees…"
                : `This frees ${formatBytes(deleteBytes)}. `}
              {deleteBytes !== null &&
                "Clips, video, notes, and the scorecard are deleted. This cannot be undone."}
            </p>
            {deleteError && (
              <p className="mt-3 text-sm text-red-400">{deleteError}</p>
            )}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  setDeleteError(null);
                }}
                disabled={deleting}
                className="flex-1 rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteMatch()}
                disabled={deleting || deleteBytes === null}
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
