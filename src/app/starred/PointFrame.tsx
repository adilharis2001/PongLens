"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clipUrlFor } from "./clipUrls";
import { outcomeOf, rallySeconds, type Outcome, type StarredPointRow } from "./starred";

/**
 * A frame of one starred rally, for the shelf's rows and Home's row.
 *
 * The picture is the point: a real frame out of the clip, which is the only
 * per-point image the system has — there is no stored still, and a match's
 * poster is the same picture for all of its points. So the frame mounts the
 * clip itself at `#t=`, paused there, and on a device with a resting pointer
 * hovering simply presses play on the element already there. Nothing loads
 * until the frame is near the viewport; the outcome wash underneath carries
 * it until the picture arrives, and stays if it never does.
 */

/** Tint per outcome. The same cyan/magenta the score has everywhere else. */
const WASH: Record<Outcome, string> = {
  won: "from-cyan-glow/20 via-cyan-glow/5",
  lost: "from-magenta-glow/20 via-magenta-glow/5",
  skipped: "from-amber-300/20 via-amber-300/5",
  unscored: "from-zinc-400/10 via-zinc-400/5",
};

/**
 * Only where a pointer can actually rest: a touch device fires a synthetic
 * hover on tap, which would start a rally the person is already leaving.
 */
function useCanHover() {
  const [can, setCan] = useState(false);
  useEffect(() => {
    setCan(window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  }, []);
  return can;
}

/**
 * Should this device fetch frames at all? A frame is a range request
 * against the clip: the right trade on a laptop, the wrong one on a metered
 * phone. Data Saver and the 2g classes both mean "do not".
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
 * Is this frame near the viewport? 600px of margin means a frame is ready
 * by the time it is scrolled to, without the whole shelf reaching for the
 * network at once. Going out of range unmounts the clip again, so a long
 * scroll never accumulates sixty video elements. Inside a sideways row the
 * row's own edge clips the observation, so a card loads as it slides in.
 */
function useNearViewport(ref: React.RefObject<HTMLElement | null>) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return near;
}

/**
 * Roughly where the serve lands. The clip opens on the pre-serve pad, so
 * second zero is a player standing still — the same picture on every row.
 * Short rallies clamp to their own midpoint.
 */
function posterTime(row: StarredPointRow) {
  const secs = rallySeconds(row);
  if (secs == null) return 1.2;
  return Math.min(1.5, Math.max(0.4, secs / 2));
}

export function PointFrame({
  row,
  className = "",
  children,
}: {
  row: StarredPointRow;
  /** Size and corners; the frame fills whatever box it is given. */
  className?: string;
  /** Anything drawn over the picture (a length, a star). */
  children?: React.ReactNode;
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

  return (
    <div
      ref={boxRef}
      onMouseEnter={play}
      onMouseLeave={rest}
      className={`relative overflow-hidden bg-surface-2 ${className}`}
    >
      <div
        className={`absolute inset-0 bg-gradient-to-br to-transparent ${WASH[outcomeOf(row)]}`}
      />
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
      {children}
    </div>
  );
}
