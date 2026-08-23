"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClipPlayer, type PictureBox } from "@/app/match/[id]/ClipPlayer";

/**
 * The public player: the app's own ClipPlayer, inside a full-screen
 * takeover.
 *
 * It used to be a hand-rolled minimal player, and the gap showed. A coach
 * opening a shared match got halves-and-ten-seconds where the app gives
 * thirds-and-rallies, no pinch zoom on footage shot from across a hall,
 * no speed menu, and — because the score bug was a SIBLING of the player
 * rather than part of it — no score at all the moment the takeover went
 * full screen and left the bug behind underneath.
 *
 * So the player is the same component the match page, the point sheet and
 * the coach workspace use. Everything it can do without match data, the
 * public page now does too: pinch to zoom, hold either half for speed,
 * double-tap the outer thirds to walk rallies and the middle to replay.
 * What is left here is only the shell — takeover, exit, and where a
 * sequence tells you where you are.
 *
 * ONE video element throughout. Entering and leaving the takeover changes
 * classes, never the tree, so playback is never interrupted and iOS is
 * never asked for a fresh autoplay gesture. The takeover opens off the
 * element's own `play` event, which fires inside the tap that started it.
 *
 * Browser Back leaves the takeover rather than the page: the history entry
 * pushed on entry is what the back gesture consumes.
 */
export function SharePlayer({
  src,
  kind,
  videoElRef: externalRef,
  onEnded,
  onTime,
  onReplay,
  onStepPoint,
  overlay,
  nav,
}: {
  src: string;
  /** The element, for a host that needs to seek — rally navigation on a
   *  match link is the caller's job, because only it knows where the
   *  rallies are. */
  videoElRef?: React.MutableRefObject<HTMLVideoElement | null>;
  /** A whole match starts paused and plays straight through; a rally is a
   *  clip, and clips behave like clips (see ClipPlayer's two modes). */
  kind: "match" | "clip";
  /** StarredView's auto-advance hook; single videos just stop. */
  onEnded?: () => void;
  /** Every playhead move, so a host can draw something that tracks it —
   *  the score bug is the only caller. */
  onTime?: (seconds: number) => void;
  /** Restart whatever the host considers "this point". Only the host
   *  knows where a rally begins in a cut video. */
  onReplay?: () => void;
  /** Walk to the neighbouring rally. Given this, the double tap navigates
   *  POINTS in thirds instead of nudging ten seconds. */
  onStepPoint?: (delta: -1 | 1) => void;
  /** Drawn over the picture in both states — the score bug. Handed the
   *  picture's measured box, because that is what it sizes AND places
   *  itself from. */
  overlay?: (picture: PictureBox) => React.ReactNode;
  /**
   * A sequence of clips (a starred or tag link): where you are, and the
   * two chevrons that move you.
   */
  nav?: {
    index: number;
    total: number;
    onPrev: () => void;
    onNext: () => void;
  };
}) {
  const ownRef = useRef<HTMLVideoElement | null>(null);
  const videoElRef = externalRef ?? ownRef;
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

  // Playing IS the request to watch it properly. Listening on the element
  // rather than taking a callback keeps ClipPlayer unaware there is a
  // takeover at all, and puts the takeover on the same tap that called
  // play() — no second gesture, no autoplay prompt.
  useEffect(() => {
    const v = videoElRef.current;
    if (!v) return;
    const onPlay = () => openFull();
    v.addEventListener("play", onPlay);
    return () => v.removeEventListener("play", onPlay);
  }, [openFull, src, videoElRef]);

  useEffect(() => {
    if (!full) return;
    const onPop = () => {
      setFull(false);
      videoElRef.current?.pause(); // back to the poster, not a card playing
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitFull();
      if (e.key === " ") {
        e.preventDefault();
        const v = videoElRef.current;
        if (!v) return;
        if (v.paused) void v.play().catch(() => {});
        else v.pause();
      }
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
  }, [full, exitFull, videoElRef]);

  // A <video> removed from the document keeps playing, with sound.
  useEffect(() => {
    const v = videoElRef.current;
    return () => v?.pause();
  }, [videoElRef]);

  return (
    <div
      className={full ? "fixed inset-0 z-[80] flex flex-col bg-ink" : undefined}
      style={
        full ? { paddingBottom: "env(safe-area-inset-bottom)" } : undefined
      }
    >
      <div className={full ? "relative min-h-0 flex-1" : "relative"}>
        <ClipPlayer
          key="share"
          src={src}
          mode={kind === "match" ? "cut" : "clip"}
          // Nothing plays until the viewer says so. A video that starts on
          // its own in a card is a video you watch in a card, which is not
          // the experience this page is handing people. Later src changes
          // in a sequence DO autoplay — that is the auto-advance.
          startPaused
          fill={full}
          // Nobody annotates a frame on a public page, and R2's presigned
          // URLs answer a CORS request with nothing — asking would fail
          // every load and reload for a capability this page lacks.
          readPixels={false}
          // A shared match is watched, not skimmed, and usually on a
          // phone held in one hand. Landscape is the whole point.
          //
          // Tied to the takeover, not left permanently on: the rotated
          // mode is component state, so a takeover that closed while
          // rotated would leave the card lying on its side. Turning this
          // off unwinds both flavours.
          landscape={full}
          // The way out lives inside the player. Chrome drawn out here is
          // covered by the rotated landscape box, and an exit you cannot
          // reach sideways is not an exit.
          onClose={full ? exitFull : undefined}
          tall
          videoElRef={videoElRef}
          overlay={overlay}
          onEnded={onEnded}
          onReplay={onReplay}
          onStepPoint={onStepPoint}
          onTime={(el) => onTime?.(el.currentTime)}
        />

        {/* Where you are in a sequence. The arrows that move you are the
            player's own now — they have to turn with the rotated
            landscape box, and chrome drawn out here does not. */}
        {full && nav && nav.total > 1 && (
          <span className="pointer-events-none absolute inset-x-0 top-3 z-10 mx-auto w-fit rounded-full border border-edge bg-ink/70 px-3 py-1 text-[11px] font-semibold tabular-nums text-zinc-300 backdrop-blur">
            {nav.index + 1} / {nav.total}
          </span>
        )}

        {/* The one piece of marketing in the takeover: the same mark the
            exported reels carry, quiet enough to ignore and tappable if
            the footage did the persuading. Bottom-LEFT, above the
            transport: every other spot on this picture now holds a
            control — ? top-left, mute and close top-right, the arrows on
            the sides, speed and zoom bottom-right, and the score bug sits
            inside the frame rather than at the screen's edge. */}
        {full && (
          <Link
            href="/?from=share"
            className="absolute bottom-14 left-3 z-10 flex w-fit items-center gap-1.5 rounded-full bg-ink/50 px-2.5 py-1 text-[11px] font-semibold text-zinc-400/90 backdrop-blur-sm transition-colors hover:bg-ink/80 hover:text-white"
          >
            <span className="block h-3 w-3 rounded-full border-[1.5px] border-cyan-glow/80" />
            PongLens
          </Link>
        )}
      </div>
    </div>
  );
}
