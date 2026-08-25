"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeMatchScore } from "@/app/match/[id]/gameScore";
import { ScoreBug, scoreBugPlacement } from "@/app/match/[id]/ScoreBug";
import { SharePlayer } from "./SharePlayer";
import { sharePointsAsPoints, type ResolvedSharePoint } from "./shareData";

/**
 * Client half of the public /s/[token] page for POINT and MATCH links.
 * Media URLs are short-TTL presigned GETs fetched from /api/share/media
 * (never rendered into the HTML), so a revoked link dies even for a page
 * someone kept open.
 *
 * A scored match link also carries the score. It is the same ScoreBug the
 * app draws over its own player and the same table the reel burns into an
 * exported file, so a match reads the same whether you own it, were sent
 * it, or downloaded it.
 *
 * The score is an OVERLAY, not burnt into the pixels. That is why it works
 * on links shared long before it existed, and why turning it off is
 * instant rather than a re-render. It is drawn INSIDE the player — see
 * SharePlayer. As a sibling it was hidden the moment the takeover went
 * full screen, which is how a fully-scored match came to look unscored.
 *
 * THE CLOCK: rally positions come from cut_t0, seconds into the CUT video
 * — the file this page actually plays. They used to come from t0, which is
 * in the source timebase; on one real match that drew 0-3 at 1:13 where
 * the truth entering that rally was 2-4, and the gap grew as the match
 * went on. Any time comparison on this page is against cut_t0 or it is
 * wrong.
 */
