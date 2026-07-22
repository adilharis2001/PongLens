"use client";

import { useEffect, useState } from "react";
import { SharePlayer } from "./SharePlayer";

/**
 * Client half of the public /s/[token] page for POINT and MATCH links:
 * just the video (in the SharePlayer custom skin — never native
 * controls). Point links play the point's clip; match links play the
 * whole cut video — no point list on the public page. Media URLs are
 * short-TTL presigned GETs fetched from /api/share/media (never rendered
 * into the HTML), so a revoked link dies even for a page someone kept open.
 */
export function ShareView({ token }: { token: string }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="overflow-hidden rounded-2xl border border-edge bg-ink">
      {videoUrl ? (
        <SharePlayer src={videoUrl} />
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
