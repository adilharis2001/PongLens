"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * CameraGuide — a single, dismissible "how to record" affordance.
 *
 * Renders one small tappable trigger. Tapping it opens a sheet (a bottom
 * sheet on mobile, a centered card on larger screens) with a top-down diagram
 * of the ideal camera position: to the SIDE of the table, level with the
 * player's half and raised to about head height, wide enough that the ball is
 * clearly seen landing on BOTH halves, with neither player in the way.
 *
 * It used to say "diagonally behind you", which was the position the pipeline
 * likes least: from behind, the near player stands between the lens and their
 * own half, so the bounces that decide a point are hidden exactly when they
 * matter. Side-on is also what the iOS recorder's table overlay draws, so the
 * two were contradicting each other until 2026-08-24.
 *
 * Which side is not arbitrary either. Put the camera on the side you do not
 * serve from: a right-hander serving pendulum stands near their backhand
 * corner, and a camera on that side spends every serve looking at their back.
 *
 * The guidance is identical for a file upload and a YouTube import, so it
 * lives once at the page level and covers both. Dismiss by tapping the
 * backdrop, the close button, "Got it", or pressing Escape.
 *
 * The gentle ball rally is a CSS animation (`cam-rally`); the sheet's entrance
 * is `cg-sheet`. The global prefers-reduced-motion rule tames both.
 */
export function CameraGuide({
  className = "",
  variant = "link",
}: {
  className?: string;
  /**
   * "link" — the quiet inline hint, for a page header.
   * "row"  — a full-width labelled row that cannot be missed.
   *
   * Where the camera goes is the single biggest thing deciding whether the
   * pipeline finds any points at all, and as a 97x16px grey link in a
   * corner it was reliably never opened. The row exists so a first upload
   * meets it on the way past.
   */
  variant?: "link" | "row";
}) {
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
      {variant === "row" ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          className="group flex w-full items-center gap-3 rounded-xl border border-edge bg-surface-2/40 px-4 py-3.5 text-left transition-colors hover:border-cyan-glow/50"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-glow/10 text-cyan-glow">
            <CameraIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1 text-sm font-semibold text-zinc-100">
            Where to place the camera
          </span>
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 shrink-0 text-zinc-600 transition-colors group-hover:text-cyan-glow"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
          </svg>
        </button>
      ) : (
      /* Quiet inline affordance — a hint, not a button competing with
         Upload. The orientation line is the one thing worth saying up
         front (it's the biggest accuracy lever); the rest lives in the
         sheet. */
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
      )}

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
                Where to place the camera
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
                "To the side of the table, level with your half, raised to about head height.",
                "On the side you do not serve from. A right-hander serving pendulum stands near their backhand corner, so the camera goes on the forehand side.",
                "The whole table in frame, with the ball clearly visible where it lands on both halves.",
                "Neither player standing between the camera and the table, on either half.",
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

            <RealSetups />

            {/* The iPhone app can show this instead of describing it: the
                recorder draws the table in perspective from the position
                these rules describe, so lining the real one up with it
                settles the placement before a single point is played. */}
            <div className="mt-3 flex items-start gap-3 rounded-xl border border-edge bg-surface-2/40 p-3.5">
              <ViewfinderIcon className="mt-0.5 h-5 w-5 shrink-0 text-cyan-glow" />
              <p className="text-sm text-zinc-300">
                Filming on an iPhone? Record a match in the PongLens app and the
                camera screen draws the table where it should sit, so you can line
                the real one up with it before you start.
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

/**
 * The three stills are not chosen by eye. Every hand-corrected quad in
 * table_calibration_review pins down the camera that filmed it, so the
 * whole corpus was reduced to a pose (metres behind the near end, metres
 * to the side, height above the table) and these are the closest each
 * venue gets to the placement the rules above describe. The caption states
 * that pose, because "about here" is worth much less than a number a
 * player can pace out.
 *
 * Closed by default. Someone who already knows where to stand should not
 * have to scroll past three photographs to reach "Got it", and the diagram
 * carries the rule on its own.
 *
 * Faces are blurred, including bystanders at the back of the hall, and so
 * is the booking name on the venue screens.
 */
