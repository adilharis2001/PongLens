"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client half of the public /s/[token] page for STARRED links: plays the
 * currently-starred clips sequentially. Native controls; 'ended' advances
 * to the next clip; a minimal "2 / 5" indicator with prev/next chevrons
 * (tapping the counter itself also advances). The clip list is resolved
 * server-side AT VIEW TIME — refresh and it reflects the owner's current
 * stars. Media URLs are short-TTL presigned GETs from /api/share/media,
 * re-validated per clip, so unstarred clips die even mid-session.
 */

export interface StarredClip {
  id: string;
  /** display number (timeline position among all points) */
  number: number;
  /** seconds, null when timing is missing */
  duration: number | null;
}

export function StarredView({
  token,
  clips,
}: {
  token: string;
  clips: StarredClip[];
}) {
  const [idx, setIdx] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (i: number) => {
      const mySeq = ++seq.current;
      setError(null);
      try {
        const qs = new URLSearchParams({ token, pointId: clips[i].id });
        const res = await fetch(`/api/share/media?${qs.toString()}`);
        const data = res.ok ? await res.json() : null;
        if (!data?.url) throw new Error("no url");
        if (seq.current === mySeq) setVideoUrl(data.url);
      } catch {
        if (seq.current === mySeq) {
          setError("Couldn't load the clip. Try again shortly.");
        }
      }
    },
    [token, clips]
  );

  // First clip autoplays muted (mobile browsers require it); the SAME
  // <video> element is reused across clips, so it keeps whatever mute
  // state the viewer picks after that.
  useEffect(() => {
    void load(0);
    // initial load only; navigation calls load() directly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New src on the same element: kick playback explicitly so auto-advance
  // keeps rolling even where the autoplay attribute is only honored once.
  useEffect(() => {
    if (!videoUrl) return;
    const v = videoRef.current;
    if (v) void v.play().catch(() => {});
  }, [videoUrl]);

  const go = useCallback(
    (i: number) => {
      if (i < 0 || i >= clips.length) return;
      setIdx(i);
      void load(i);
    },
    [clips.length, load]
  );

  const chevron =
    "flex h-9 w-9 items-center justify-center rounded-full border border-edge text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-30 disabled:hover:border-edge disabled:hover:text-zinc-400";

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
            muted
            preload="metadata"
            onEnded={() => {
              if (idx < clips.length - 1) go(idx + 1);
            }}
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

      {/* minimal position indicator: ‹ 2 / 5 › */}
      {clips.length > 1 && (
        <div className="mt-3 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => go(idx - 1)}
            disabled={idx === 0}
            aria-label="Previous clip"
            className={chevron}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => go(idx + 1 < clips.length ? idx + 1 : idx)}
            aria-label={`Clip ${idx + 1} of ${clips.length}. Tap for next.`}
            className="min-w-14 text-center text-sm font-semibold tabular-nums text-zinc-300"
          >
            {idx + 1} / {clips.length}
          </button>
          <button
            type="button"
            onClick={() => go(idx + 1)}
            disabled={idx === clips.length - 1}
            aria-label="Next clip"
            className={chevron}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
