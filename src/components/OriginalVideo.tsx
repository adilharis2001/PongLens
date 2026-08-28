"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClipPlayer } from "@/app/match/[id]/ClipPlayer";

/**
 * "Original" — watch the file the player uploaded, uncut.
 *
 * Every match page shows the CUT: the same footage with the dead time
 * taken out. When the cut comes out poor — a rally clipped short, a point
 * dropped — the only honest answer is the original, and until now the only
 * way to reach it was to download it from the Export sheet.
 *
 * WHY IT IS A PILL BESIDE THE VIDEO, not a row in Tools. Tools is
 * owner-only on both platforms, and says so in a comment on each
 * (MatchView "Coach viewers never see it", MatchDetailScreen the same). A
 * coach reviewing a bad cut wants the original for exactly the reason the
 * player does, so the control has to live somewhere both of them see. The
 * video card is the only such container.
 *
 * THE FILE IS ALWAYS THERE, for anything uploaded since the commerce flip
 * in mid-August 2026. r2_raw_sweep skips any object a live library row
 * points at (worker.py, "a raw referenced by a live library row is the
 * user's stored video — it never ages out"), nothing on the success path
 * clears matches.raw_path, and the Privacy Policy already promises it.
 * The original is 61% of what the owner pays to store and was the only
 * part they could not watch.
 *
 * The URL is minted ON TAP, not on page load: it is a six-hour presigned
 * GET, and signing one for every viewer of every match — most of whom
 * never press this — buys nothing and costs an R2 round trip on the
 * critical path.
 */

export function OriginalVideoButton({
  matchId,
  variant = "pill",
  className = "",
}: {
  matchId: string;
  /** "pill": a bordered pill, for a row of controls beside a caption.
   *  "overlay": a compact translucent chip drawn ON the picture, for the
   *  coach workspace where there is no caption row to sit in. */
  variant?: "pill" | "overlay";
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  /** What the takeover is showing: the video, or why there isn't one.
   *  A failure opens the takeover rather than writing a line into the
   *  card — the row this pill sits in has a caption and a download button
   *  already and no room for a sentence, and the full-screen surface is
   *  where someone who just pressed "Original" is looking. */
  const [view, setView] = useState<
    { kind: "video"; src: string } | { kind: "message"; text: string } | null
  >(null);

  const open = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/media-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchId, rawPreview: true }),
      });
      const data = res.ok ? await res.json() : null;
      // available:false is the honest answer for an upload the retention
      // sweep took before a library row protected it — rare, and only on
      // matches processed before mid-August 2026.
      setView(
        data?.url
          ? { kind: "video", src: String(data.url) }
          : { kind: "message", text: "The original is no longer available." }
      );
    } catch {
      setView({
        kind: "message",
        text: "Couldn't open the original. Check your connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  }, [busy, matchId]);

  const label = busy ? "Opening…" : "Original";

  return (
    <>
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        title="Watch the original upload, uncut"
        className={
          (variant === "overlay"
            ? "inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-ink/70 px-3 py-1.5 text-xs font-semibold text-zinc-100 backdrop-blur transition-colors hover:border-cyan-glow/60 hover:text-white disabled:opacity-60"
            : "inline-flex items-center gap-1.5 rounded-full border border-edge px-3.5 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-60") +
          (className ? ` ${className}` : "")
        }
      >
        <svg
          viewBox="0 0 24 24"
          className={variant === "overlay" ? "h-3.5 w-3.5" : "h-4 w-4"}
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.2-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5Z" />
        </svg>
        {label}
      </button>

      {view && (
        <OriginalTakeover view={view} onClose={() => setView(null)} />
      )}
    </>
  );
}

/**
 * The original, full screen. Portaled to <body> because several of the
 * hosts animate with a transform (the point sheet, AppShell's entry) and
 * a transformed ancestor makes `fixed` resolve against IT rather than the
 * viewport — the trap that once gave a "full screen" the size of a column.
 *
 * ClipPlayer in cut mode is the same player an unprocessed match uses, so
 * the gestures, the zoom, the speed hold and the landscape expand are the
 * ones the app already has rather than an imitation. Its own close button
 * is the only way out on purpose: chrome drawn OUTSIDE the player is
 * covered by the rotated box in landscape.
 */
function OriginalTakeover({
  view,
  onClose,
}: {
  view: { kind: "video"; src: string } | { kind: "message"; text: string };
  onClose: () => void;
}) {
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const [undecodable, setUndecodable] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // A <video> removed from the document keeps playing, with sound. Pause
  // on the way out, every time — this codebase has paid for that one.
  useEffect(
    () => () => {
      videoElRef.current?.pause();
    },
    []
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-ink"
      role="dialog"
      aria-modal="true"
      aria-label="Original video"
    >
      <div className="flex shrink-0 items-baseline gap-2 px-4 pb-2 pt-3">
        <p className="text-sm font-semibold text-zinc-100">Original video</p>
        <p className="text-xs text-zinc-500">As uploaded</p>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center">
        {view.kind === "message" ? (
          <DeadEnd onClose={onClose}>
            <p className="text-sm text-zinc-300">{view.text}</p>
          </DeadEnd>
        ) : undecodable ? (
          /* A phone records HEVC in a .mov and plenty of desktop browsers
             will not decode it — 43 of the 98 originals we hold are HEVC,
             AV1 or VP9. Say the dead end out loud: a custom player would
             otherwise show a black rectangle. The unprocessed view's
             version of this message ends "watch it on your phone", which
             is no use here, where a working cut is one tap away. */
          <DeadEnd onClose={onClose}>
            <p className="text-sm text-zinc-300">
              This browser can&apos;t play this file.
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-500">
              Phones record in a format some desktop browsers don&apos;t
              support. The cut video plays everywhere, and you can download
              the original from Export.
            </p>
          </DeadEnd>
        ) : (
          <ClipPlayer
            src={view.src}
            mode="cut"
            fill
            landscape
            // Nothing here reads the frame's pixels, and R2's presigned
            // URLs answer a CORS request with nothing — asking costs a
            // failed request and a reload on every open.
            readPixels={false}
            videoElRef={videoElRef}
            onClose={onClose}
            onMediaError={() => setUndecodable(true)}
          />
        )}
      </div>
    </div>,
    document.body
  );
}

/** No picture to show, and a way out. The close is a real pill rather
 *  than grey text: with no player mounted, ClipPlayer's own close button
 *  is not there to fall back on. */
function DeadEnd({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="px-8 text-center">
      {children}
      <button
        type="button"
        onClick={onClose}
        className="mt-5 rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-200 transition-colors hover:border-zinc-500"
      >
        Close
      </button>
    </div>
  );
}
