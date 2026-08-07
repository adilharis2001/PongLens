"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Annotator } from "@/app/match/[id]/Annotator";
import { ClipPlayer } from "@/app/match/[id]/ClipPlayer";
import {
  createBoundaryWalk,
  gameWinner,
  stepBoundaryWalk,
} from "@/app/match/[id]/gameScore";
import { AutoTextarea } from "@/components/AutoTextarea";
import type { ReviewFindingRow } from "@/lib/reviews/types";
import { createClient } from "@/lib/supabase/client";
import type { WorkspacePoint } from "./CoachOrder";

/**
 * The points half of the coach workspace, built the way the match page
 * watches: ONE video — the full cut — and every point jump is a seek,
 * never another file. The coach watches, taps "Tag this point", and picks
 * the pattern it shows (or names a new one). Findings hold no videos;
 * their point chips seek the player at the top. Voice dictates through
 * /api/transcribe (tier=review) and drawings capture the player's
 * on-screen frame.
 */

// ---------------------------------------------------------------------------
// The cut player
// ---------------------------------------------------------------------------

function chipClass(p: WorkspacePoint, current: boolean, tagged: boolean) {
  const base =
    "h-9 min-w-9 shrink-0 rounded-full border px-2 text-xs font-medium tabular-nums transition-colors ";
  if (current) return base + "border-cyan-glow bg-cyan-glow/20 text-cyan-glow";
  if (tagged) return base + "border-cyan-glow/50 text-cyan-glow";
  if (p.is_let) return base + "border-amber-400/40 text-amber-400/80";
  if (p.confirmed_winner === "user")
    return base + "border-cyan-glow/30 text-zinc-300";
  if (p.confirmed_winner === "opponent")
    return base + "border-magenta-glow/40 text-zinc-300";
  return base + "border-dashed border-edge text-zinc-400";
}

function outcomeLabel(p: WorkspacePoint): string {
  if (p.is_let) return "let";
  if (p.confirmed_winner === "user") return "they won";
  if (p.confirmed_winner === "opponent") return "they lost";
  return "unscored";
}