export function ShareView({
  token,
  kind,
  matchId,
  points = [],
  skipSpans = [],
  showScore = false,
  you,
  them,
}: {
  token: string;
  /** A point link plays one rally; a match link plays the cut video. */
  kind: "point" | "match";
  matchId: string;
  /** Match links only: the visible points, in timeline order. Plain rows
   *  straight from resolve_share_points — the walk happens here rather
   *  than on the server because MatchScore carries a Map and a Set, and
   *  neither survives the server-to-client boundary. */
  points?: ResolvedSharePoint[];
  /** Dead footage the player jumps during playback: deleted cards and,
   *  with tap_end_playback on (138/139), the tail after each winner tap.
   *  Computed by the page (playhead.skipSpans); absent means no jumping,
   *  exactly the pre-139 page. */
  skipSpans?: { start: number; end: number }[];
  showScore?: boolean;
  you: string;
  them: string;
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playheadT, setPlayheadT] = useState(0);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const skipSpansRef = useRef(skipSpans);
  skipSpansRef.current = skipSpans;

  /** Every playhead move goes through here: inside dead footage —
   *  deleted cards, tap-trimmed tails — playback jumps forward, the same
   *  contract as the owner's own player. Only while playing; a paused
   *  scrub goes wherever it was put. */
  const onPlayhead = useCallback((t: number) => {
    const v = videoElRef.current;
    if (v && !v.paused) {
      const z = skipSpansRef.current.find(
        (sp) => t >= sp.start && t < sp.end - 0.05
      );
      if (z) {
        v.currentTime = z.end;
        setPlayheadT(z.end);
        return;
      }
    }
    setPlayheadT(t);
  }, []);

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

  const asPoints = useMemo(
    () => sharePointsAsPoints(points, matchId),
    [points, matchId]
  );

  /** Where each rally starts in the CUT video, paired with its position in
   *  the ordered list. Rallies with no cut_t0 (matches processed before
   *  migration 011) simply cannot be placed on this clock, so they are
   *  left out of navigation and out of the score walk rather than guessed
   *  at with the source time. */
  const timeline = useMemo(() => {
    const walked: { at: number; index: number }[] = [];
    points.forEach((p, index) => {
      if (p.cut_t0 === null) return;
      walked.push({ at: Number(p.cut_t0), index });
    });
    return walked;
  }, [points]);

  /** The rally on screen: the last one that has started. -1 before the
   *  first. */
  const activeRow = useMemo(() => {
    let found = -1;
    for (let i = 0; i < timeline.length; i += 1) {
      if (timeline[i].at <= playheadT + 0.001) found = i;
      else break;
    }
    return found;
  }, [timeline, playheadT]);

  const scored = useMemo(
    () => points.some((p) => !p.is_let && p.confirmed_winner !== null),
    [points]
  );

  /**
   * The score ENTERING the rally on screen — entering, not including: a
   * scoreboard that already counts the rally you are watching gives away
   * how it ends.
   *
   * Present from 0:00, reading 0-0, exactly as the match player's own bug
   * does. It used to wait for the first rally to start, on the reasoning
   * that "0-0 over an empty table is noise" — but the player side had
   * already decided the opposite, and a scoreboard that blinks into
   * existence a minute into a video reads as broken rather than tidy. The
   * gate is whether the MATCH has a score at all, which is what
   * Player.tsx gates on too.
   */
  const entering = useMemo(() => {
    if (!showScore || !scored) return null;
    const upto = activeRow < 0 ? 0 : timeline[activeRow].index;
    return computeMatchScore(asPoints.slice(0, upto));
  }, [showScore, scored, activeRow, timeline, asPoints]);

  const seekTo = useCallback((seconds: number) => {
    const v = videoElRef.current;
    if (!v) return;
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    v.currentTime = Math.min(Math.max(0, seconds), d || seconds);
    setPlayheadT(v.currentTime);
    // Navigation always plays its destination, the same as the app's
    // player: leaving a rally by a gesture never strands a paused frame.
    if (v.paused) void v.play().catch(() => {});
  }, []);

  /** Outer thirds of a double tap, on a match link: walk the rallies. This
   *  is the gesture the app has, and the reason the public page felt like
   *  a different product — it nudged ten seconds instead. */
  const stepPoint = useCallback(
    (delta: -1 | 1) => {
      if (timeline.length === 0) return;
      // Back inside the first two seconds of a rally means "the previous
      // one"; later in it, means "start this one again". Every video
      // player on a phone behaves this way with tracks.
      const here = activeRow;
      let target: number;
      if (delta === 1) target = here + 1;
      else target = playheadT - (timeline[here]?.at ?? 0) > 2 ? here : here - 1;
      const clamped = Math.min(Math.max(0, target), timeline.length - 1);
      seekTo(timeline[clamped].at);
    },
    [timeline, activeRow, playheadT, seekTo]
  );

  const replayRally = useCallback(() => {
    if (activeRow < 0) return;
    seekTo(timeline[activeRow].at);
  }, [activeRow, timeline, seekTo]);

  const hasRallies = kind === "match" && timeline.length > 0;

  return (
    <div className="relative overflow-hidden bg-ink sm:rounded-2xl sm:border sm:border-edge">
      {videoUrl ? (
        <SharePlayer
          src={videoUrl}
          kind={kind === "match" ? "match" : "clip"}
          videoElRef={videoElRef}
          onTime={onPlayhead}
          onStepPoint={hasRallies ? stepPoint : undefined}
          onReplay={hasRallies ? replayRally : undefined}
          overlay={
            entering
              ? (picture) => (
                  /* Bottom-left of the PICTURE, by the same rule the match
                     player uses — 12px in, lifted only far enough to clear
                     this player's transport when the picture actually
                     reaches it. Never takes a tap. */
                  <ScoreBug
                    score={entering}
                    you={you}
                    them={them}
                    pictureHeight={picture.height}
                    className="absolute"
                    style={scoreBugPlacement(picture)}
                  />
                )
              : undefined
          }
        />
      ) : error ? (
        <p className="p-8 text-center text-sm text-red-300">{error}</p>
      ) : (
        <div className="flex aspect-video items-center justify-center">
          <p className="text-sm text-zinc-600">Loading…</p>
        </div>
      )}
    </div>
  );
}
