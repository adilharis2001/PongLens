"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { computeMatchScore } from "@/app/match/[id]/gameScore";
import { ScoreBug } from "@/app/match/[id]/ScoreBug";
import type { Point } from "@/lib/types";
import { SharePlayer } from "./SharePlayer";
import type { ResolvedSharePoint } from "./shareData";

/**
 * Client half of the public /s/[token] page for POINT and MATCH links:
 * just the video (in the SharePlayer custom skin — never native
 * controls). Point links play the point's clip; match links play the
 * whole cut video — no point list on the public page. Media URLs are
 * short-TTL presigned GETs fetched from /api/share/media (never rendered
 * into the HTML), so a revoked link dies even for a page someone kept open.
 *
 * A scored match link also carries the score, when the owner left that on.
 * It is the same ScoreBug the app draws over the watch player and the same
 * table the reel burns into an exported file, so a match reads the same
 * whether you own it, were sent it, or downloaded it.
 *
 * The score is an OVERLAY, not burnt into the pixels. That is why it works
 * on links shared long before this existed, and why turning it off is
 * instant rather than a re-render.
 */
export function ShareView({
  token,
  kind,
  points = [],
  showScore = false,
  you,
  them,
}: {
  token: string;
  /** A point link plays one rally, so it gets Replay; a match link does not. */
  kind: "point" | "match";
  /** Match links only: the visible points, in timeline order. Plain rows
   *  straight from resolve_share_points — the walk happens here rather than
   *  on the server because MatchScore carries a Map and a Set, and neither
   *  survives the server-to-client boundary. */
  points?: ResolvedSharePoint[];
  showScore?: boolean;
  you: string;
  them: string;
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playheadT, setPlayheadT] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** The picture's height, and how far its bottom edge sits above the
   *  bottom of this box. SharePlayer's transport is a sibling BELOW the
   *  video, not an overlay on it, so a bug pinned to the box lands on the
   *  scrub bar. It belongs to the picture, the same as in the app. */
  const [frame, setFrame] = useState({ height: 0, bottomGap: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ token });
        const res = await fetch(`/api/share/media?${qs.toString()}`);
        const data = res.ok ? await res.json() : null;
        if (!data?.url) throw new Error("no url");
        if (!cancelled) setVideoUrl(data.url);
      } catch {
        if (!cancelled) setError("Couldn't load the video. Try again shortly.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // The bug sizes itself off the picture, so the same panel is ~12% of the
  // height on a phone and on a desktop instead of shrinking as the video
  // grows.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const video = box.querySelector("video");
      if (!video) return;
      const b = box.getBoundingClientRect();
      const v = video.getBoundingClientRect();
      setFrame({
        height: v.height,
        bottomGap: Math.max(0, b.bottom - v.bottom),
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    const video = box.querySelector("video");
    if (video) ro.observe(video);
    measure();
    return () => ro.disconnect();
  }, [videoUrl]);

  /** The score ENTERING each rally, paired with the time that rally starts.
   *  Entering, not including: a scoreboard that already counts the rally
   *  you are watching gives away how it ends. */
  const timeline = useMemo(() => {
    if (!showScore || points.length === 0) return [];
    const walked: { at: number; index: number }[] = [];
    points.forEach((p, index) => {
      if (p.t0 === null) return;
      walked.push({ at: Number(p.t0), index });
    });
    return walked;
  }, [points, showScore]);

  const scored = useMemo(
    () => points.some((p) => !p.is_let && p.confirmed_winner !== null),
    [points]
  );

  const entering = useMemo(() => {
    if (!showScore || !scored || timeline.length === 0) return null;
    // The last rally that has started. Before the first one there is
    // nothing to show — 0-0 over an empty table is noise.
    let found = -1;
    for (const row of timeline) {
      if (row.at <= playheadT + 0.001) found = row.index;
      else break;
    }
    if (found < 0) return null;
    return computeMatchScore(points.slice(0, found) as unknown as Point[]);
  }, [showScore, scored, timeline, playheadT, points]);

  return (
    <div
      ref={boxRef}
      className="relative overflow-hidden rounded-2xl border border-edge bg-ink"
    >
      {videoUrl ? (
        <SharePlayer
          src={videoUrl}
          showReplay={kind === "point"}
          onTime={setPlayheadT}
        />
      ) : error ? (
        <p className="p-8 text-center text-sm text-red-300">{error}</p>
      ) : (
        <div className="flex aspect-video items-center justify-center">
          <p className="text-sm text-zinc-600">Loading…</p>
        </div>
      )}

      {/* Bottom-left, where the reel burns it. Never takes a tap: every
          pixel of this box is the player's play/pause surface. */}
      {entering && entering.confirmedCount > 0 && (
        <ScoreBug
          score={entering}
          you={you}
          them={them}
          pictureHeight={frame.height}
          className="pointer-events-none absolute left-3 z-10"
          style={{ bottom: frame.bottomGap + 12 }}
        />
      )}
    </div>
  );
}
