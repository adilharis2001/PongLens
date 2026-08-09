"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The points a coach cited, on the page instead of behind a button.
 *
 * Somebody paid for this review, and the clips are the part of it that only
 * this coach could have made. A row of "Point 1 / Point 2" chips hides them
 * behind a decision; a reel puts the footage on the page, so the review
 * arrives looking like footage plus writing rather than writing alone.
 *
 * One clip at a time, swiped on a touch screen and stepped with arrows on a
 * desktop. Nothing autoplays: several videos on one page, all deciding to
 * start themselves, is how a page starts shouting.
 */

interface ReelPoint {
  point_id: string;
  idx: number;
}

async function signBatch(
  orderId: string,
  pointIds: string[],
): Promise<Record<string, string>> {
  try {
    const res = await fetch("/api/review-media", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId, pointIds }),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { urls?: Record<string, string> };
    return data.urls ?? {};
  } catch {
    return {};
  }
}

export function PointReel({
  orderId,
  points,
  matchId,
}: {
  orderId: string;
  points: ReelPoint[];
  /** When set, the reel offers a way through to the full match. */
  matchId?: string | null;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const [cur, setCur] = useState(0);
  /** Which slides have been played, so native controls arrive per clip. */
  const [started, setStarted] = useState<Record<string, boolean>>({});
  const [playing, setPlaying] = useState(false);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const videos = useRef<Record<string, HTMLVideoElement | null>>({});
  const curRef = useRef(0);
  /** A clip whose signed URL died mid-session and which is owed a play. */
  const owed = useRef<string | null>(null);

  // Signed URLs are short lived by design, so the identity that matters is
  // the list of points, not the array object the parent happened to build.
  const key = points.map((p) => p.point_id).join(",");

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) return;
    let alive = true;
    void signBatch(orderId, ids).then((got) => {
      if (!alive) return;
      setUrls(got);
      setFailed(Object.keys(got).length === 0);
    });
    return () => {
      alive = false;
    };
  }, [orderId, key]);

  // A detached <video> carries on playing, with sound. Every one of them.
  useEffect(() => {
    const els = videos.current;
    return () => {
      Object.values(els).forEach((v) => v?.pause());
    };
  }, []);

  const only = (pointId: string) => {
    Object.entries(videos.current).forEach(([id, v]) => {
      if (id !== pointId) v?.pause();
    });
  };

  const start = useCallback((pointId: string) => {
    only(pointId);
    setStarted((s) => (s[pointId] ? s : { ...s, [pointId]: true }));
    void videos.current[pointId]?.play().catch(() => {});
  }, []);

  /**
   * The URL that loaded the first frame ten minutes ago will not serve the
   * rest of the clip today. Mint a fresh one and finish the play the reader
   * actually asked for; a failure before they pressed anything is left
   * alone, because re-signing on every idle error is a retry loop.
   */
  const refresh = useCallback(
    async (pointId: string, wanted: boolean) => {
      if (wanted) owed.current = pointId;
      const got = await signBatch(orderId, [pointId]);
      const fresh = got[pointId];
      if (!fresh) return;
      setUrls((u) => ({ ...u, [pointId]: fresh }));
    },
    [orderId],
  );

  useEffect(() => {
    const id = owed.current;
    if (!id || !urls[id]) return;
    owed.current = null;
    only(id);
    void videos.current[id]?.play().catch(() => {});
  }, [urls]);

  const goTo = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  const onScroll = () => {
    const el = trackRef.current;
    if (!el || !el.clientWidth) return;
    const i = Math.min(
      points.length - 1,
      Math.max(0, Math.round(el.scrollLeft / el.clientWidth)),
    );
    if (i === curRef.current) return;
    curRef.current = i;
    // Swiping away from a clip stops it. Two rallies talking over each
    // other is the one thing a deck of videos can do that nothing else can.
    only(points[i].point_id);
    setPlaying(false);
    setCur(i);
  };

  if (points.length === 0) return null;

  const many = points.length > 1;

  return (
    <div className="mt-3">
      <div className="relative">
        <div
          ref={trackRef}
          onScroll={onScroll}
          className="flex snap-x snap-mandatory overflow-x-auto rounded-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {points.map((p, i) => {
            const url = urls[p.point_id];
            const live = started[p.point_id] === true;
            return (
              <div
                key={p.point_id}
                className="w-full shrink-0 snap-center"
                aria-label={`Point ${p.idx + 1}`}
              >
                {/* The box is a div, always. A <video> has no size until its
                    metadata lands, so sizing one starts at the spec's 300x150
                    and visibly jumps when the file answers. */}
                <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-edge bg-black">
                  {url ? (
                    <video
                      ref={(el) => {
                        videos.current[p.point_id] = el;
                      }}
                      src={url}
                      controls={live}
                      playsInline
                      preload={Math.abs(i - cur) <= 1 ? "metadata" : "none"}
                      onPlay={() => {
                        setPlaying(true);
                        setStarted((s) =>
                          s[p.point_id] ? s : { ...s, [p.point_id]: true },
                        );
                      }}
                      onPause={() => setPlaying(false)}
                      onEnded={() => setPlaying(false)}
                      onError={() => void refresh(p.point_id, live)}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div
                      className={`h-full w-full ${
                        failed ? "" : "animate-pulse bg-surface-2/40"
                      }`}
                    />
                  )}

                  {/* Ours until it plays. Idle, the browser paints its own
                      play button, skip controls and scrubber across the
                      picture, and on iOS an expand icon in the corner. */}
                  {!live && (
                    <button
                      type="button"
                      onClick={() => start(p.point_id)}
                      disabled={!url}
                      aria-label={`Play point ${p.idx + 1}`}
                      className="absolute inset-0 flex items-center justify-center transition-colors hover:bg-black/10 disabled:cursor-default"
                    >
                      {url && (
                        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur">
                          <svg
                            viewBox="0 0 24 24"
                            className="ml-0.5 h-6 w-6"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop stepping. Hidden while a clip plays, because the native
            controls own the picture from then on. */}
        {many && (
          <div
            className={`pointer-events-none absolute inset-y-0 left-0 right-0 hidden items-center justify-between px-2 transition-opacity sm:flex ${
              playing ? "opacity-0" : "opacity-100"
            }`}
          >
            {[-1, 1].map((d) => {
              const to = cur + d;
              const can = to >= 0 && to < points.length;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => goTo(to)}
                  disabled={!can}
                  aria-label={d < 0 ? "Previous point" : "Next point"}
                  className={`pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-opacity hover:text-cyan-glow ${
                    can ? "" : "opacity-0"
                  }`}
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
                      d={d < 0 ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"}
                    />
                  </svg>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {failed && (
        <p className="mt-2 text-sm text-zinc-400">
          The clips could not be loaded just now. Refreshing usually sorts it.
        </p>
      )}

      {/* The only place a point number is printed, so the reel and the index
          can never disagree about which clip you are looking at. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {many &&
          points.map((p, i) => (
            <button
              key={p.point_id}
              type="button"
              onClick={() => goTo(i)}
              aria-current={i === cur}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                i === cur
                  ? "border-cyan-glow/60 text-cyan-glow"
                  : "border-edge bg-surface-2 text-zinc-300 hover:border-cyan-glow/40"
              }`}
            >
              Point {p.idx + 1}
            </button>
          ))}
        {!many && (
          <span className="text-sm text-zinc-400">
            Point {points[0].idx + 1}
          </span>
        )}
        {matchId && (
          <a
            href={`/match/${matchId}?p=${points[cur]?.point_id ?? points[0].point_id}`}
            className="ml-auto text-sm text-zinc-400 transition-colors hover:text-cyan-glow"
          >
            Open in the match
          </a>
        )}
      </div>
    </div>
  );
}
