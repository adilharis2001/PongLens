"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * CameraGuide — a single, dismissible "how to record" affordance.
 *
 * Renders one small tappable trigger. Tapping it opens a sheet (a bottom
 * sheet on mobile, a centered card on larger screens) with a top-down diagram
 * of the ideal camera position: diagonally behind the player and raised a
 * little, wide enough that the ball is clearly seen landing on BOTH halves of
 * the table, with neither player blocking the view.
 *
 * The guidance is identical for a file upload and a YouTube import, so it
 * lives once at the page level and covers both. Dismiss by tapping the
 * backdrop, the close button, "Got it", or pressing Escape.
 *
 * The gentle ball rally is a CSS animation (`cam-rally`); the sheet's entrance
 * is `cg-sheet`. The global prefers-reduced-motion rule tames both.
 */
export function CameraGuide({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Only pull focus back to the trigger after a real close — never on the
  // initial mount (that lit up a focus ring on page load).
  const openedOnce = useRef(false);

  const close = useCallback(() => setOpen(false), []);

  // While open: Escape to close, lock body scroll, move focus into the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    openedOnce.current = true;
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Restore focus to the trigger after the sheet closes — but not on the
  // first mount, when it was never opened.
  useEffect(() => {
    if (!open && openedOnce.current) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  return (
    <div className={className}>
      {/* Quiet inline affordance — a hint, not a button competing with
          Upload. The orientation line is the one thing worth saying up
          front (it's the biggest accuracy lever); the rest lives in the
          sheet. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="group inline-flex items-center gap-1.5 rounded-full text-xs text-zinc-500 outline-none transition-colors hover:text-zinc-300 focus-visible:text-zinc-300"
      >
        <CameraIcon className="h-3.5 w-3.5 shrink-0 text-cyan-glow/70" />
        <span className="underline decoration-zinc-600 underline-offset-2 group-hover:decoration-cyan-glow/50">
          How to record
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
        >
          <div
            className="cg-overlay absolute inset-0 bg-ink/70 backdrop-blur-sm"
            onClick={close}
            aria-hidden="true"
          />

          <div className="cg-sheet relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-edge bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 sm:max-w-md sm:rounded-2xl sm:pt-5">
            {/* Grab handle — reads as a bottom sheet on mobile */}
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-edge sm:hidden" />

            <div className="flex items-start justify-between gap-4">
              <h2
                id={titleId}
                className="flex items-center gap-2 text-base font-semibold text-zinc-100"
              >
                <CameraIcon className="h-4 w-4 shrink-0 text-cyan-glow" />
                Where to put the camera
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                aria-label="Close"
                className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-surface-2 hover:text-white"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 6l12 12M18 6L6 18"
                  />
                </svg>
              </button>
            </div>

            <TableDiagram />

            <ul className="mt-5 space-y-3">
              {[
                "Diagonally behind you, raised a little",
                "The whole table in frame — the ball lands clearly on both sides",
                "Neither player blocking the table",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-sm text-zinc-300">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-cyan-glow" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            {/* Orientation is the single biggest accuracy lever — call it
                out on its own, with the honest caveat. */}
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-edge bg-surface-2/40 p-3.5">
              <LandscapePhoneIcon className="mt-0.5 h-5 w-5 shrink-0 text-cyan-glow" />
              <p className="text-sm text-zinc-300">
                Hold your phone <span className="font-semibold text-zinc-100">landscape</span> (sideways).
                Vertical video still works, but accuracy drops.
              </p>
            </div>

            <button
              type="button"
              onClick={close}
              className="glow-cta mt-5 w-full rounded-full bg-cyan-glow py-3 text-sm font-semibold text-ink"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TableDiagram() {
  return (
    <svg
      viewBox="0 0 320 300"
      role="img"
      aria-label="Top-down view of a table-tennis table. The camera sits diagonally behind you and its view sweeps across the whole table, clearly seeing the ball land on both sides while neither player blocks the table."
      className="mx-auto mt-4 block w-full max-w-[320px]"
    >
      <defs>
        <linearGradient
          id="cg-cone"
          x1="48"
          y1="252"
          x2="220"
          y2="60"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#22d3ee" stopOpacity="0.32" />
          <stop offset="1" stopColor="#22d3ee" stopOpacity="0.04" />
        </linearGradient>
        <radialGradient id="cg-ball" cx="35%" cy="30%" r="70%">
          <stop offset="0" stopColor="#ffedd5" />
          <stop offset="0.4" stopColor="#fdba74" />
          <stop offset="0.75" stopColor="#f97316" />
          <stop offset="1" stopColor="#c2410c" />
        </radialGradient>
      </defs>

      {/* Camera field of view — a soft wedge that washes over the whole table */}
      <polygon points="48,252 88,26 232,30 288,238" fill="url(#cg-cone)" />
      {/* Sightlines to the two far corners: the camera clearly sees both sides */}
      <line x1="48" y1="252" x2="106" y2="44" stroke="#22d3ee" strokeWidth="1.2" strokeOpacity="0.55" strokeDasharray="4 4" />
      <line x1="48" y1="252" x2="214" y2="44" stroke="#22d3ee" strokeWidth="1.2" strokeOpacity="0.55" strokeDasharray="4 4" />

      {/* Table — top-down, long axis vertical. Two halves, one on each side of
          the net, are the "both sides" the camera must see. */}
      <rect x="106" y="44" width="108" height="176" rx="4" fill="#0f2b30" stroke="#22d3ee" strokeWidth="2" strokeOpacity="0.9" />
      <rect x="106" y="44" width="108" height="88" fill="#22d3ee" fillOpacity="0.05" />
      <rect x="106" y="132" width="108" height="88" fill="#22d3ee" fillOpacity="0.05" />
      {/* Center (doubles) line down the length */}
      <line x1="160" y1="44" x2="160" y2="220" stroke="#e5f9fd" strokeWidth="1" strokeOpacity="0.5" strokeDasharray="3 5" />
      {/* Net across the middle, with a little overhang each side */}
      <line x1="96" y1="132" x2="224" y2="132" stroke="#e879f9" strokeWidth="2.5" strokeOpacity="0.85" />

      {/* Bounce marks — where the ball lands on each side */}
      <circle cx="138" cy="88" r="3" fill="#f97316" fillOpacity="0.35" />
      <circle cx="182" cy="176" r="3" fill="#f97316" fillOpacity="0.35" />

      {/* The rallying ball (gentle CSS bounce between the two halves) */}
      <g className="cam-rally" style={{ transformOrigin: "center" }}>
        <circle cx="182" cy="176" r="5.5" fill="url(#cg-ball)" />
      </g>

      {/* Opponent — clear of the far end, not covering the table */}
      <circle cx="160" cy="24" r="8" fill="#1b1b26" stroke="#52525b" strokeWidth="1.5" />
      <text x="160" y="12" textAnchor="middle" fontSize="9" fill="#a1a1aa">
        Opponent
      </text>

      {/* You — clear of the near end, not covering the table */}
      <circle cx="160" cy="248" r="8" fill="#1b1b26" stroke="#71717a" strokeWidth="1.5" />
      <text x="160" y="272" textAnchor="middle" fontSize="9" fill="#d4d4d8">
        You
      </text>

      {/* Camera — diagonally behind you, off to one side */}
      <rect x="30" y="256" width="26" height="17" rx="3" fill="#22d3ee" />
      <path d="M56 261 l9 -4 v13 l-9 -4 Z" fill="#22d3ee" />
      <circle cx="41" cy="264.5" r="4" fill="#0a0a0f" />
      <circle cx="41" cy="264.5" r="1.6" fill="#22d3ee" />
      <text x="34" y="290" textAnchor="middle" fontSize="9" fill="#67e8f9">
        Camera
      </text>
    </svg>
  );
}

function CameraIcon({ className = "" }: { className?: string }) {
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
        d="M4 8.5A1.5 1.5 0 0 1 5.5 7h1.7l1-1.5h3.6l1 1.5h1.7A1.5 1.5 0 0 1 17 8.5v.4l3-1.6v9.4l-3-1.6v.4A1.5 1.5 0 0 1 15.5 16h-10A1.5 1.5 0 0 1 4 14.5v-6Z"
      />
    </svg>
  );
}

function LandscapePhoneIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <rect x="2.5" y="6.5" width="19" height="11" rx="2" />
      <line x1="6" y1="6.5" x2="6" y2="17.5" />
    </svg>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
    </svg>
  );
}
