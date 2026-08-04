"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CutVideo } from "./CutVideo";
import {
  breakdownSummary,
  buildPointBreakdown,
  formatClock,
  gapLabel,
  pointFlags,
  timelineSegments,
  type AdminPoint,
  type PointBreakdownRow,
} from "../playersView";

/**
 * A match opened point by point, to grade the dead-space cut. The strip is
 * the source timeline: painted spans are what the cut kept, the dark rest
 * is what it removed. Rows carry the boundary flags — "edited" means the
 * player had to fix a boundary by hand, "tight" that the pads were
 * squeezed against a neighbor — and each clip plays on its own.
 */

export function PointBreakdown({ matchId }: { matchId: string }) {
  const [rows, setRows] = useState<PointBreakdownRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [clipLoading, setClipLoading] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .rpc("admin_match_points", { p_match_id: matchId })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setRows(buildPointBreakdown((data as AdminPoint[]) ?? []));
      });
  }, [matchId]);

  const play = async (row: PointBreakdownRow) => {
    if (playingId === row.id) {
      setPlayingId(null);
      setClipUrl(null);
      return;
    }
    setClipLoading(row.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, pointId: row.id }),
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setError(body.error ?? "Could not load the clip.");
        return;
      }
      setPlayingId(row.id);
      setClipUrl(body.url);
    } catch {
      setError("Could not load the clip.");
    } finally {
      setClipLoading(null);
    }
  };

  if (error && rows === null) {
    return <p className="mt-3 text-xs text-red-400">{error}</p>;
  }
  if (rows === null) {
    return (
      <div className="mt-3 h-16 animate-pulse rounded-xl bg-surface-2/40" />
    );
  }
  if (rows.length === 0) {
    return <p className="mt-3 text-xs text-zinc-500">No points.</p>;
  }

  const summary = breakdownSummary(rows);
  const playing = rows.find((r) => r.id === playingId) ?? null;

  return (
    <div className="mt-4 border-t border-edge/60 pt-4">
      {summary && <p className="text-xs text-zinc-500">{summary}</p>}

      {/* Source timeline: painted = kept, dark = removed */}
      <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-surface-2">
        {timelineSegments(rows).map((seg) => (
          <div
            key={seg.idx}
            title={`Point ${seg.idx + 1}`}
            className={`absolute inset-y-0 ${
              seg.deleted ? "bg-cyan-glow/25" : "bg-cyan-glow/70"
            }`}
            style={{
              left: `${seg.leftPct}%`,
              width: `${seg.widthPct}%`,
            }}
          />
        ))}
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {playing && clipUrl && (
        <div>
          <p className="mt-3 text-xs text-zinc-400">
            Point {playing.idx + 1} · {formatClock(playing.t0)} →{" "}
            {formatClock(playing.t1)}
          </p>
          <CutVideo url={clipUrl} />
        </div>
      )}

      <ul className="mt-3 max-h-80 space-y-px overflow-y-auto">
        {rows.map((row) => {
          const flags = pointFlags(row);
          const gap = gapLabel(row.gapBeforeS);
          return (
            <li
              key={row.id}
              className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-xs ${
                row.deleted ? "opacity-50" : ""
              } ${playingId === row.id ? "bg-surface-2/60" : ""}`}
            >
              <span className="w-7 shrink-0 tabular-nums text-zinc-600">
                {row.idx + 1}
              </span>
              <span className="shrink-0 tabular-nums text-zinc-300">
                {formatClock(row.t0)} → {formatClock(row.t1)}
              </span>
              <span className="shrink-0 tabular-nums text-zinc-500">
                {Math.round(row.lengthS)}s
              </span>
              {gap && (
                <span className="shrink-0 tabular-nums text-zinc-600">
                  {gap}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">
                {row.starred && <span className="text-cyan-glow">★ </span>}
                {flags.map((flag, i) => (
                  <span
                    key={flag}
                    className={
                      flag === "edited" ? "text-amber-300" : "text-zinc-500"
                    }
                  >
                    {i > 0 && " · "}
                    {flag}
                  </span>
                ))}
              </span>
              {row.confirmed_winner && (
                <span className="shrink-0 text-zinc-500">
                  {row.confirmed_winner === "user" ? "won" : "lost"}
                </span>
              )}
              {row.has_clip && (
                <button
                  type="button"
                  onClick={() => void play(row)}
                  disabled={clipLoading === row.id}
                  className="shrink-0 font-medium text-zinc-400 transition-colors hover:text-cyan-glow disabled:opacity-60"
                >
                  {clipLoading === row.id
                    ? "Loading…"
                    : playingId === row.id
                      ? "Close"
                      : "Play"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
