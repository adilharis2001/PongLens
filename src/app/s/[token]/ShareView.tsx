"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client half of the public /s/[token] page: the video player, and for
 * match links the tappable point list. Media URLs are short-TTL presigned
 * GETs fetched from /api/share/media (never rendered into the HTML), so a
 * revoked link dies even for a page someone kept open.
 */

export interface SharePointRow {
  id: string;
  /** display number (1-based timeline position) */
  number: number;
  /** seconds, null when timing is missing */
  duration: number | null;
  /** game divider AFTER this row: "Game 1 · 11-7" */
  boundary: { game: number; you: number; them: number } | null;
}

export function ShareView({
  token,
  points,
  initialPointId,
}: {
  token: string;
  /** match links: the visible point list; point links: undefined */
  points?: SharePointRow[];
  /** match links: which clip to load first */
  initialPointId?: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(
    initialPointId ?? null
  );
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // First load autoplays muted (mobile browsers require it); a row tap is
  // a user gesture, so subsequent clips play with sound.
  const userPicked = useRef(false);

  const load = useCallback(
    async (pointId: string | null) => {
      setError(null);
      try {
        const qs = new URLSearchParams({ token });
        if (pointId && points) qs.set("pointId", pointId);
        const res = await fetch(`/api/share/media?${qs.toString()}`);
        const data = res.ok ? await res.json() : null;
        if (!data?.url) throw new Error("no url");
        setVideoUrl(data.url);
      } catch {
        setError("Couldn't load the video. Try again shortly.");
      }
    },
    [token, points]
  );

  useEffect(() => {
    void load(initialPointId ?? null);
    // initial load only; row taps call load() directly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = useCallback(
    (id: string) => {
      userPicked.current = true;
      setActiveId(id);
      const v = videoRef.current;
      if (v) v.muted = false;
      void load(id);
    },
    [load]
  );

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-edge bg-ink">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            autoPlay
            muted={!userPicked.current}
            preload="metadata"
            className="max-h-[60vh] w-full bg-black"
          />
        ) : error ? (
          <p className="p-8 text-center text-sm text-red-300">{error}</p>
        ) : (
          <div className="flex aspect-video items-center justify-center">
            <p className="text-sm text-zinc-600">Loading…</p>
          </div>
        )}
      </div>

      {/* match links: read-only point list; tap = play that clip above */}
      {points && points.length > 0 && (
        <ul className="mt-5 space-y-2">
          {points.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => pick(p.id)}
                aria-current={activeId === p.id || undefined}
                className={`flex w-full items-center gap-3 rounded-xl border bg-surface px-4 py-3 text-left transition-colors ${
                  activeId === p.id
                    ? "border-cyan-glow/60"
                    : "border-edge hover:border-cyan-glow/40"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                    activeId === p.id
                      ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                      : "border-edge bg-ink/60 text-zinc-300"
                  }`}
                >
                  {p.number}
                </span>
                <span className="min-w-0 flex-1 text-sm font-medium text-zinc-200">
                  Point {p.number}
                </span>
                {p.duration !== null && (
                  <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                    {p.duration.toFixed(1)}s
                  </span>
                )}
                <svg
                  viewBox="0 0 24 24"
                  className={`h-4 w-4 shrink-0 ${
                    activeId === p.id ? "text-cyan-glow" : "text-zinc-600"
                  }`}
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M8 6.5v11l9-5.5-9-5.5Z" />
                </svg>
              </button>
              {p.boundary && (
                <div className="mt-2 flex items-center gap-3" aria-hidden="true">
                  <span className="h-px flex-1 bg-edge" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Game {p.boundary.game} · {p.boundary.you}-{p.boundary.them}
                  </span>
                  <span className="h-px flex-1 bg-edge" />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