function CutPlayer({
  matchId,
  points,
  currentIdx,
  onCurrentIdx,
  taggedIds,
  videoElRef,
  seekRef,
  onTag,
}: {
  matchId: string;
  points: WorkspacePoint[];
  currentIdx: number;
  onCurrentIdx: (i: number) => void;
  taggedIds: Set<string>;
  videoElRef: React.MutableRefObject<HTMLVideoElement | null>;
  seekRef: React.MutableRefObject<((idx: number) => void) | null>;
  onTag: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  // Seekable points in cut order. cut_t0 is the PADDED clip start (the
  // same anchor the match page's chips seek to).
  const seekable = useMemo(
    () =>
      points
        .filter((p) => p.cut_t0 !== null)
        .sort((a, b) => (a.cut_t0 ?? 0) - (b.cut_t0 ?? 0)),
    [points],
  );

  // Running score after each point, from the same walk the match page
  // scores with. Empty when the student never scored the match — no
  // point parading 0-0. Rendered as the burn-in chip on the video,
  // bottom-left, the way the rendered reels carry it. The same walk
  // marks where games end, so the chip strip can draw its separators.
  const { scoreAfter, gameEndAfter } = useMemo(() => {
    const scoreAfter = new Map<
      string,
      { you: number; them: number; gamesYou: number; gamesThem: number }
    >();
    const gameEndAfter = new Map<string, { you: number; them: number }>();
    if (!points.some((p) => !p.is_let && p.confirmed_winner !== null)) {
      return { scoreAfter, gameEndAfter };
    }
    const walk = createBoundaryWalk();
    let gamesYou = 0;
    let gamesThem = 0;
    for (const p of points) {
      const winner = !p.is_let ? p.confirmed_winner : null;
      const ended = stepBoundaryWalk(walk, winner, p.game_end_override);
      if (ended) {
        if (gameWinner(ended) === "user") gamesYou += 1;
        else if (gameWinner(ended) === "opponent") gamesThem += 1;
        scoreAfter.set(p.id, {
          you: ended.you,
          them: ended.them,
          gamesYou,
          gamesThem,
        });
        gameEndAfter.set(p.id, { you: ended.you, them: ended.them });
      } else {
        scoreAfter.set(p.id, {
          you: walk.you,
          them: walk.them,
          gamesYou,
          gamesThem,
        });
      }
    }
    return { scoreAfter, gameEndAfter };
  }, [points]);

  const fetchUrl = useCallback(async () => {
    try {
      const res = await fetch("/api/media-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchId, preview: true }),
      });
      const data = (await res.json()) as { url?: string };
      if (res.ok && data.url) {
        setUrl(data.url);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    }
  }, [matchId]);

  useEffect(() => {
    void fetchUrl();
  }, [fetchUrl]);

  const seekToIdx = useCallback(
    (idx: number) => {
      const p = points[idx];
      const v = videoElRef.current;
      if (!p || p.cut_t0 === null || !v) return;
      v.currentTime = p.cut_t0;
      onCurrentIdx(idx);
      if (v.paused) void v.play().catch(() => {});
    },
    [points, onCurrentIdx, videoElRef],
  );
  seekRef.current = seekToIdx;

  const step = useCallback(
    (dir: 1 | -1) => {
      const pos = seekable.findIndex((p) => p.idx === currentIdx);
      const next =
        pos === -1
          ? seekable[0]
          : seekable[Math.min(seekable.length - 1, Math.max(0, pos + dir))];
      if (next) seekToIdx(next.idx);
    },
    [seekable, currentIdx, seekToIdx],
  );

  // Which point the playhead is inside: the last seekable point whose
  // cut_t0 is behind the clock. Cheap linear scan; a match has ~100.
  function onTime(v: HTMLVideoElement) {
    let cur: WorkspacePoint | null = null;
    for (const p of seekable) {
      if ((p.cut_t0 ?? 0) <= v.currentTime + 0.05) cur = p;
      else break;
    }
    if (cur && cur.idx !== currentIdx) onCurrentIdx(cur.idx);
  }

  // Keep the current chip in sight while playback walks the match.
  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>(
      `[data-idx="${currentIdx}"]`,
    );
    chip?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [currentIdx]);

  const current = points[currentIdx] ?? null;

  if (failed) {
    return (
      <div className="rounded-2xl border border-edge bg-surface p-5 text-sm text-zinc-500">
        The match video is not ready yet.
      </div>
    );
  }
  if (!url) {
    return (
      <div className="aspect-video w-full animate-pulse rounded-2xl border border-edge bg-surface-2" />
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-edge bg-surface">
      {/* The same player the match page's point view uses — zoom, pan,
          speed menu and press-and-hold rates come from the shared code,
          not an imitation. Cut mode: starts paused, plays straight
          through. */}
      <div className="relative">
        <ClipPlayer
          mode="cut"
          src={url}
          videoElRef={videoElRef}
          onTime={onTime}
          onMediaError={() => {
            // Long sessions outlive the presigned URL: mint a fresh one.
            if (!retried.current) {
              retried.current = true;
              setUrl(null);
              void fetchUrl();
            } else {
              setFailed(true);
            }
          }}
        />
        {/* Burn-in score, bottom-left over the picture like the rendered
            reels. The score AS OF the point on screen. */}
        {current && scoreAfter.has(current.id) && (
          <div className="pointer-events-none absolute bottom-4 left-2 flex items-center gap-1.5 rounded-full bg-ink/60 px-2.5 py-1 backdrop-blur-sm">
            <span className="text-sm font-semibold tabular-nums leading-none">
              <span className="text-cyan-glow">
                {scoreAfter.get(current.id)!.you}
              </span>
              <span className="mx-0.5 text-zinc-500">-</span>
              <span className="text-magenta-soft">
                {scoreAfter.get(current.id)!.them}
              </span>
            </span>
            {scoreAfter.get(current.id)!.gamesYou +
              scoreAfter.get(current.id)!.gamesThem >
              0 && (
              <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none text-zinc-300">
                {scoreAfter.get(current.id)!.gamesYou}-
                {scoreAfter.get(current.id)!.gamesThem}
              </span>
            )}
          </div>
        )}
      </div>

      {/* The point bar: swipe left/right or use the arrows to move between
          points — the shuffle from the match page's point view. */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-2.5"
        onTouchStart={(e) => {
          swipe.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
          };
        }}
        onTouchEnd={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s) return;
          const dx = e.changedTouches[0].clientX - s.x;
          const dy = e.changedTouches[0].clientY - s.y;
          if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            step(dx < 0 ? 1 : -1);
          }
        }}
      >
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="Previous point"
          className="rounded-full border border-edge p-2 text-zinc-400 transition-colors hover:border-cyan-glow/40 hover:text-zinc-200"
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
        </button>
        <p className="min-w-0 truncate text-sm text-zinc-300">
          {current ? (
            <>
              <span className="font-semibold text-zinc-100">
                Point {current.idx + 1}
              </span>
              {current.starred && <span className="text-cyan-glow"> ★</span>}
              <span className="text-zinc-500"> · {outcomeLabel(current)}</span>
            </>
          ) : (
            "Pick a point"
          )}
        </p>
        <button
          type="button"
          onClick={() => step(1)}
          aria-label="Next point"
          className="rounded-full border border-edge p-2 text-zinc-400 transition-colors hover:border-cyan-glow/40 hover:text-zinc-200"
        >
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
        </button>
      </div>

      <div
        ref={stripRef}
        className="flex gap-1.5 overflow-x-auto px-3 pb-3 pt-0.5"
      >
        {points.map((p) => (
          <Fragment key={p.id}>
            <button
              type="button"
              data-idx={p.idx}
              onClick={() => seekToIdx(p.idx)}
              disabled={p.cut_t0 === null}
              className={chipClass(p, p.idx === currentIdx, taggedIds.has(p.id))}
            >
              {p.starred ? "★" : ""}
              {p.idx + 1}
            </button>
            {/* Game separator where the scored sequence says a game ended —
                the strip's version of Keep score's divider rows. */}
            {gameEndAfter.has(p.id) && (
              <div
                aria-hidden
                className="flex h-9 shrink-0 flex-col items-center px-1"
              >
                <span className="w-px flex-1 bg-edge" />
                <span className="py-0.5 text-[9px] font-semibold leading-none tabular-nums text-zinc-500">
                  {gameEndAfter.get(p.id)!.you}-{gameEndAfter.get(p.id)!.them}
                </span>
                <span className="w-px flex-1 bg-edge" />
              </div>
            )}
          </Fragment>
        ))}
      </div>

      <div className="border-t border-edge/60 p-3">
        <button
          type="button"
          onClick={onTag}
          disabled={!current}
          className="glow-cta w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
        >
          Add to a pattern
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The tag sheet: which pattern does the current point show?
// ---------------------------------------------------------------------------

