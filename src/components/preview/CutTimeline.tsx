/**
 * Before/after cut visualization: the full recording (sparse glowing rally
 * segments lost in dead space) flowing into the short, dense rally-only cut.
 * Server component — all motion is CSS keyframes defined in PreviewStyles,
 * silenced globally by the prefers-reduced-motion rule in globals.css.
 */

// Rally segments inside the full recording, as [left%, width%]. Sparse on
// purpose: most of a real recording is walking, picking up balls, towels.
const RECORDING_SEGMENTS: [number, number][] = [
  [2.5, 1.1],
  [5.4, 0.8],
  [9.8, 1.4],
  [13.2, 0.9],
  [18.5, 1.2],
  [21.9, 0.8],
  [26.4, 1.5],
  [31.2, 1.0],
  [36.8, 0.9],
  [40.1, 1.3],
  [46.0, 0.8],
  [50.7, 1.2],
  [55.3, 1.0],
  [60.8, 1.4],
  [65.2, 0.9],
  [70.6, 1.1],
  [75.9, 1.3],
  [80.4, 0.8],
  [85.0, 1.2],
  [89.6, 1.0],
  [94.3, 1.4],
];

function BarLabel({ name, time }: { name: string; time: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <span className="text-sm font-medium text-zinc-300">{name}</span>
      <span className="font-mono text-sm tabular-nums text-zinc-400">
        {time}
      </span>
    </div>
  );
}

export function CutTimeline() {
  return (
    <div className="mx-auto max-w-3xl">
      {/* the full recording: long bar, mostly dark */}
      <div>
        <BarLabel name="Your recording" time="1:27:14" />
        <div
          role="img"
          aria-label="Timeline of a full match recording: an hour and a half, with only small scattered segments of actual play"
          className="relative h-4 overflow-hidden rounded-full border border-edge bg-surface-2"
        >
          {RECORDING_SEGMENTS.map(([left, width], i) => (
            <span
              key={left}
              className="pv-seg absolute rounded-[2px] bg-cyan-glow/80"
              style={{
                top: 3,
                bottom: 3,
                left: `${left}%`,
                width: `${width}%`,
                boxShadow: "0 0 8px rgba(34,211,238,.55)",
                animationDelay: `${(i % 7) * 0.35}s`,
              }}
            />
          ))}
        </div>
      </div>

      {/* connector: dead time falls away, play flows down */}
      <div
        className="my-3 flex flex-col items-center sm:my-4"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 40"
          className="h-9 w-6 text-cyan-glow"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ filter: "drop-shadow(0 0 6px rgba(34,211,238,.6))" }}
        >
          <path
            className="pv-flow"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 2v28m0 0-7-7m7 7 7-7"
          />
        </svg>
        <span className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          Dead time removed
        </span>
      </div>

      {/* the rally cut: short and dense — same play, none of the waiting.
          Width is honest: 11:32 of 1:27:14 is ~13% of the bar above. */}
      <div>
        <BarLabel name="Your rally cut" time="11:32" />
        <div
          role="img"
          aria-label="Timeline of the rally-only cut: eleven and a half minutes of solid play"
          className="relative h-4 w-[34%] min-w-28 overflow-hidden rounded-full border border-cyan-glow/50 sm:w-[13.2%]"
          style={{
            background:
              "repeating-linear-gradient(90deg, rgba(34,211,238,.85) 0 7px, rgba(10,10,15,.9) 7px 9px)",
            boxShadow:
              "0 0 12px rgba(34,211,238,.4), 0 0 32px rgba(34,211,238,.18)",
          }}
        >
          {/* moving sheen so the bar reads as alive */}
          <span className="pv-sheen absolute inset-0" />
        </div>
      </div>

      {/* stat row */}
      <div className="mt-8 flex flex-wrap items-baseline justify-center gap-y-3 text-center sm:mt-10">
        {[
          ["142", "rallies kept"],
          ["87%", "dead time removed"],
          ["11:32", "of pure play"],
        ].map(([value, label], i) => (
          <p key={label} className="flex items-baseline gap-2">
            {i > 0 && (
              <span aria-hidden className="mx-4 text-edge sm:mx-6">
                ·
              </span>
            )}
            <span className="font-mono text-xl font-bold tabular-nums text-cyan-glow sm:text-2xl">
              {value}
            </span>
            <span className="text-sm text-zinc-400">{label}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
