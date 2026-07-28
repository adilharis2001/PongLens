"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A real product capture, shipped as a small muted loop (public/demo/*,
 * produced by scripts/demos/). Performance contract:
 *
 *   - poster JPEG renders immediately; the video bytes load only when the
 *     loop scrolls near (preload="none" + IntersectionObserver play);
 *   - off-screen loops pause;
 *   - prefers-reduced-motion gets the still poster, no video at all.
 */
export function DemoLoop({
  name,
  label,
  className = "",
  eager = false,
}: {
  /** basename under /demo (name.mp4 + name.jpg) */
  name: string;
  /** accessible description of what the capture shows */
  label: string;
  className?: string;
  /** hero only: fetch the video immediately */
  eager?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [reduced, setReduced] = useState<boolean | null>(null);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    const v = ref.current;
    if (!v || reduced !== false) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) void v.play().catch(() => {});
        else v.pause();
      },
      { rootMargin: "200px", threshold: 0.1 }
    );
    io.observe(v);
    return () => io.disconnect();
  }, [reduced]);

  if (reduced) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/demo/${name}.jpg`}
        alt={label}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className={className}
      />
    );
  }
  return (
    <video
      ref={ref}
      src={`/demo/${name}.mp4`}
      poster={`/demo/${name}.jpg`}
      muted
      loop
      playsInline
      preload={eager ? "auto" : "none"}
      aria-label={label}
      className={className}
    />
  );
}
