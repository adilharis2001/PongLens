"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CustomReasonLabels } from "@/app/match/[id]/scorecard";
import { clipUrlFor } from "./clipUrls";
import { StarredPlayer } from "./StarredPlayer";
import {
  DIRECTION_LABEL,
  durationLabel,
  groupStarred,
  outcomeLabel,
  outcomeOf,
  rallySeconds,
  reasonLabel,
  summaryLine,
  type Outcome,
  type StarredPointRow,
} from "./starred";

/**
 * Every starred point the owner has, grouped by match, newest match
 * first. The rows arrive from starred_points() (134) already numbered and
 * already ordered, so this file only draws them.
 *
 * Tapping a tile does not open that point on its own — it starts the
 * whole set playing from there. A grid you have to open and close one
 * rally at a time is a file browser; a grid that becomes a reel is a
 * highlights tape, and the tape is the reason to keep stars in one place.
 */

/** Tint per outcome. The same cyan/magenta the score has everywhere else. */
const WASH: Record<Outcome, string> = {
  won: "from-cyan-glow/15 via-cyan-glow/5",
  lost: "from-magenta-glow/15 via-magenta-glow/5",
  skipped: "from-amber-300/15 via-amber-300/5",
  unscored: "from-zinc-400/10 via-zinc-400/5",
};

const OUTCOME_TEXT: Record<Outcome, string> = {
  won: "text-cyan-glow",
  lost: "text-magenta-soft",
  skipped: "text-amber-300",
  unscored: "text-zinc-400",
};

const OUTCOME_DOT: Record<Outcome, string> = {
  won: "bg-cyan-glow",
  lost: "bg-magenta-soft",
  skipped: "bg-amber-300",
  unscored: "bg-zinc-500",
};

function StarGlyph({ className, filled }: { className: string; filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? "currentColor" : "none"}
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
  );
}

