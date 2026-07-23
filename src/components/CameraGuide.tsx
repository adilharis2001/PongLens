/**
 * CameraGuide — a top-down diagram that shows the ideal camera position for a
 * match recording: diagonally behind the player, raised a little, wide enough
 * that the ball is clearly visible landing on BOTH halves of the table, with
 * neither player blocking the view.
 *
 * Self-contained (no props required, no state). Rendered inline in the idle
 * state of both upload surfaces (file upload + YouTube import). The gentle
 * ball rally is a CSS animation (`cam-rally` in globals.css); the global
 * prefers-reduced-motion rule tames it automatically.
 */
export function CameraGuide({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-xl border border-edge bg-surface-2/40 p-4 ${className}`}
    >
      <div className="flex items-center gap-2">
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 text-cyan-glow"
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
        <p className="text-sm font-medium text-zinc-200">
          Where to put the camera
        </p>
      </div>

      <svg
        viewBox="0 0 320 300"
        role="img"
        aria-label="Top-down view of a table-tennis table. The camera sits diagonally behind you and its view sweeps across the whole table, clearly seeing the ball land on both sides while neither player blocks the table."
        className="mx-auto mt-3 block w-full max-w-[340px]"
      >
        <defs>
          <linearGradient id="cg-cone" x1="48" y1="252" x2="220" y2="60" gradientUnits="userSpaceOnUse">
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
        <polygon
          points="48,252 88,26 232,30 288,238"
          fill="url(#cg-cone)"
        />
        {/* Sightlines to the two far corners: the camera clearly sees both sides */}
        <line x1="48" y1="252" x2="106" y2="44" stroke="#22d3ee" strokeWidth="1.2" strokeOpacity="0.55" strokeDasharray="4 4" />
        <line x1="48" y1="252" x2="214" y2="44" stroke="#22d3ee" strokeWidth="1.2" strokeOpacity="0.55" strokeDasharray="4 4" />

        {/* Table — top-down, long axis vertical. Two halves, one on each side
            of the net, are the "both sides" the camera must see. */}
        <rect x="106" y="44" width="108" height="176" rx="4" fill="#0f2b30" stroke="#22d3ee" strokeWidth="2" strokeOpacity="0.9" />
        {/* Faint tint on each half */}
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
        <g>
          <circle cx="160" cy="24" r="8" fill="#1b1b26" stroke="#52525b" strokeWidth="1.5" />
          <text x="160" y="12" textAnchor="middle" fontSize="9" fill="#a1a1aa">
            Opponent
          </text>
        </g>

        {/* You — clear of the near end, not covering the table */}
        <g>
          <circle cx="160" cy="248" r="8" fill="#1b1b26" stroke="#71717a" strokeWidth="1.5" />
          <text x="160" y="272" textAnchor="middle" fontSize="9" fill="#d4d4d8">
            You
          </text>
        </g>

        {/* Camera — diagonally behind you, off to one side */}
        <g>
          <rect x="30" y="256" width="26" height="17" rx="3" fill="#22d3ee" />
          <path d="M56 261 l9 -4 v13 l-9 -4 Z" fill="#22d3ee" />
          <circle cx="41" cy="264.5" r="4" fill="#0a0a0f" />
          <circle cx="41" cy="264.5" r="1.6" fill="#22d3ee" />
          <text x="34" y="290" textAnchor="middle" fontSize="9" fill="#67e8f9">
            Camera
          </text>
        </g>
      </svg>

      <p className="mt-3 text-xs leading-relaxed text-zinc-500">
        Place the camera diagonally behind you and raised a little, so it clearly
        sees the ball land on both sides of the table and neither player blocks
        the view.
      </p>
    </div>
  );
}