const SETUPS = [
  {
    src: "/camera/camera-ref-1.jpg",
    caption: "2.7 m to the side, level with the near end, 0.9 m above the table.",
  },
  {
    src: "/camera/camera-ref-2.jpg",
    caption: "2.8 m to the side, just past the near end, 1.0 m up.",
  },
  {
    src: "/camera/camera-ref-3.jpg",
    caption: "2.1 m to the side and a little further back. A busy hall, and the table is still clear.",
  },
];

function RealSetups() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl border border-edge bg-surface-2/40 px-3.5 py-3 text-left text-sm text-zinc-300 transition-colors hover:border-cyan-glow/50"
      >
        <span className="flex-1 font-medium text-zinc-100">
          Real setups that worked
        </span>
        <span className="text-xs text-zinc-500">3 photos</span>
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
        </svg>
      </button>

      {open && (
        <ul className="mt-3 space-y-3">
          {SETUPS.map((s) => (
            <li key={s.src}>
              <figure className="overflow-hidden rounded-xl border border-edge bg-ink">
                {/* Plain img, not next/image: these are fixed local stills
                    inside a sheet that is usually never opened, so the
                    optimiser earns nothing and lazy loading is the only
                    thing that matters. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={s.src}
                  alt="A table tennis table filmed from the side, both players clear of it"
                  loading="lazy"
                  width={1280}
                  height={720}
                  className="block w-full"
                />
                <figcaption className="px-3 py-2.5 text-xs leading-relaxed text-zinc-400">
                  {s.caption}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TableDiagram() {
  return (
    <svg
      viewBox="0 0 320 300"
      role="img"
      aria-label="Top-down view of a table-tennis table. The camera sits to one side, level with your half and on the side you do not serve from, and its view sweeps across the whole table so the ball is visible landing on both halves with neither player in the way."
      className="mx-auto mt-4 block w-full max-w-[320px]"
    >
      <defs>
        <linearGradient
          id="cg-cone"
          x1="266"
          y1="190"
          x2="90"
          y2="120"
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

      {/* Camera field of view. The apex is at the lens, off to the side and
          level with the near half; the wedge runs past the far edge of the
          table and is clipped by the viewBox, so it reads as a view rather
          than as a triangle propped on two corners. */}
      <polygon points="266,190 81,-381 -243,508" fill="url(#cg-cone)" />
      {/* Sightlines along the edges of that cone. They run to the corners on
          the CAMERA's side, which are the angular extremes from here — the
          far corners sit inside that span. Drawing them to the far corners
          instead put two lines across the table in an X. */}
      <line x1="266" y1="190" x2="214" y2="44" stroke="#22d3ee" strokeWidth="1.2" strokeOpacity="0.55" strokeDasharray="4 4" />
      <line x1="266" y1="190" x2="214" y2="220" stroke="#22d3ee" strokeWidth="1.2" strokeOpacity="0.55" strokeDasharray="4 4" />

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

      {/* You — at the backhand corner, where a right-hander serving pendulum
          stands. Drawn deliberately on the opposite side from the camera:
          that is the whole point of the second rule. */}
      <circle cx="134" cy="248" r="8" fill="#1b1b26" stroke="#71717a" strokeWidth="1.5" />
      <text x="134" y="272" textAnchor="middle" fontSize="9" fill="#d4d4d8">
        You
      </text>

      {/* Camera — to the side, level with the near half, lens facing back
          across the table */}
      <rect x="266" y="182" width="26" height="17" rx="3" fill="#22d3ee" />
      <path d="M266 187 l-9 -4 v13 l9 -4 Z" fill="#22d3ee" />
      <circle cx="281" cy="190.5" r="4" fill="#0a0a0f" />
      <circle cx="281" cy="190.5" r="1.6" fill="#22d3ee" />
      <text x="277" y="216" textAnchor="middle" fontSize="9" fill="#67e8f9">
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
