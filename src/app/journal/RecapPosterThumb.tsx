"use client";

import { useEffect, useState } from "react";

/**
 * The poster of a lesson recap, on a feed card, at the size a match
 * thumbnail would be. A recap used to sit in the feed as a label beside a
 * wall of cards, and read as the odd one out.
 *
 * The poster is a signed link the detail endpoint hands back, so it is
 * fetched per recap rather than carried by the feed. A recap without a
 * poster yet — still rendering, or the file missing — keeps the glyph,
 * which is honest: there is nothing to show. Twin of RecapPosterThumb on
 * iOS; RecapPreview is the full-width version the expanded shared card
 * uses, and stays as it is.
 */
export function RecapPosterThumb({ id }: { id: string }) {
  const [posterUrl, setPosterUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/lesson-video?id=" + id)
      .then(async (r) => {
        if (!r.ok) return;
        const d = (await r.json()) as { posterUrl?: string };
        if (active && d.posterUrl) setPosterUrl(d.posterUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <span className="relative block h-16 w-[104px] shrink-0 overflow-hidden rounded-xl border border-edge bg-cyan-glow/10">
      {posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-cyan-glow">
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm6 3.5v7l6-3.5z" />
          </svg>
        </span>
      )}
    </span>
  );
}
