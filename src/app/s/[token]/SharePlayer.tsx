"use client";

import Link from "next/link";
import { tapZone } from "@/app/match/[id]/tapZone";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal custom player for the public /s/[token] pages — the tiny,
 * logged-out-safe sibling of the match page's Player. Same visual
 * language (bg-ink, cyan progress, ks-fade glyphs) but no chrome beyond
 * tap-to-play, a thin scrub bar with time labels, and a mute toggle.
 *
 * NO native controls, ever: on iOS the native chrome (big play button,
 * ±10s skips, scrubber) flashes on every src swap, which wrecks the
 * starred auto-advance. And no fullscreen/PiP — native fullscreen forces
 * the iOS player back in.
 *
 * Nothing plays until the viewer says so. The card on the page is a poster
 * with a play button; pressing it opens the full-screen takeover AND starts
 * playback in the same gesture. Because playback now always begins from a
 * gesture, it begins with sound — the mute attribute is only the starting
 * state, dropped on that first press, and the speaker toggle is the sole
 * authority from then on. When src changes mid-session (starred
 * auto-advance) the same element keeps playing seamlessly; if play() rejects
 * we show our own glyph rather than anything native.
 */

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function SharePlayer({
  src,
  onEnded,
  showReplay = false,
  nav,
}: {
  src: string;
  /** StarredView's auto-advance hook; single videos just stop. */
  onEnded?: () => void;
  /** Point and starred links only: the clip IS one point, so "again" means
   *  something. On a whole-match link it would rewind the match. */
  showReplay?: boolean;
  /**
   * A sequence of clips (a starred link). Given this, the takeover's
   * double-tap moves between CLIPS rather than seeking ten seconds —
   * on a six-second rally a ten-second skip is the whole clip and then
   * some, while "next point" is what the viewer actually wants.
   */
  nav?: {
    index: number;
    total: number;
    onPrev: () => void;
    onNext: () => void;
  };
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(true);
  const [playheadT, setPlayheadT] = useState(0);
  const [duration, setDuration] = useState(0);

  // First user-gesture play unmutes automatically (see contract above).
  const autoMuted = useRef(true);

  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const navRef = useRef(nav);
  navRef.current = nav;

  /** Has the viewer started this session? Nothing plays before they do. */
  const started = useRef(false);

  // New src on the same element (starred auto-advance): keep rolling — but
  // only once the viewer has started. The page itself does NOT autoplay:
  // the card is a poster, and pressing play is what takes you into the
  // full-screen view. A video that starts on its own in a card is a video
  // you watch in a card, which is not the experience we are handing people.
  useEffect(() => {
    setPlayheadT(0);
    setDuration(0);
    const v = videoRef.current;
    if (!v || !started.current) return;
    v.play().catch(() => setPaused(true));
  }, [src]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // Playback always begins from a gesture now, so it begins with sound.
      if (autoMuted.current && v.muted) {
        v.muted = false;
        setMuted(false);
      }
      autoMuted.current = false;
      started.current = true;
      v.play().catch(() => setPaused(true));
    } else {
      v.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    autoMuted.current = false; // explicit choice from here on
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  /** Restart this clip — the shared thing IS the point, so "again" is a
   *  seek to zero. Only offered on point/starred links, where that is what
   *  the viewer means; on a whole-match link it would rewind the match. */
  const replay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    if (autoMuted.current && v.muted) {
      v.muted = false;
      setMuted(false);
    }
    autoMuted.current = false;
    started.current = true;
    v.play().catch(() => setPaused(true));
  }, []);

  // Press-and-hold to change speed, same split as the match player: the
  // left half of the frame slows to 0.25x, the right half runs at 2x. This
  // is the one review control that needs no match data at all, so the
  // logged-out viewer — usually the coach the link was sent to — gets it.
  const hold = useRef<{
    timer: number | null;
    holding: boolean;
    prior: number;
    swallowClick: boolean;
  }>({ timer: null, holding: false, prior: 1, swallowClick: false });
  const [holdRate, setHoldRate] = useState<number | null>(null);

  const startHold = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rate = e.clientX - rect.left < rect.width / 2 ? 0.25 : 2;
    if (hold.current.timer) window.clearTimeout(hold.current.timer);
    hold.current.timer = window.setTimeout(() => {
      hold.current.timer = null;
      const v = videoRef.current;
      if (!v || v.paused) return; // holding a paused frame does nothing
      hold.current.holding = true;
      hold.current.prior = v.playbackRate;
      v.playbackRate = rate;
      setHoldRate(rate);
    }, 250);
  }, []);

  const endHold = useCallback(() => {
    const h = hold.current;
    if (h.timer) {
      window.clearTimeout(h.timer);
      h.timer = null;
    }
    if (!h.holding) return;
    h.holding = false;
    h.swallowClick = true; // a hold must not also toggle playback
    const v = videoRef.current;
    if (v) v.playbackRate = h.prior;
    setHoldRate(null);
  }, []);

  // ------------------------------------------------------------- takeover
  //
  // Watching is a takeover here too: the card on the page is the poster, and
  // playing fills the screen with black and the footage. Same element
  // throughout — only classes change — so entering and leaving never
  // interrupts playback or asks iOS for a fresh autoplay gesture.
  //
  // Browser Back leaves the takeover rather than the page: the history entry
  // pushed on entry is what the back gesture consumes.
  const [full, setFull] = useState(false);
  const fullRef = useRef(false);
  fullRef.current = full;

  const openFull = useCallback(() => {
    if (fullRef.current) return;
    window.history.pushState({ shareFull: true }, "");
    setFull(true);
  }, []);
  const exitFull = useCallback(() => {
    if (!fullRef.current) return;
    window.history.back(); // the popstate listener closes it
  }, []);

  useEffect(() => {
    if (!full) return;
    const onPop = () => {
      setFull(false);
      videoRef.current?.pause(); // back to the poster, not to a card playing
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitFull();
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
  }, [full, exitFull, togglePlay]);

  /** ±10s, the universal double-tap. Point-by-point navigation would need
   *  the match's rally boundaries, which a public link does not resolve. */
  const [seekFlash, setSeekFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const nudgeSeek = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    v.currentTime = Math.min(Math.max(0, v.currentTime + delta), d || 0);
    setPlayheadT(v.currentTime);
    setSeekFlash(delta < 0 ? "-10s" : "+10s");
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setSeekFlash(null), 600);
  }, []);

  // Single tap plays/pauses; a second tap inside 250ms is a seek instead.
  const tap = useRef<{ at: number; timer: number | null }>({
    at: 0,
    timer: null,
  });
  const onSurfaceClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (hold.current.swallowClick) {
        hold.current.swallowClick = false;
        return;
      }
      if (!fullRef.current) {
        openFull();
        const v = videoRef.current;
        if (v?.paused) togglePlay();
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const now = Date.now();
      if (now - tap.current.at < 250) {
        tap.current.at = 0;
        if (tap.current.timer) window.clearTimeout(tap.current.timer);
        tap.current.timer = null;
        const n = navRef.current;
        if (n) {
          // A sequence of clips: the same thirds the match player uses —
          // outer two walk the clips, the middle plays this one again.
          const zone = tapZone(x, rect.width);
          if (zone === "prev") n.onPrev();
          else if (zone === "next") n.onNext();
          else replay();
        } else {
          // One clip and nowhere to walk to, so the gesture stays what it
          // has always been here: a ten second nudge, on halves. Thirds
          // would only shrink the target for the thing it can actually do.
          nudgeSeek(x < rect.width / 2 ? -10 : 10);
        }
        return;
      }
      tap.current.at = now;
      if (tap.current.timer) window.clearTimeout(tap.current.timer);
      tap.current.timer = window.setTimeout(() => {
        tap.current.timer = null;
        togglePlay();
      }, 250);
    },
    [openFull, togglePlay, nudgeSeek, replay]
  );

  // ------------------------------------------------------------ scrub bar

  const scrubRef = useRef<HTMLDivElement | null>(null);
  const scrubbing = useRef(false);

  const scrubToClientX = useCallback(
    (clientX: number) => {
      const el = scrubRef.current;
      const v = videoRef.current;
      if (!el || !v || duration <= 0) return;
      const rect = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const t = frac * duration;
      setPlayheadT(t);
      if (v.readyState >= 1) v.currentTime = t;
    },
    [duration]
  );

  const onScrubDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Capture is best-effort; tap-to-seek still works without it.
      }
      scrubbing.current = true;
      scrubToClientX(e.clientX);
    },
    [scrubToClientX]
  );
  const onScrubMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!scrubbing.current) return;
      scrubToClientX(e.clientX);
    },
    [scrubToClientX]
  );
  const onScrubUp = useCallback(() => {
    scrubbing.current = false;
  }, []);

  const progressPct = duration > 0 ? (playheadT / duration) * 100 : 0;

  return (
    <div
      className={
        full
          ? "fixed inset-0 z-[80] flex flex-col bg-ink"
          : undefined
      }
      style={
        full ? { paddingBottom: "env(safe-area-inset-bottom)" } : undefined
      }
    >
      <div
        className={`relative select-none bg-black [-webkit-touch-callout:none] ${
          full ? "min-h-0 flex-1" : ""
        }`}
      >
        <video
          ref={videoRef}
          src={src}
          playsInline
          muted
          preload="metadata"
          // Press-and-hold here is our speed control, so the browser's own
          // long-press menu must not open on top of it (see Player.tsx).
          disablePictureInPicture
          controlsList="nodownload noplaybackrate noremoteplayback"
          onContextMenu={(e) => e.preventDefault()}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration || 0);
            // Nudge iOS into painting the first frame, so the card shows the
            // match rather than a black rectangle with a play button on it.
            if (e.currentTarget.currentTime === 0) {
              e.currentTarget.currentTime = 0.001;
            }
          }}
          onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
          onTimeUpdate={(e) => setPlayheadT(e.currentTarget.currentTime)}
          onSeeked={(e) => setPlayheadT(e.currentTarget.currentTime)}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onEnded={() => onEndedRef.current?.()}
          className={`w-full select-none bg-black [-webkit-touch-callout:none] ${
            full ? "h-full object-contain" : "max-h-[60vh]"
          }`}
        />

        {/* The surface: on the card it opens the takeover, in the takeover
            it plays/pauses, double-taps seek by ten seconds and a press
            and hold changes speed. Same three gestures as the match
            player, minus everything that needs the match's own data. */}
        <button
          type="button"
          onClick={onSurfaceClick}
          onPointerDown={startHold}
          onPointerUp={endHold}
          onPointerCancel={endHold}
          onPointerLeave={endHold}
          aria-label={full ? (paused ? "Play" : "Pause") : "Play full screen"}
          className="absolute inset-0 select-none [-webkit-touch-callout:none]"
          style={{ touchAction: "manipulation" }}
          onContextMenu={(e) => e.preventDefault()}
        />

        {/* takeover chrome: a way out, and the ±10s readout */}
        {full && (
          <button
            type="button"
            onClick={exitFull}
            aria-label="Close"
            className="absolute left-2 top-2 z-10 rounded-full border border-edge bg-ink/70 p-2 text-zinc-300 backdrop-blur transition-colors hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
        {seekFlash && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="ks-fade rounded-full bg-ink/70 px-4 py-2 text-sm font-semibold tabular-nums text-white backdrop-blur-sm">
              {seekFlash}
            </span>
          </div>
        )}

        {/* Where you are in a starred sequence, and the two taps that move
            you. In the takeover this replaces the counter under the card —
            the same information, in the place you are actually looking. */}
        {full && nav && nav.total > 1 && (
          <>
            <span className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-full border border-edge bg-ink/70 px-3 py-1 text-[11px] font-semibold tabular-nums text-zinc-300 backdrop-blur">
              {nav.index + 1} / {nav.total}
            </span>
            {nav.index > 0 && (
              <button
                type="button"
                onClick={nav.onPrev}
                aria-label="Previous clip"
                className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-ink/60 text-zinc-200 backdrop-blur-sm transition-colors hover:text-white"
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
                    d="m15 6-6 6 6 6"
                  />
                </svg>
              </button>
            )}
            {nav.index < nav.total - 1 && (
              <button
                type="button"
                onClick={nav.onNext}
                aria-label="Next clip"
                className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-ink/60 text-zinc-200 backdrop-blur-sm transition-colors hover:text-white"
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
                    d="m9 6 6 6-6 6"
                  />
                </svg>
              </button>
            )}
          </>
        )}

        {/* The one piece of marketing in the takeover: the same mark the
            exported reels carry, bottom-right, quiet enough to ignore and
            tappable if the footage did the persuading. A banner here would
            be worse for acquisition than this is — people close banners and
            they do not come back. */}
        {full && (
          <Link
            href="/?from=share"
            className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full bg-ink/50 px-2.5 py-1 text-[11px] font-semibold text-zinc-400/90 backdrop-blur-sm transition-colors hover:bg-ink/80 hover:text-white"
          >
            <span className="block h-3 w-3 rounded-full border-[1.5px] border-cyan-glow/80" />
            PongLens
          </Link>
        )}

        {/* held-speed readout, same pill as the match player */}
        {holdRate !== null && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <span className="ks-fade rounded-full border border-edge bg-ink/85 px-3 py-1 text-xs font-semibold tabular-nums text-zinc-200 backdrop-blur">
              {holdRate}x {holdRate < 1 ? "◀▶" : "▶▶"}
            </span>
          </div>
        )}

        {/* Replay: the whole reason someone opens a shared point is to
            watch it again, and hunting for the start of a 6-second clip on
            a thin scrub bar is the wrong way to ask for that. */}
        {showReplay && (
          <button
            type="button"
            onClick={replay}
            aria-label="Replay"
            className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-full border border-white/15 bg-ink/60 px-3 py-1.5 text-xs font-semibold text-zinc-200 backdrop-blur-sm transition-colors hover:bg-ink/80 hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20.5 12a8.5 8.5 0 1 1-2.9-6.4" />
              <path d="M18.6 2.4v3.4h-3.4" />
            </svg>
            Replay
          </button>
        )}

        {/* paused glyph — same pattern as the app's Player */}
        {paused && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="ks-fade rounded-full bg-ink/60 p-4 backdrop-blur-sm">
              <svg
                viewBox="0 0 24 24"
                className="h-8 w-8 text-white"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5.5v13l11-6.5-11-6.5Z" />
              </svg>
            </span>
          </div>
        )}
      </div>

      {/* transport row: time · scrub · time · mute */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">
          {formatTime(playheadT)}
        </span>
        <div
          ref={scrubRef}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(playheadT)}
          className="relative flex h-8 min-w-0 flex-1 cursor-pointer items-center"
          style={{ touchAction: "none" }}
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
        >
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/15">
            <span
              className="absolute inset-y-0 left-0 bg-cyan-glow"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span
            className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 rounded-full bg-cyan-glow shadow-[0_0_8px_rgba(34,211,238,0.7)]"
            style={{ left: `${progressPct}%` }}
          />
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">
          {formatTime(duration)}
        </span>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          aria-pressed={muted}
          className="shrink-0 rounded-full p-1.5 text-zinc-300 transition-colors hover:text-white"
        >
          {muted ? (
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11 5 6.5 9H3v6h3.5L11 19V5ZM16 9.5l5 5M21 9.5l-5 5"
              />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11 5 6.5 9H3v6h3.5L11 19V5ZM15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"
              />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