function PlayGlyph({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

/**
 * Only where a pointer can actually rest: a touch device fires a
 * synthetic hover on tap, which would start a rally the person is
 * already leaving.
 */
function useCanHover() {
  const [can, setCan] = useState(false);
  useEffect(() => {
    setCan(window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  }, []);
  return can;
}

/**
 * Should this device fetch frames at all?
 *
 * A poster frame is a range request against the clip, which is the right
 * trade on a laptop and the wrong one on a metered phone. Data Saver and
 * the 2g/slow-2g classes both mean "do not". The tile still has a design
 * underneath, so refusing costs a picture, not a page.
 */
function useWantsFrames() {
  const [wants, setWants] = useState(true);
  useEffect(() => {
    const c = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    if (!c) return;
    const slow = c.effectiveType === "2g" || c.effectiveType === "slow-2g";
    setWants(!c.saveData && !slow);
  }, []);
  return wants;
}

/**
 * Is this tile near the viewport? Nothing loads until it is.
 *
 * 600px of margin means a tile is ready by the time it is scrolled to,
 * without the whole shelf reaching for the network at once. Going out of
 * range unmounts the clip again, so a long scroll never accumulates
 * sixty video elements.
 */
function useNearViewport(ref: React.RefObject<HTMLElement | null>) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return near;
}

/**
 * A frame of the rally itself, roughly where the serve lands.
 *
 * The clip opens on the pre-serve pad, so second zero is a player
 * standing still — the same picture on every tile. A second and a half in
 * is the ball in the air. Short rallies clamp to their own midpoint
 * rather than to a frame they do not have.
 */
function posterTime(row: StarredPointRow) {
  const secs = rallySeconds(row);
  if (secs == null) return 1.2;
  return Math.min(1.5, Math.max(0.4, secs / 2));
}

/**
 * One starred rally.
 *
 * The picture is the point: a real frame out of the clip, which is the
 * only per-point image the system has — there is no stored still, and a
 * match's poster is the same picture for all of its points, which is a
 * repeated asset rather than imagery. So the tile mounts the clip itself
 * at `#t=`, paused on that frame, and hovering simply presses play on the
 * element already there. Nothing loads until the tile is near the
 * viewport; the designed wash underneath carries the tile until the frame
 * arrives, and stays if it never does.
 */
function Tile({
  row,
  reasons,
  onOpen,
  onUnstar,
}: {
  row: StarredPointRow;
  reasons: CustomReasonLabels;
  onOpen: () => void;
  onUnstar: () => void;
}) {
  const canHover = useCanHover();
  const wantsFrames = useWantsFrames();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const near = useNearViewport(boxRef);
  const [src, setSrc] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!near || !wantsFrames || src || !row.has_clip || row.edited) return;
    void (async () => {
      const url = await clipUrlFor(row.match_id, row.id);
      // The fragment is a media-fragment seek and never reaches R2, so it
      // rides on the signed URL without touching the signature.
      if (url && alive.current) setSrc(`${url}#t=${posterTime(row).toFixed(2)}`);
    })();
  }, [near, row, src, wantsFrames]);

  // Out of range: drop the element. A <video> removed from the document
  // keeps playing, with sound if it ever had any, so it is paused first.
  useEffect(() => {
    if (near) return;
    videoRef.current?.pause();
    setSrc(null);
    setReady(false);
  }, [near]);

  const play = useCallback(() => {
    if (!canHover) return;
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    void v.play().catch(() => {});
  }, [canHover]);

  const rest = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = posterTime(row);
  }, [row]);

  const outcome = outcomeOf(row);
  const reason = reasonLabel(row, reasons);
  const duration = durationLabel(row);
  const direction = row.direction ? DIRECTION_LABEL[row.direction] : null;
  const sub = [reason, direction].filter(Boolean).join(" · ");

  return (
    <div
      ref={boxRef}
      className="group relative aspect-video overflow-hidden rounded-2xl border border-edge bg-surface transition-colors duration-200 hover:border-cyan-glow/40"
      onMouseEnter={play}
      onMouseLeave={rest}
    >
      <div
        className={`absolute inset-0 bg-gradient-to-br to-transparent ${WASH[outcome]}`}
      />

      {/* What the tile looks like before the frame arrives, and instead of
          one on a connection that should not be spending bytes on
          pictures: the point's own number, sized off the tile so it is the
          same weight against the tile at every column count. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-3 flex select-none items-center text-7xl font-black leading-none tracking-tighter tabular-nums text-white/5 sm:text-6xl"
      >
        {row.display_no}
      </span>

      {src && (
        <video
          ref={videoRef}
          src={src}
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedData={() => setReady(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
            ready ? "opacity-100" : "opacity-0"
          }`}
        />
      )}

      {/* Legibility for the four corners, without flattening the picture. */}
      <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-ink/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink/80 to-transparent" />

      {/* The whole tile is the open target. Sits under the chrome so the
          star stays tappable; a button inside a button is not markup. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Play point ${row.display_no}`}
        className="absolute inset-0"
      />

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3.5">
        <div className="flex items-start justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${OUTCOME_DOT[outcome]}`} />
            <span
              className={`truncate text-sm font-semibold ${OUTCOME_TEXT[outcome]}`}
            >
              {outcomeLabel(row)}
            </span>
          </span>
          <button
            type="button"
            onClick={onUnstar}
            aria-label={`Remove the star from point ${row.display_no}`}
            className="pointer-events-auto -m-1 rounded-full p-1 text-amber-300 transition-colors hover:text-amber-200"
          >
            <StarGlyph className="h-4.5 w-4.5" filled />
          </button>
        </div>

        <div className="flex items-end justify-between gap-3">
          <span className="min-w-0">
            {sub && (
              <span className="mb-1 block truncate text-[11px] text-zinc-300">
                {sub}
              </span>
            )}
            <span className="flex items-center gap-1.5 text-xs font-semibold tabular-nums text-white">
              <PlayGlyph className="h-3 w-3 text-white/70 transition-colors group-hover:text-cyan-glow" />
              Point {row.display_no}
            </span>
          </span>
          <span className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-300">
            {row.edited ? "Updating clip" : duration}
          </span>
        </div>
      </div>
    </div>
  );
}

function ChevronRight({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function StarredView({
  initialRows,
  reasonLabels,
}: {
  initialRows: StarredPointRow[];
  reasonLabels: { id: string; label: string }[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [openId, setOpenId] = useState<string | null>(null);
  /** The last star removed, so it can be put back without a round trip. */
  const [undo, setUndo] = useState<{ row: StarredPointRow; at: number } | null>(null);
  const undoTimer = useRef<number | null>(null);

  const groups = useMemo(() => groupStarred(rows), [rows]);
  const reasons: CustomReasonLabels = useMemo(
    () => new Map(reasonLabels.map((r) => [r.id, r.label])),
    [reasonLabels]
  );
  const openIndex = openId ? rows.findIndex((r) => r.id === openId) : -1;

  useEffect(
    () => () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    },
    []
  );

  const writeStar = useCallback(async (row: StarredPointRow, next: boolean) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("points")
      .update({ starred: next })
      .eq("id", row.id);
    return !error;
  }, []);

  const unstar = useCallback(
    async (row: StarredPointRow) => {
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      setUndo({ row, at: Date.now() });
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(() => setUndo(null), 7000);
      const ok = await writeStar(row, false);
      if (!ok) {
        // The write is the truth. Put it back rather than leave the page
        // showing a set the database disagrees with.
        setRows((rs) =>
          [...rs, row].sort(
            (a, b) =>
              new Date(b.played_at).getTime() - new Date(a.played_at).getTime() ||
              a.display_no - b.display_no
          )
        );
        setUndo(null);
      }
    },
    [writeStar]
  );

  /**
   * Unstarring from inside the player takes the point out from under it,
   * so the host — the one holding the list — decides where the player
   * stands next: the point after it, or the one before when it was last.
   */
  const unstarFromPlayer = useCallback(
    (row: StarredPointRow) => {
      const i = rows.findIndex((r) => r.id === row.id);
      setOpenId(rows[i + 1]?.id ?? rows[i - 1]?.id ?? null);
      void unstar(row);
    },
    [rows, unstar]
  );

  const putBack = useCallback(async () => {
    if (!undo) return;
    const row = undo.row;
    setUndo(null);
    setRows((rs) =>
      [...rs, row].sort(
        (a, b) =>
          new Date(b.played_at).getTime() - new Date(a.played_at).getTime() ||
          a.display_no - b.display_no
      )
    );
    await writeStar(row, true);
  }, [undo, writeStar]);

  if (rows.length === 0) {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Starred points
        </h1>
        <div className="mt-8 rounded-2xl border border-edge bg-surface p-8 text-center">
          <p className="text-sm text-zinc-400">
            No starred points yet. Tap the star on any point to keep it here.
          </p>
          <Link
            href="/matches"
            className="mt-5 inline-flex rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white"
          >
            Go to matches
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Starred points
          </h1>
          <p className="mt-1.5 text-sm tabular-nums text-zinc-500">
            {summaryLine(rows)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpenId(rows[0].id)}
          className="inline-flex items-center gap-2 rounded-full border border-cyan-glow/40 bg-cyan-glow/10 px-4 py-2 text-sm font-semibold text-cyan-glow transition-colors hover:border-cyan-glow/70 hover:bg-cyan-glow/15"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5-11-6.5Z" />
          </svg>
          Play all
        </button>
      </div>

      <div className="mt-9 space-y-10">
        {groups.map((group) => (
          <section key={group.matchId}>
            <Link
              href={`/match/${group.matchId}`}
              className="group flex items-center gap-4 rounded-2xl px-1 py-1 transition-colors"
            >
              {group.hasThumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/thumb/${group.matchId}`}
                  alt=""
                  loading="lazy"
                  className="aspect-video w-24 shrink-0 rounded-xl border border-edge object-cover"
                />
              ) : (
                <span className="aspect-video w-24 shrink-0 rounded-xl border border-edge bg-surface-2" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold text-zinc-100 transition-colors group-hover:text-white">
                  {group.title}
                </span>
                <span className="mt-0.5 block truncate text-xs text-zinc-500">
                  {group.subtitle}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium tabular-nums text-zinc-500 transition-colors group-hover:text-zinc-300">
                {group.points.length} point{group.points.length === 1 ? "" : "s"}
                <ChevronRight className="h-4 w-4" />
              </span>
            </Link>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.points.map((row) => (
                <Tile
                  key={row.id}
                  row={row}
                  reasons={reasons}
                  onOpen={() => setOpenId(row.id)}
                  onUnstar={() => void unstar(row)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {undo && (
        <div className="fixed inset-x-0 bottom-24 z-40 flex justify-center px-5 md:bottom-8">
          <div className="flex items-center gap-4 rounded-full border border-edge bg-surface/95 py-2 pl-5 pr-2 shadow-lg backdrop-blur">
            <span className="text-sm text-zinc-300">Star removed</span>
            <button
              type="button"
              onClick={() => void putBack()}
              className="rounded-full border border-edge px-3.5 py-1.5 text-sm font-medium text-cyan-glow transition-colors hover:border-cyan-glow/60"
            >
              Undo
            </button>
          </div>
        </div>
      )}

      {openIndex >= 0 && (
        <StarredPlayer
          rows={rows}
          index={openIndex}
          onIndex={(i) => setOpenId(rows[i]?.id ?? null)}
          onClose={() => setOpenId(null)}
          reasons={reasons}
          onUnstar={unstarFromPlayer}
        />
      )}
    </>
  );
}