function TagSheet({
  point,
  findings,
  findingPoints,
  busy,
  onToggle,
  onNew,
  onClose,
}: {
  point: WorkspacePoint;
  findings: ReviewFindingRow[];
  findingPoints: Record<string, { point_id: string; idx: number }[]>;
  busy: boolean;
  onToggle: (finding: ReviewFindingRow, has: boolean) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl border border-edge bg-surface p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-zinc-100">
          Point {point.idx + 1} shows
        </p>
        <div className="mt-3 space-y-1">
          {findings.map((f) => {
            const has = (findingPoints[f.id] ?? []).some(
              (l) => l.point_id === point.id,
            );
            return (
              <button
                key={f.id}
                type="button"
                disabled={busy}
                onClick={() => onToggle(f, has)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-2 disabled:opacity-60"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    has
                      ? "bg-cyan-glow/15 text-cyan-glow"
                      : "border border-edge"
                  }`}
                >
                  {has && (
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m5 13 4 4 10-10"
                      />
                    </svg>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                  {f.title || f.body.split("\n")[0] || "Unnamed pattern"}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                  {(findingPoints[f.id] ?? []).length}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onNew}
          className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-cyan-glow transition-colors hover:bg-surface-2 disabled:opacity-60"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
            +
          </span>
          New pattern with this point
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-full border border-edge px-5 py-2.5 text-sm font-medium text-zinc-400"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

export function FindingEditor({
  orderId,
  matchId,
  points,
  findings,
  findingPoints,
  onChanged,
}: {
  orderId: string;
  matchId: string | null;
  points: WorkspacePoint[];
  findings: ReviewFindingRow[];
  findingPoints: Record<string, { point_id: string; idx: number }[]>;
  onChanged: () => void;
}) {
  const firstSeekable = points.findIndex((p) => p.cut_t0 !== null);
  const [currentIdx, setCurrentIdx] = useState(Math.max(0, firstSeekable));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ pointIds: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const seekRef = useRef<((idx: number) => void) | null>(null);

  const taggedIds = useMemo(
    () =>
      new Set(
        Object.values(findingPoints).flatMap((l) => l.map((x) => x.point_id)),
      ),
    [findingPoints],
  );
  const current = points[currentIdx] ?? null;

  async function toggleTag(finding: ReviewFindingRow, has: boolean) {
    if (!current) return;
    setBusy(true);
    const supabase = createClient();
    if (has) {
      await supabase
        .from("review_finding_points")
        .delete()
        .eq("finding_id", finding.id)
        .eq("point_id", current.id);
    } else {
      await supabase
        .from("review_finding_points")
        .insert({ finding_id: finding.id, point_id: current.id });
    }
    setBusy(false);
    setSheetOpen(false);
    onChanged();
  }

  // A new finding starts as a DRAFT — no row until it is saved, the same
  // rule the offerings builder follows. Starting one while a draft is
  // already open never discards typed words: the point joins the open
  // draft instead.
  function startDraft(withPoint: boolean) {
    setSheetOpen(false);
    setOpenId(null);
    setDraft((d) => {
      const pointIds = d ? [...d.pointIds] : [];
      if (withPoint && current && !pointIds.includes(current.id)) {
        pointIds.push(current.id);
      }
      return { pointIds };
    });
  }

  return (
    <div className="mt-3">
      {matchId && points.length > 0 ? (
        <CutPlayer
          matchId={matchId}
          points={points}
          currentIdx={currentIdx}
          onCurrentIdx={setCurrentIdx}
          taggedIds={taggedIds}
          videoElRef={videoElRef}
          seekRef={seekRef}
          onTag={() => {
            // They're tagging the moment on screen — hold it there. A
            // paused frame is also what Draw needs.
            videoElRef.current?.pause();
            setSheetOpen(true);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => startDraft(false)}
          disabled={busy}
          className="rounded-full border border-edge bg-surface px-4 py-2 text-xs font-medium text-zinc-300 hover:border-cyan-glow/40"
        >
          Add a pattern
        </button>
      )}

      <div className="mt-4 space-y-3">
        {draft && (
          <FindingCard
            finding={null}
            orderId={orderId}
            sortHint={findings.length}
            linked={draft.pointIds.map((id) => ({
              point_id: id,
              idx: points.find((p) => p.id === id)?.idx ?? 0,
            }))}
            open
            onOpen={() => {}}
            onClose={() => setDraft(null)}
            onSeek={(pointId) => {
              const idx = points.find((p) => p.id === pointId)?.idx;
              if (idx !== undefined) seekRef.current?.(idx);
            }}
            onDraftRemovePoint={(pointId) =>
              setDraft((d) =>
                d
                  ? { pointIds: d.pointIds.filter((x) => x !== pointId) }
                  : d,
              )
            }
            getVideoEl={() => videoElRef.current}
            getCurrentPointId={() => current?.id ?? null}
            idxForPoint={(id) =>
              points.find((p) => p.id === id)?.idx ?? null
            }
            onChanged={onChanged}
          />
        )}
        {findings.map((f) => (
          <FindingCard
            key={f.id}
            finding={f}
            orderId={orderId}
            sortHint={findings.length}
            linked={findingPoints[f.id] ?? []}
            open={openId === f.id}
            onOpen={() => setOpenId(openId === f.id ? null : f.id)}
            onClose={() => setOpenId(null)}
            onSeek={(pointId) => {
              const idx = points.find((p) => p.id === pointId)?.idx;
              if (idx !== undefined) seekRef.current?.(idx);
            }}
            getVideoEl={() => videoElRef.current}
            getCurrentPointId={() => current?.id ?? null}
            idxForPoint={(id) =>
              points.find((p) => p.id === id)?.idx ?? null
            }
            onChanged={onChanged}
          />
        ))}
      </div>

      {matchId && points.length > 0 && !draft && (
        <button
          type="button"
          onClick={() => startDraft(false)}
          disabled={busy}
          className="mt-3 rounded-full border border-edge bg-surface px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40"
        >
          Add a note without a point
        </button>
      )}

      {sheetOpen && current && (
        <TagSheet
          point={current}
          findings={findings}
          findingPoints={findingPoints}
          busy={busy}
          onToggle={(f, has) => void toggleTag(f, has)}
          onNew={() => startDraft(true)}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One finding: compact row, expands to edit. No videos in here — point
// chips seek the player at the top of the section. With finding=null the
// card is a DRAFT: nothing exists in the database until Save, and
// Discard leaves nothing behind (the offerings-builder rule).
// ---------------------------------------------------------------------------

function FindingCard({
  finding,
  orderId,
  sortHint,
  linked,
  open,
  onOpen,
  onClose,
  onSeek,
  onDraftRemovePoint,
  getVideoEl,
  getCurrentPointId,
  idxForPoint,
  onChanged,
}: {
  finding: ReviewFindingRow | null;
  orderId: string;
  sortHint: number;
  linked: { point_id: string; idx: number }[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSeek: (pointId: string) => void;
  onDraftRemovePoint?: (pointId: string) => void;
  getVideoEl: () => HTMLVideoElement | null;
  getCurrentPointId: () => string | null;
  idxForPoint: (pointId: string) => number | null;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(finding?.title ?? "");
  const [body, setBody] = useState(finding?.body ?? "");
  const [audioPath, setAudioPath] = useState(finding?.audio_path ?? null);
  const [imagePath, setImagePath] = useState(finding?.image_path ?? null);
  const [imagePointId, setImagePointId] = useState(
    finding?.image_point_id ?? null,
  );
  // Signed preview links, so the card shows EXACTLY what the student
  // will get. Fresh recordings/drawings carry one back from their API;
  // media already on the row is fetched when the card opens.
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [frame, setFrame] = useState<HTMLCanvasElement | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    if (!recording) return;
    setRecSeconds(0);
    const t = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  useEffect(() => {
    if (!open || !finding) return;
    const load = async (kind: "audio" | "image") => {
      try {
        const res = await fetch("/api/review-media", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ findingId: finding.id, kind }),
        });
        const data = (await res.json()) as { url?: string };
        if (res.ok && data.url) {
          if (kind === "audio") setAudioUrl(data.url);
          else setImageUrl(data.url);
        }
      } catch {
        // The preview is a nicety; editing works without it.
      }
    };
    if (audioPath && !audioUrl) void load("audio");
    if (imagePath && !imageUrl) void load("image");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save(extra?: Partial<ReviewFindingRow>) {
    setBusy(true);
    const supabase = createClient();
    const values = {
      title: title.trim().slice(0, 120),
      body: body.slice(0, 4000),
      audio_path: audioPath,
      image_path: imagePath,
      image_point_id: imagePath ? imagePointId : null,
      ...extra,
    };
    if (finding) {
      const { error } = await supabase
        .from("review_findings")
        .update(values)
        .eq("id", finding.id);
      setBusy(false);
      if (error) {
        setNote("Could not save. Try again.");
        return false;
      }
    } else {
      // Draft: the finding and its point links land together, or not
      // at all.
      const { data: created, error } = await supabase
        .from("review_findings")
        .insert({ order_id: orderId, sort: sortHint, ...values })
        .select()
        .single();
      if (!error && created && linked.length > 0) {
        await supabase.from("review_finding_points").insert(
          linked.map((l) => ({
            finding_id: created.id,
            point_id: l.point_id,
          })),
        );
      }
      setBusy(false);
      if (error) {
        setNote("Could not save. Try again.");
        return false;
      }
    }
    onChanged();
    return true;
  }

  async function remove() {
    if (!finding) {
      onClose();
      return;
    }
    setBusy(true);
    await createClient()
      .from("review_findings")
      .delete()
      .eq("id", finding.id);
    setBusy(false);
    onChanged();
  }

  async function unlink(pointId: string) {
    if (!finding) {
      onDraftRemovePoint?.(pointId);
      return;
    }
    await createClient()
      .from("review_finding_points")
      .delete()
      .eq("finding_id", finding.id)
      .eq("point_id", pointId);
    onChanged();
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setTranscribing(true);
        try {
          const blob = new Blob(chunks.current, { type: mime });
          const form = new FormData();
          form.append(
            "audio",
            blob,
            `finding${mime === "audio/webm" ? ".webm" : ".mp4"}`,
          );
          form.append("tier", "review");
          const res = await fetch("/api/transcribe", {
            method: "POST",
            body: form,
          });
          const data = (await res.json()) as {
            audio_path?: string;
            transcript?: string;
            url?: string;
          };
          if (res.ok && data.audio_path) {
            setAudioPath(data.audio_path);
            setAudioUrl(data.url ?? null);
            if (data.transcript) {
              setBody((prev) =>
                prev ? `${prev}\n${data.transcript}` : (data.transcript ?? ""),
              );
            }
          } else {
            setNote("Could not process the recording.");
          }
        } catch {
          setNote("Could not process the recording.");
        }
        setTranscribing(false);
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
    } catch {
      setNote("Microphone unavailable.");
    }
  }

  function stopRecording() {
    recorder.current?.stop();
  }

  function openDraw() {
    const el = getVideoEl();
    if (!el || el.videoWidth === 0) {
      setNote("Let the video load first.");
      return;
    }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = el.videoWidth;
      canvas.height = el.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(el, 0, 0);
      setFrame(canvas);
      setDrawing(true);
    } catch {
      setNote("Could not capture the frame. Play the clip once, then retry.");
    }
  }

  async function saveDrawing(blob: Blob) {
    setDrawing(false);
    setFrame(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("image", blob, "sketch.png");
      form.append("tier", "review");
      const res = await fetch("/api/note-image", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as { image_path?: string; url?: string };
      if (res.ok && data.image_path) {
        setImagePath(data.image_path);
        setImageUrl(data.url ?? null);
        // The frame came from whatever point was on the player — stamp
        // it so both sides can caption the drawing.
        setImagePointId(getCurrentPointId());
      } else {
        setNote("Could not save the drawing.");
      }
    } catch {
      setNote("Could not save the drawing.");
    }
    setBusy(false);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-edge bg-surface">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <p className="min-w-0 truncate text-sm font-medium text-zinc-200">
          {title || body.split("\n")[0] || "New pattern"}
        </p>
        <span className="shrink-0 text-xs tabular-nums text-zinc-500">
          {linked.map((l) => l.idx + 1).join(", ") || "no points"}
        </span>
      </button>

      {open && (
        <div className="border-t border-edge/60 px-5 pb-5 pt-4">
          {linked.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {linked.map((l) => (
                <span
                  key={l.point_id}
                  className="inline-flex items-center overflow-hidden rounded-full border border-cyan-glow/40 text-xs tabular-nums text-cyan-glow"
                >
                  <button
                    type="button"
                    onClick={() => onSeek(l.point_id)}
                    title="Watch this point"
                    className="py-1 pl-2.5 pr-1.5 hover:bg-cyan-glow/10"
                  >
                    {l.idx + 1}
                  </button>
                  <button
                    type="button"
                    onClick={() => void unlink(l.point_id)}
                    aria-label={`Remove point ${l.idx + 1}`}
                    className="py-1 pl-0.5 pr-2 text-zinc-500 hover:text-amber-400"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-zinc-600">
            Tap a number to watch it, × to remove it. Add more from the
            player above.
          </p>

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Name the pattern"
            className="mt-4 w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm font-medium text-zinc-100 outline-none focus:border-cyan-glow/50"
          />
          <AutoTextarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="What you see and what to change"
            className="mt-2 w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm leading-relaxed text-zinc-100 outline-none focus:border-cyan-glow/50"
          />

          {/* The attachments render here the way the student will see
              them — hearing and seeing what ships beats guessing. */}
          {audioPath && !recording && (
            <div className="mt-3 flex items-center gap-2">
              {audioUrl ? (
                <audio controls src={audioUrl} className="h-10 min-w-0 flex-1" />
              ) : (
                <p className="flex-1 text-xs text-zinc-500">
                  Voice note attached.
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  setAudioPath(null);
                  setAudioUrl(null);
                }}
                className="shrink-0 text-sm text-zinc-400 hover:text-amber-400"
              >
                Remove
              </button>
            </div>
          )}
          {imagePath && (
            <div className="mt-3">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt="Your drawing"
                  className="w-full rounded-xl border border-edge"
                />
              ) : (
                <p className="text-xs text-zinc-500">Drawing attached.</p>
              )}
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-xs text-zinc-500">
                  {imagePointId !== null &&
                  idxForPoint(imagePointId) !== null
                    ? `From point ${(idxForPoint(imagePointId) ?? 0) + 1}`
                    : ""}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setImagePath(null);
                    setImageUrl(null);
                    setImagePointId(null);
                  }}
                  className="text-sm text-zinc-400 hover:text-amber-400"
                >
                  Remove
                </button>
              </div>
            </div>
          )}

          {/* The app's one dictate idiom (Notes composer): a round mic
              button, a red recording bar with the clock, a transcribing
              bar. Not a labeled pill of its own invention. */}
          {recording ? (
            <div className="mt-3 flex h-11 items-center gap-3 rounded-full border border-edge bg-ink/60 px-4">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
              <span className="text-sm tabular-nums text-red-300">
                {Math.floor(recSeconds / 60)}:
                {String(recSeconds % 60).padStart(2, "0")}
              </span>
              <span className="flex-1 truncate text-xs text-zinc-500">
                Recording…
              </span>
              <button
                type="button"
                onClick={stopRecording}
                aria-label="Stop recording"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <rect x="7" y="7" width="10" height="10" rx="1.5" />
                </svg>
              </button>
            </div>
          ) : transcribing ? (
            <div className="mt-3 flex h-11 items-center gap-3 rounded-full border border-edge bg-ink/60 px-4">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-glow" />
              <span className="text-sm text-zinc-400">Transcribing…</span>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void startRecording()}
                aria-label={
                  audioPath ? "Re-record the voice note" : "Record a voice note"
                }
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-edge bg-ink/40 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path strokeLinecap="round" d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              </button>
              <button
                type="button"
                onClick={openDraw}
                className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 hover:border-cyan-glow/40"
              >
                {imagePath ? "Redraw" : "Draw on the frame"}
              </button>
            </div>
          )}

          {note && <p className="mt-3 text-xs text-amber-400">{note}</p>}

          <div className="mt-5 flex items-center justify-between">
            {!finding ? (
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:border-amber-400/40 hover:text-amber-400"
              >
                Discard
              </button>
            ) : confirmDelete ? (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="rounded-full border border-amber-400/50 px-4 py-2 text-sm font-medium text-amber-400 hover:bg-amber-400/10"
              >
                Really delete?
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:border-amber-400/40 hover:text-amber-400"
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                if (await save()) onClose();
              }}
              disabled={busy}
              className="glow-cta rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
            >
              {busy ? "Saving" : "Save"}
            </button>
          </div>
        </div>
      )}

      {drawing && frame && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4">
          <div className="w-full max-w-2xl">
            <Annotator
              frame={frame}
              onCancel={() => {
                setDrawing(false);
                setFrame(null);
              }}
              onSave={saveDrawing}
            />
          </div>
        </div>
      )}
    </div>
  );
}
