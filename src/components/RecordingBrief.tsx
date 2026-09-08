"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * RecordingBrief — five pages a new account steps through once, before its
 * first recording or upload.
 *
 * One picture and one idea per page: where to stand, what to frame, what
 * to stand the phone on, the one mistake that hides the ball, then what to
 * expect from processing. It replaced the automatic showing of the "Where
 * to place the camera" sheet, which is one tall scroll that people swiped
 * away. Each Next is a small commitment to the next idea, which is what
 * makes five short pages get read where one long sheet did not.
 *
 * There is no way out except through: no close button, no tap outside, no
 * Escape. Back is always there, and on a touchscreen a swipe moves between
 * pages. The last page's button is the only exit and it continues to
 * wherever the tap was going. RecordingBriefFirstRun decides whether this
 * opens at all and counts it as seen only when that button is tapped, so
 * quitting halfway brings it back from page one.
 *
 * The pictures are the SVGs in public/brief/, drawn in the app's own
 * palette. iOS shows the same files exported to PNG (scripts/brief/), so
 * the two platforms cannot drift apart on what a page looks like. The
 * words are written twice, here and in RecordingBriefSheet.swift, the
 * same way the sheet's are.
 *
 * Rendered through a portal: the Upload page's shell holds a transform for
 * the 200ms of its entry animation, and a `position: fixed` child of that
 * shell is sized to the shell's column for exactly as long as this dialog
 * is opening.
 */

export type RecordingBriefContext = "record" | "upload" | "web";

type Page = {
  src: string;
  alt: string;
  title: string;
  body: string;
  /** A line under the body that only some doors get. */
  note?: Partial<Record<RecordingBriefContext, string>>;
};

export const RECORDING_BRIEF_PAGES: Page[] = [
  {
    src: "/brief/p1.svg",
    alt: "Seen from above: the camera stands to one side of the table, level with your half, and its view takes in the whole table.",
    title: "Put the camera to the side",
    body: "Side-on to the table, level with your half, and raised to about head height. Choose the side you do not serve from, so you are never standing between the camera and the table when a point starts. For most right-handers that is the forehand side.",
    note: {
      record:
        "The next screen draws the table where it should sit. Line the real one up with it before you start.",
    },
  },
  {
    src: "/brief/p2.svg",
    alt: "A phone held sideways. On its screen the whole table sits inside the frame with room to spare.",
    title: "Keep the whole table in frame",
    body: "Film landscape, with every corner of the table in the picture and both halves clearly visible. If there are other tables nearby, angle the camera so they stay out of the frame where you can.",
  },
  {
    src: "/brief/p3.svg",
    alt: "A phone on a tripod beside the table, a little above table height. A hand-held phone is crossed out.",
    title: "Use a tripod",
    body: "Put the phone on a tripod or something that does not move, and leave it there for the whole match. A phone held in the hand moves, and when the picture moves PongLens loses track of where the table is.",
  },
  {
    src: "/brief/p4.svg",
    alt: "A camera placed behind the near player is crossed out: the player hides their half of the table. A camera at the side is ticked.",
    title: "Don’t film from behind a player",
    body: "From behind, the nearest player hides their half of the table, so the ball disappears exactly where it lands. Keep both players clear of the line between the camera and the table.",
  },
  {
    src: "/brief/p5.svg",
    alt: "A match timeline with the points PongLens found. One point is selected with a handle at each end.",
    title: "Processing is in beta",
    body: "PongLens finds and cuts each point automatically, and it is not perfect yet. A point can be missed, or a cut can start late or run long. You can fix any point from the match screen, and the model improves with every release. Most matches are ready within 30 minutes, and we email you when yours is.",
  },
];

/** The last page's button says where the tap was going. */
const FINAL_LABEL: Record<RecordingBriefContext, string> = {
  record: "Start recording",
  upload: "Choose a video",
  web: "Continue",
};

export function RecordingBrief({
  open,
  context = "web",
  onDone,
}: {
  open: boolean;
  context?: RecordingBriefContext;
  /** The last page's button. The only way out. */
  onDone: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const startX = useRef<number | null>(null);
  const last = RECORDING_BRIEF_PAGES.length - 1;

  useEffect(() => setMounted(true), []);

  // Always from page one. A brief that reopens on page three is a brief
  // that was never finished, and it should read that way.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // While open: lock the page behind, keep focus inside, arrows move.
  // Escape deliberately does nothing.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ctaRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setIndex((i) => Math.min(last, i + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Tab") {
        const root = dialogRef.current;
        if (!root) return;
        const items = Array.from(
          root.querySelectorAll<HTMLElement>("button:not([disabled]):not([hidden])"),
        ).filter((el) => el.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0];
        const lastItem = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !root.contains(active))) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && active === lastItem) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, last]);

  if (!open || !mounted) return null;

  const next = () => {
    if (index < last) setIndex(index + 1);
    else onDone();
  };
  const prev = () => setIndex((i) => Math.max(0, i - 1));

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
    >
      {/* No onClick: the backdrop is not a way out. */}
      <div className="cg-overlay absolute inset-0 bg-ink/70 backdrop-blur-sm" aria-hidden="true" />

      <div className="cg-sheet relative z-10 flex h-dvh w-full flex-col overflow-hidden bg-surface sm:h-auto sm:max-h-[92vh] sm:max-w-[480px] sm:rounded-2xl sm:border sm:border-edge">
        {/* Head: Back, the capsules from onboarding, and where you are. */}
        <div className="grid h-14 shrink-0 grid-cols-[72px_1fr_72px] items-center px-3 pt-[env(safe-area-inset-top)] sm:pt-0">
          <button
            type="button"
            onClick={prev}
            className={`inline-flex min-h-[44px] items-center gap-0.5 justify-self-start rounded-full py-2 pl-1 pr-2 text-[15px] text-zinc-400 transition-colors hover:text-white ${
              index === 0 ? "invisible" : ""
            }`}
            tabIndex={index === 0 ? -1 : 0}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-[18px] w-[18px]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
            </svg>
            Back
          </button>
          <div className="flex justify-center gap-1.5" aria-hidden="true">
            {RECORDING_BRIEF_PAGES.map((p, i) => (
              <span
                key={p.src}
                className={`block h-1 rounded-full transition-all duration-300 ${
                  i <= index ? "bg-cyan-glow" : "bg-edge"
                } ${i === index ? "w-[22px]" : "w-2"}`}
              />
            ))}
          </div>
          <span
            className="justify-self-end font-mono text-xs tabular-nums text-zinc-500"
            aria-live="polite"
          >
            {index + 1} of {RECORDING_BRIEF_PAGES.length}
          </span>
        </div>

        {/* Body: the five pages side by side, the track slides. Vertical
            scrolling stays free so a short window can still reach the
            text; horizontal swipes are ours. */}
        <div
          className="relative min-h-0 flex-1 overflow-hidden"
          style={{ touchAction: "pan-y" }}
          onPointerDown={(e) => {
            startX.current = e.clientX;
          }}
          onPointerUp={(e) => {
            if (startX.current === null) return;
            const dx = e.clientX - startX.current;
            startX.current = null;
            if (dx < -40) {
              if (index < last) setIndex(index + 1);
            } else if (dx > 40) {
              prev();
            }
          }}
          onPointerCancel={() => {
            startX.current = null;
          }}
        >
          <div
            className="flex h-full w-full transition-transform duration-300 ease-out"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {RECORDING_BRIEF_PAGES.map((p, i) => {
              const note = p.note?.[context];
              return (
                <div
                  key={p.src}
                  className="h-full w-full flex-none overflow-y-auto px-5 pb-3 pt-1"
                  aria-hidden={i !== index}
                >
                  <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl border border-edge bg-ink">
                    {/* Plain img: five fixed local drawings that are never
                        optimised further, and every page is in the DOM so
                        nothing loads on the way to it. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.src}
                      alt={p.alt}
                      width={320}
                      height={240}
                      draggable={false}
                      className="block h-full w-full select-none"
                    />
                  </div>
                  <h2
                    id={i === index ? titleId : undefined}
                    className="mt-[18px] text-[22px] font-semibold leading-tight tracking-tight text-zinc-100"
                  >
                    {p.title}
                  </h2>
                  <p className="mt-2 text-[15px] leading-relaxed text-zinc-300">{p.body}</p>
                  {note && (
                    <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-edge bg-surface-2/50 px-3 py-2.5 text-[13.5px] leading-snug text-zinc-300">
                      <ViewfinderIcon className="mt-px h-[18px] w-[18px] shrink-0 text-cyan-glow" />
                      <span>{note}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="shrink-0 border-t border-edge/60 px-5 pb-[max(1.375rem,env(safe-area-inset-bottom))] pt-3">
          <button
            ref={ctaRef}
            type="button"
            onClick={next}
            className="glow-cta min-h-[48px] w-full rounded-full bg-cyan-glow py-3 text-[15px] font-semibold text-ink"
          >
            {index === last ? FINAL_LABEL[context] : "Next"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ViewfinderIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"
      />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}
